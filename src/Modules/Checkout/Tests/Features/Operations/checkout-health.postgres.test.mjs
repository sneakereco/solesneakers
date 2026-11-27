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
    async ({ admin, connect, seedOrder }) => {
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
