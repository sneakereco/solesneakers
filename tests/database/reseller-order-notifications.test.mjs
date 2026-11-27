import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, beforeEach, afterEach, test } from "node:test";
import {
  prepareTestDatabase,
  seedActor,
  dropTestDatabase,
} from "./fixtures/specialty-claims.mjs";

let db;
let tenantId;
before(async () => {
  db = await prepareTestDatabase();
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261127020000_reseller_order_notifications.sql",
      import.meta.url,
    ),
    "utf8",
  ).catch((error) => {
    if (error.code === "ENOENT") return null; // Baseline must fail on missing jobs, not a missing file.
    throw error;
  });
  if (migration) await db.query(migration);
});
after(async () => {
  await db?.end();
  if (db) await dropTestDatabase();
});
beforeEach(async () => {
  await db.query("begin");
  tenantId = (await seedActor(db)).owner;
});
afterEach(async () => {
  await db.query("rollback");
});

async function createOrder(fulfillment = "ship") {
  return (
    await db.query(
      "insert into public.orders(tenant_id,subtotal,shipping,total,status,fulfillment,guest_email,currency) values($1,10,0,10,'pending',$2,'fixture@example.invalid','USD') returning id",
      [tenantId, fulfillment],
    )
  ).rows[0].id;
}
async function status(id, value) {
  await db.query("update public.orders set status=$2 where id=$1", [id, value]);
}
async function kinds(id) {
  return (
    await db.query(
      "select kind from public.checkout_notification_outbox where order_id=$1 order by kind",
      [id],
    )
  ).rows.map((row) => row.kind);
}

for (const fulfillment of ["ship", "pickup"]) {
  test(`${fulfillment} payment queues a distinct reseller alert beside customer messages`, async () => {
    const id = await createOrder(fulfillment);
    await status(id, "paid");
    assert.deepEqual(
      await kinds(id),
      fulfillment === "pickup"
        ? ["order_confirmation", "pickup_instructions", "reseller_order_placed"]
        : ["order_confirmation", "reseller_order_placed"],
    );
    const claimed = (
      await db.query("select public.claim_checkout_notifications_v2(3,$1) result", [id])
    ).rows[0].result;
    assert.equal(claimed.length, fulfillment === "pickup" ? 3 : 2);
  });
}
test("pending and canceled orders do not queue paid-order emails", async () => {
  const id = await createOrder();
  assert.deepEqual(await kinds(id), []);
  await status(id, "canceled");
  assert.deepEqual(await kinds(id), []);
});
test("replayed paid status changes create exactly one reseller and customer job", async () => {
  const id = await createOrder();
  for (const value of ["paid", "paid", "shipped", "paid"]) await status(id, value);
  assert.deepEqual(await kinds(id), ["order_confirmation", "reseller_order_placed"]);
});
test("the expanded constraint preserves every existing notification kind", async () => {
  const id = await createOrder();
  for (const kind of [
    "order_confirmation",
    "pickup_instructions",
    "refund_confirmation",
    "label_created",
    "shipping_update",
    "delivery_confirmation",
    "reseller_order_placed",
  ]) {
    await db.query(
      "insert into public.checkout_notification_outbox(event_key,order_id,tenant_id,kind) values($1,$2,$3,$4)",
      [randomUUID(), id, tenantId, kind],
    );
  }
  assert.equal((await kinds(id)).length, 7);
});

for (const scoped of [false, true]) {
  test(`legacy ${scoped ? "order" : "global"} workers leave reseller jobs for the upgraded worker`, async () => {
    const id = await createOrder("pickup");
    await status(id, "paid");
    const legacy = (
      await db.query(
        scoped
          ? "select public.claim_checkout_notifications_for_order($1,3) result"
          : "select public.claim_checkout_notifications(3) result",
        scoped ? [id] : [],
      )
    ).rows[0].result;
    assert.deepEqual(legacy.map((row) => row.kind).sort(), [
      "order_confirmation",
      "pickup_instructions",
    ]);
    const upgraded = (
      await db.query("select public.claim_checkout_notifications_v2(3,$1) result", [id])
    ).rows[0].result;
    assert.deepEqual(
      upgraded.map((row) => row.kind),
      ["reseller_order_placed"],
    );
  });
}

test("upgraded claims preserve order scoping, limits, and active leases", async () => {
  const first = await createOrder();
  const other = await createOrder();
  await status(first, "paid");
  await status(other, "paid");
  const claim = async (limit) =>
    (
      await db.query("select public.claim_checkout_notifications_v2($1,$2) result", [
        limit,
        first,
      ])
    ).rows[0].result;
  const one = await claim(1);
  const remaining = await claim(3);
  assert.equal(one.length, 1);
  assert.equal(remaining.length, 1);
  assert.notEqual(one[0].id, remaining[0].id);
  assert.ok([...one, ...remaining].every((row) => row.orderId === first));
  assert.deepEqual(await claim(3), []);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.checkout_notification_outbox where order_id=$1 and status='pending'",
        [other],
      )
    ).rows[0].n,
    2,
  );
});

test("the service role can claim the reseller job", async () => {
  const id = await createOrder();
  await status(id, "paid");
  await db.query("set local role service_role");
  const result = (
    await db.query("select public.claim_checkout_notifications_v2(3,$1) result", [id])
  ).rows[0].result;
  assert.ok(result.some((row) => row.kind === "reseller_order_placed"));
});

for (const role of ["anon", "authenticated"]) {
  test(`${role} cannot claim order emails`, async () => {
    await db.query(`set local role ${role}`);
    await assert.rejects(
      db.query("select public.claim_checkout_notifications_v2(3)"),
      /permission denied for function claim_checkout_notifications_v2/,
    );
  });
}

test("the actual audit schema accepts the reseller job and recipient", async () => {
  const id = await createOrder();
  await status(id, "paid");
  const notification = (
    await db.query(
      "select id from public.checkout_notification_outbox where order_id=$1 and kind='reseller_order_placed'",
      [id],
    )
  ).rows[0].id;
  const row = (
    await db.query(
      "insert into public.email_audit_log(order_id,tenant_id,email_type,recipient_email,delivery_status,message_id,notification_id) values($1,$2,'reseller_order_placed','SolesneakersLLC@yahoo.com','sent','fixture-accepted',$3) returning email_type,recipient_email,notification_id",
      [id, tenantId, notification],
    )
  ).rows[0];
  assert.equal(row.email_type, "reseller_order_placed");
  assert.equal(row.recipient_email, "SolesneakersLLC@yahoo.com");
  assert.equal(row.notification_id, notification);
});
