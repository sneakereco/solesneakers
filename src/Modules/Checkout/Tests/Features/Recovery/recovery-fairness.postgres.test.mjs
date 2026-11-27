import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";
const require = createRequire(import.meta.url);
require("tsx/cjs");
const {
  runCheckoutRecovery,
} = require("../../../Source/Features/Recovery/recovery-worker.ts");
test("durable recovery fairness, concurrent capacity and crash ownership", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder, barrier }) => {
      const clients = await Promise.all(
        Array.from({ length: 5 }, () => connect("service_role")),
      );
      const rpc = async (c, sql, args = []) =>
        (await c.query("select " + sql + " v", args)).rows[0].v;
      const order = await seedOrder();
      const enqueue = async (n) => {
        for (let i = 0; i < n; i++)
          await rpc(
            admin,
            "enqueue_checkout_recovery('reconcile_payment',$1,now()-interval '1 hour'+$2*interval '1 millisecond',null,$3)",
            ["probe:" + i, i, order.orderId],
          );
      };
      const deps = (c, process) => ({
        sweep: async () => {},
        oldestDueMs: () => rpc(c, "oldest_checkout_recovery_due_ms()"),
        claimRecovery: ({ limit, now }) =>
          rpc(c, "claim_checkout_recovery($1,120,$2)", [
            limit,
            new Date(Date.parse(now) - 30 * 60 * 1000).toISOString(),
          ]),
        finishRecovery: ({ id, leaseToken, result, nextAttemptAt, reason }) =>
          rpc(c, "finish_checkout_recovery($1,$2,$3,$4,$5)", [
            id,
            leaseToken,
            result,
            nextAttemptAt,
            reason,
          ]),
        acquireDependencyLease: () =>
          rpc(c, "acquire_checkout_dependency_lease('square',4,120)"),
        releaseDependencyLease: (token) =>
          rpc(c, "release_checkout_dependency_lease($1)", [token]),
        process,
      });
      await t.test(
        "eleven capacity deferrals and stale finishes preserve each genuine observation",
        async () => {
          const key = "capacity-observation:" + order.orderId;
          await rpc(
            admin,
            "enqueue_checkout_recovery('reconcile_payment',$1,now()-interval '2 hours',null,$2)",
            [key, order.orderId],
          );
          const wake = () =>
            admin.query(
              "update checkout_recovery_jobs set next_attempt_at=now()-interval '2 hours' where unique_key=$1",
              [key],
            );
          const worker = deps(clients[0], () => Promise.resolve("retry"));
          for (let i = 0; i < 11; i++) {
            const summary = await runCheckoutRecovery(
              { deadlineMs: 45000, batchSize: 1, concurrency: 1 },
              { ...worker, acquireDependencyLease: () => Promise.resolve(null) },
            );
            assert.equal(summary.retry, 1);
            await wake();
          }
          const [stale] = await worker.claimRecovery({
            limit: 1,
            now: new Date().toISOString(),
          });
          await admin.query(
            "update checkout_recovery_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
            [stale.id],
          );
          for (let i = 1; i <= 12; i++) {
            const summary = await runCheckoutRecovery(
              { deadlineMs: 45000, batchSize: 1, concurrency: 1 },
              worker,
            );
            assert.equal(i === 12 ? summary.review : summary.retry, 1);
            const {
              rows: [job],
            } = await admin.query(
              "select id,unresolved_observations,attempts from checkout_recovery_jobs where unique_key=$1",
              [key],
            );
            assert.equal(job.unresolved_observations, i);
            assert.equal(job.attempts, i + 12);
            assert.equal(
              await rpc(
                clients[1],
                "finish_checkout_recovery($1,$2,'review',null,'inquiry_unresolved')",
                [job.id, stale.leaseToken],
              ),
              false,
            );
            if (i < 12) await wake();
          }
        },
      );
      await t.test("fifty failing jobs cannot starve a later valid job", async () => {
        await enqueue(51);
        const valid = await rpc(
          admin,
          "(select id from checkout_recovery_jobs where unique_key='probe:50')",
        );
        const result = await runCheckoutRecovery(
          { batchSize: 50, concurrency: 4, deadlineMs: 45000 },
          deps(clients[0], async (j) => (j.id === valid ? "done" : "retry")),
        );
        assert.equal(result.done, 1);
        assert.equal(result.retry, 50);
        assert.equal(
          await rpc(admin, "(select status from checkout_recovery_jobs where id=$1)", [
            valid,
          ]),
          "done",
        );
      });
      await t.test(
        "five Redis-independent workers hold a global four calls, with no open SQL transaction during the calls",
        async () => {
          await admin.query(
            "update checkout_recovery_jobs set next_attempt_at=now()-interval '1 hour' where status='pending' and unique_key like 'probe:%'",
          );
          const start = barrier(5);
          start.release();
          let active = 0,
            peak = 0,
            release;
          const gate = new Promise((r) => {
            release = r;
          });
          const promises = clients.map(async (c) => {
            await start.wait();
            return runCheckoutRecovery(
              { batchSize: 1, concurrency: 1, deadlineMs: 45000 },
              deps(c, async () => {
                active++;
                peak = Math.max(active, peak);
                if (active === 4) {
                  const sessions = await admin.query(
                    "select count(*)::int n from pg_stat_activity where datname=current_database() and state='idle in transaction'",
                  );
                  assert.equal(sessions.rows[0].n, 0);
                  release();
                }
                await gate;
                active--;
                return "done";
              }),
            );
          });
          const timer = setTimeout(release, 3000);
          try {
            await Promise.all(promises);
          } finally {
            clearTimeout(timer);
          }
          assert.equal(peak, 4);
          assert.equal(
            await rpc(
              admin,
              "(select count(*)::int from checkout_dependency_leases where lease_token is not null)",
            ),
            0,
          );
        },
      );
      await t.test(
        "stale mail claims never finish another send and crashed handoff stays visible",
        async () => {
          const id = order.orderId;
          await admin.query(
            "insert into checkout_notification_outbox(order_id,tenant_id,kind,event_key) select id,tenant_id,k,k||id from orders cross join unnest(array['order_confirmation','pickup_instructions']) k where id=$1",
            [id],
          );
          const claim = (c) => rpc(c, "claim_checkout_mail(1,$1)", [id]);
          const [first] = await claim(clients[0]);
          assert.ok(first);
          const expire = (n) =>
            admin.query(
              "update checkout_notification_outbox set lease_expires_at=now()-interval '1 second' where id=$1",
              [n.id],
            );
          await expire(first);
          const [next] = await claim(clients[1]);
          assert.equal(next.id, first.id);
          assert.notEqual(next.leaseToken, first.leaseToken);
          assert.equal(
            await rpc(clients[0], "finish_checkout_mail($1,$2,'sent')", [
              first.id,
              first.leaseToken,
            ]),
            false,
          );
          assert.equal(
            await rpc(clients[1], "begin_checkout_mail_handoff($1,$2)", [
              next.id,
              next.leaseToken,
            ]),
            true,
          );
          await expire(next);
          const [independent] = await claim(clients[0]);
          assert.notEqual(independent.id, next.id);
          assert.equal(
            await rpc(clients[0], "begin_checkout_mail_handoff($1,$2)", [
              independent.id,
              independent.leaseToken,
            ]),
            true,
          );
          await assert.rejects(
            rpc(clients[0], "finish_checkout_mail($1,$2,'rejected')", [
              independent.id,
              independent.leaseToken,
            ]),
            /invalid_mail_finish/,
          );
          assert.equal(
            await rpc(
              clients[0],
              "finish_checkout_mail($1,$2,'rejected',451,'data_final')",
              [independent.id, independent.leaseToken],
            ),
            true,
          );
          const {
            rows: [retry],
          } = await admin.query(
            "select status,handoff_started_at,next_attempt_at>clock_timestamp() delayed from checkout_notification_outbox where id=$1",
            [independent.id],
          );
          assert.deepEqual(retry, {
            status: "failed",
            handoff_started_at: null,
            delayed: true,
          });
          assert.equal(
            await rpc(
              admin,
              "(select status from checkout_notification_outbox where id=$1)",
              [next.id],
            ),
            "review",
          );
          await admin.query(
            "insert into email_audit_log(order_id,tenant_id,email_type,recipient_email,subject,delivery_status,notification_id) select order_id,tenant_id,kind,'fixture@example.invalid','fixture','sent',id from checkout_notification_outbox where id=$1",
            [next.id],
          );
          await claim(clients[0]);
          assert.equal(
            await rpc(
              admin,
              "(select status from checkout_notification_outbox where id=$1)",
              [next.id],
            ),
            "sent",
          );
        },
      );
      await t.test(
        "bounded sweep discovers legacy orders after already queued ones without issuing attempts",
        async () => {
          const legacy = await seedOrder();
          await rpc(admin, "sweep_checkout_recovery(50)");
          assert.equal(
            await rpc(
              admin,
              "(select count(*)::int from checkout_recovery_jobs where unique_key=$1)",
              ["legacy_payment_order:" + legacy.orderId],
            ),
            1,
          );
          assert.equal(
            await rpc(
              admin,
              "(select count(*)::int from checkout_payment_attempts where order_id=$1)",
              [legacy.orderId],
            ),
            0,
          );
        },
      );
    },
  );
});
