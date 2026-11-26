import { collectQueueSnapshot } from "./telemetry.mjs";
function identity(target, journal, plan) {
  if (
    target.digest !== journal.targetDigest ||
    (plan && plan.targetDigest !== target.digest)
  )
    throw Error("Cleanup target identity mismatch");
}
function settled(value) {
  return ["unresolvedHolds", "unresolvedPayments", "notifications"].every(
    (key) => value?.[key] === 0,
  );
}
export async function drainRun(target, plan, clients, journal) {
  identity(target, journal, plan);
  const now = clients.now ?? Date.now,
    pause = clients.pause ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    deadline = now() + (plan.drainSeconds ?? 600) * 1000,
    started = now();
  let unresolved = null;
  const reasons = [];
  do {
    try {
      unresolved = await clients.snapshot();
      if (settled(unresolved) && now() - started >= (plan.recoverySeconds ?? 0) * 1000)
        return {
          status: "drained",
          unresolved,
          reasons: [],
          observedSeconds: (now() - started) / 1000,
        };
    } catch {
      reasons.push("Database, Redis or owned queue recovery evidence unavailable");
    }
    if (now() >= deadline) break;
    await pause(Math.min(300000, deadline - now()));
  } while (now() <= deadline);
  return {
    status: "incomplete",
    unresolved,
    reasons: [
      ...new Set([...reasons, "Owned work did not settle within the recovery deadline"]),
    ],
    observedSeconds: (now() - started) / 1000,
  };
}
export async function cleanupRun(target, journal, clients) {
  identity(target, journal);
  const remaining = () => journal.records().filter((x) => x.status !== "deleted");
  try {
    if (!settled(await clients.snapshot()))
      return {
        status: "incomplete",
        reasons: [
          "Unresolved owned payment, hold or notification; financial records retained",
        ],
        remaining: remaining(),
      };
    await clients.deleteOrders();
    const order = ["catalog", "account", "shipping", "registry"];
    for (const kind of order)
      for (const entry of remaining().filter((x) => x.kind === kind)) {
        await clients.deleteOwned(entry);
        await journal.markDeleted(entry.kind, entry.key);
      }
    const unknown = remaining().filter(
      (x) =>
        !order.includes(x.kind) && !["lifecycle", "worker", "artifact"].includes(x.kind),
    );
    if (unknown.length)
      return {
        status: "incomplete",
        reasons: ["Unrecognized ownership group retained"],
        remaining: unknown,
      };
    await clients.finish();
    await journal.intent?.("lifecycle", "cleanup-complete", { id: "cleanup-complete" });
    await journal.commit?.("lifecycle", "cleanup-complete");
    return { status: "cleaned", remaining: [], reasons: [] };
  } catch {
    return {
      status: "incomplete",
      reasons: ["Cleanup interrupted; rerun with this same run ID and journal"],
      remaining: remaining(),
    };
  }
}
export function createCleanupClients({ db, admin, control, runId, journal }) {
  const catalog = () =>
      journal
        .records()
        .filter((x) => x.kind === "catalog")
        .map((x) => x.data),
    variants = () => catalog().map((x) => x.variantId);
  return {
    snapshot: async () => {
      await control("events", { runId });
      return collectQueueSnapshot(db, variants());
    },
    async deleteOrders() {
      await db.query("begin");
      try {
        const unsafe = await db.query(
          `select o.id from public.orders o where exists(select 1 from public.order_items i where i.order_id=o.id and i.variant_id=any($1::uuid[])) and (o.status='pending' or exists(select 1 from public.order_items other where other.order_id=o.id and (other.variant_id is null or not(other.variant_id=any($1::uuid[]))))) for update of o`,
          [variants()],
        );
        if (unsafe.rows.length) throw Error("Unresolved or mixed ownership order");
        await db.query(
          `delete from public.email_audit_log where order_id in(select order_id from public.order_items where variant_id=any($1::uuid[]))`,
          [variants()],
        );
        await db.query(
          `delete from public.orders where id in(select order_id from public.order_items where variant_id=any($1::uuid[]))`,
          [variants()],
        );
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    },
    async deleteOwned(entry) {
      const d = entry.data;
      if (entry.kind === "registry") return;
      if (entry.kind === "catalog") {
        await db.query("begin");
        try {
          const existing = (
            await db.query("select name from public.products where id=$1 for update", [
              d.id,
            ])
          ).rows[0];
          if (existing && existing.name !== d.name) throw Error("Unrelated catalog");
          if (
            (
              await db.query(
                "select 1 from public.order_items where product_id=$1 or variant_id=$2 limit 1",
                [d.id, d.variantId],
              )
            ).rows.length
          )
            throw Error("Catalog still has orders");
          await db.query("delete from public.products where id=$1", [d.id]);
          await db.query(
            "delete from public.tag_brands where id=$1 and canonical_label=$2",
            [d.brandId, `Load ${runId} ${d.id}`],
          );
          await db.query(
            "delete from public.tag_sizes where id=$1 and canonical_label=$2",
            [d.sizeId, `Load ${d.id}`],
          );
          await db.query("commit");
        } catch (error) {
          await db.query("rollback");
          throw error;
        }
        return;
      }
      if (entry.kind === "shipping") {
        await db.query(
          "delete from public.shipping_defaults where id=$1 and category='accessories' and shipping_cost_cents=1000",
          [d.id],
        );
        return;
      }
      if (entry.kind === "account") {
        const found = await admin.auth.admin.getUserById(d.id);
        if (!found.data?.user) {
          if (
            found.error?.status === 404 ||
            ["user_not_found", "user_not_found_by_id"].includes(found.error?.code)
          )
            return;
          throw Error("Auth cleanup lookup failed");
        }
        if (
          found.data.user.app_metadata?.load_test_run !== runId ||
          found.data.user.email !== d.email
        )
          throw Error("Unrelated account");
        if (
          (
            await db.query(
              "select 1 from public.orders where user_id=$1 or label_created_by=$1 limit 1",
              [d.id],
            )
          ).rows.length
        )
          throw Error("Account still owns orders");
        const result = await admin.auth.admin.deleteUser(d.id);
        if (result.error) throw Error("Auth deletion failed");
        await db.query(
          "delete from public.profiles where id=$1 and role='customer' and email=$2",
          [d.id, d.email],
        );
        return;
      }
      throw Error("Unknown cleanup entity");
    },
    finish: () => control("cleanup", { runId }),
  };
}
