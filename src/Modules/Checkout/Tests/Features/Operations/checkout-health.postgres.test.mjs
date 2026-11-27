import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";
const require = createRequire(import.meta.url);
require("tsx/cjs");

test("checkout operating health in the disposable database", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder, seedCatalog, populated }) => {
      const service = await connect("service_role");
      const { orderId } = await seedOrder();
      async function rpc(expression, values = []) {
        return (await service.query("select public." + expression + " result", values))
          .rows[0].result;
      }
      await t.test(
        "both scheduled workers must complete independently; a read never advances either clock",
        async () => {
          const {
            readCheckoutHealth,
            checkoutAlerts,
          } = require("../../../Source/Features/Operations/health-snapshot.ts");
          const read = () =>
            readCheckoutHealth({ read: () => rpc("read_checkout_health()") });
          assert.equal((await read()).workerLastSeenAt, null);
          await rpc("record_checkout_worker_heartbeat('mail')");
          const mail = await read();
          assert.ok(mail.mailLastSeenAt);
          assert.equal(mail.workerLastSeenAt, null);
          await rpc("record_checkout_worker_heartbeat('recovery')");
          const health = await read();
          assert.ok(health.workerLastSeenAt);
          assert.equal(health.mailLastSeenAt, mail.mailLastSeenAt);
          assert.ok(
            health.maxConnections >= health.activeConnections &&
              health.activeConnections > 0,
          );
          assert.ok(!checkoutAlerts(health).includes("missing_heartbeat"));
        },
      );
      await t.test(
        "a sent compatibility row cannot bind an expired slot or hide a current expired mail obligation",
        async () => {
          const sentOrder = await seedOrder();
          const liveOrder = await seedOrder();
          // Roll back only this fixture's rows and clock adjustments. Use the normal
          // service-role RPCs for acquiring, claiming, finishing and reading health.
          await admin.query("begin");
          try {
            for (const { orderId: id } of [sentOrder, liveOrder]) {
              await admin.query(
                "insert into checkout_notification_outbox(order_id,tenant_id,kind,event_key) select id,tenant_id,'order_confirmation',$2 from orders where id=$1",
                [id, randomUUID()],
              );
            }
            await admin.query("set local role service_role");
            const claim = async (id) =>
              (await admin.query("select public.claim_checkout_mail(1,$1) rows", [id]))
                .rows[0].rows[0];
            const sent = await claim(sentOrder.orderId);
            const slot = (
              await admin.query(
                "select public.acquire_checkout_dependency_lease('square',1,120) token",
              )
            ).rows[0].token;
            assert.ok(slot);
            // This old writer is fenced in the combined schema. Recreate only the historical row shape as trusted fixture setup.
            await admin.query("reset role");
            await admin.query(
              "update checkout_notification_outbox set status=\x27sent\x27 where id=$1",
              [sent.id],
            );
            await admin.query("set local role service_role");
            const persisted = (
              await admin.query(
                "select status,lease_token,lease_expires_at is not null as has_expiry from checkout_notification_outbox where id=$1",
                [sent.id],
              )
            ).rows[0];
            assert.deepEqual(persisted, {
              status: "sent",
              lease_token: sent.leaseToken,
              has_expiry: true,
            });
            await admin.query("reset role");
            await admin.query(
              "update checkout_notification_outbox set lease_expires_at=clock_timestamp()-interval '20 minutes' where id=$1",
              [sent.id],
            );
            await admin.query(
              "update checkout_dependency_leases set lease_expires_at=clock_timestamp()-interval '10 minutes' where lease_token=$1",
              [slot],
            );
            await admin.query("set local role service_role");
            const {
              readCheckoutHealth,
              checkoutAlerts,
              alertOrderReference,
            } = require("../../../Source/Features/Operations/health-snapshot.ts");
            const read = () =>
              readCheckoutHealth({
                read: async () =>
                  (await admin.query("select public.read_checkout_health() snapshot"))
                    .rows[0].snapshot,
              });
            const infra = await read();
            const live = await claim(liveOrder.orderId);
            await admin.query("reset role");
            await admin.query(
              "update checkout_notification_outbox set lease_expires_at=clock_timestamp()-interval '1 minute' where id=$1",
              [live.id],
            );
            await admin.query("set local role service_role");
            const mixed = await read();
            assert.deepEqual([infra.expiredLeases, mixed.expiredLeases], [1, 2]);
            for (const health of [infra, mixed]) {
              assert.ok(checkoutAlerts(health).includes("expired_lease"));
              assert.equal(health.reviewOrderId, populated?.legacyReview.orderId ?? null);
            }
            assert.deepEqual(
              [
                alertOrderReference(infra, "expired_lease"),
                alertOrderReference(mixed, "expired_lease"),
              ],
              [null, liveOrder.orderId],
            );
          } finally {
            await admin.query("rollback");
          }
        },
      );
      await t.test(
        "distinct trusted orders correlate unknown, pending, expired hold, overdue work, mail and lost mail lease independently of review rows",
        async () => {
          const owners = {};
          for (const kind of [
            "old_unknown",
            "old_pending",
            "overdue_hold",
            "overdue_recovery",
            "overdue_mail",
            "expired_lease",
          ])
            owners[kind] = (await seedOrder()).orderId;
          for (const [kind, state] of [
            ["old_unknown", "unknown"],
            ["old_pending", "pending"],
          ]) {
            await admin.query(
              "insert into checkout_payment_attempts(order_id,sequence,state,method,amount_cents,currency,owner_key,dispatched_at,request_digest,source_digest) values ($1,1,$2,'card',100,'USD','fixture',now()-interval '2 days',repeat('a',64),repeat('b',64))",
              [owners[kind], state],
            );
          }
          const { variantId } = await seedCatalog({ stock: 1 });
          await admin.query(
            "insert into inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,now()-interval '2 days' from orders where id=$1",
            [owners.overdue_hold, variantId],
          );
          await admin.query(
            "insert into checkout_recovery_jobs(kind,unique_key,order_id,next_attempt_at) values ('reconcile_payment',$2,$1,now()-interval '2 days')",
            [owners.overdue_recovery, randomUUID()],
          );
          for (const kind of ["overdue_mail", "expired_lease"])
            await admin.query(
              "insert into checkout_notification_outbox(order_id,tenant_id,kind,event_key,created_at,status,lease_token,lease_expires_at) select id,tenant_id,'order_confirmation',$2,now()-make_interval(days=>$3),'processing',$4,$5 from orders where id=$1",
              [
                owners[kind],
                randomUUID(),
                kind === "overdue_mail" ? 3 : 1,
                randomUUID(),
                new Date(Date.now() + (kind === "expired_lease" ? -60000 : 60000)),
              ],
            );
          const sql = await rpc("read_checkout_health()");
          assert.equal(sql.reviewCount, populated ? 1 : 0);
          assert.equal(sql.reviewOrderId, populated?.legacyReview.orderId ?? null);
          assert.ok(!Object.values(owners).includes(sql.reviewOrderId));
          assert.deepEqual(sql.alertOrderIds, owners);
        },
      );
      await t.test(
        "blocked synthetic job triggers a manual review alert with the supportable local order",
        async () => {
          const {
            readCheckoutHealth,
            checkoutAlerts,
          } = require("../../../Source/Features/Operations/health-snapshot.ts");
          await admin.query(
            "insert into checkout_recovery_jobs(kind,unique_key,order_id,status,next_attempt_at) values ('reconcile_payment',$1,$2,'review',now()-interval '1 day')",
            ["drill:" + randomUUID(), orderId],
          );
          const snapshot = await readCheckoutHealth({
            read: () => rpc("read_checkout_health()"),
          });
          assert.ok(snapshot.reviewCount >= 1);
          assert.equal(snapshot.reviewOrderId, orderId);
          assert.ok(checkoutAlerts(snapshot).includes("manual_review"));
        },
      );
      await t.test(
        "sent audit wins a post-handoff failure; stale token cannot claim credit or resend",
        async () => {
          await admin.query(
            "insert into checkout_notification_outbox(order_id,tenant_id,kind,event_key) select id,tenant_id,'order_confirmation',$2 from orders where id=$1",
            [orderId, randomUUID()],
          );
          const [n] = await rpc("claim_checkout_mail(1,$1)", [orderId]);
          assert.equal(
            await rpc("begin_checkout_mail_handoff($1,$2)", [n.id, n.leaseToken]),
            true,
          );
          await admin.query(
            "insert into email_audit_log(order_id,tenant_id,email_type,recipient_email,subject,delivery_status,notification_id) select order_id,tenant_id,kind,'fixture@example.invalid','fixture','sent',id from checkout_notification_outbox where id=$1",
            [n.id],
          );
          assert.equal(
            await rpc("finish_checkout_mail_disposition($1,$2,'review')", [
              n.id,
              randomUUID(),
            ]),
            null,
          );
          assert.equal(
            await rpc("finish_checkout_mail_disposition($1,$2,'review')", [
              n.id,
              n.leaseToken,
            ]),
            "sent",
          );
          assert.equal(
            await rpc("finish_checkout_mail_disposition($1,$2,'sent')", [
              n.id,
              n.leaseToken,
            ]),
            null,
          );
          assert.deepEqual(await rpc("claim_checkout_mail(1,$1)", [orderId]), []);
        },
      );
      await t.test(
        "ages, queue and shared capacity come from durable work on the database clock",
        async () => {
          const { orderId: id } = await seedOrder();
          await admin.query(
            "insert into checkout_payment_attempts(order_id,sequence,state,method,amount_cents,currency,owner_key,dispatched_at,request_digest,source_digest) values ($1,1,'unknown','card',100,'USD','fixture',now()-interval '20 minutes',repeat('a',64),repeat('b',64))",
            [id],
          );
          await admin.query(
            "insert into checkout_recovery_jobs(kind,unique_key,order_id,next_attempt_at) values ('reconcile_payment',$2,$1,now()-interval '6 minutes')",
            [id, randomUUID()],
          );
          const token = await rpc("acquire_checkout_dependency_lease('square',1,120)");
          const snapshot = await rpc("read_checkout_health()");
          assert.ok(snapshot.oldestUnknownMs >= 1200000);
          assert.ok(snapshot.oldestDueMs >= 360000);
          assert.ok(snapshot.queueDepth >= 2);
          assert.equal(snapshot.squareLeases, 1);
          await rpc("release_checkout_dependency_lease($1)", [token]);
          assert.equal((await rpc("read_checkout_health()")).squareLeases, 0);
        },
      );
      await t.test(
        "aggregate, heartbeat and finish disposition are service only",
        async () => {
          for (const role of ["anon", "authenticated", "service_role"]) {
            for (const proc of [
              "read_checkout_health()",
              "record_checkout_worker_heartbeat(text)",
              "finish_checkout_mail_disposition(uuid,uuid,text,integer,text)",
            ]) {
              assert.equal(
                (
                  await admin.query(
                    "select has_function_privilege($1,$2,'execute') value",
                    [role, proc],
                  )
                ).rows[0].value,
                role === "service_role",
              );
            }
            assert.equal(
              (
                await admin.query(
                  "select has_table_privilege($1,'checkout_worker_heartbeats','select') value",
                  [role],
                )
              ).rows[0].value,
              role === "service_role",
            );
          }
        },
      );
    },
  );
});
