import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

process.env.CHECKOUT_ADMISSION_BUDGETS = JSON.stringify({
  version: 1,
  revision: "recovery-capacity-regression",
  ipPerMinute: 120,
  globalPerMinute: 400,
  providers: { square: 2, shippo: 2 },
});
const require = createRequire(import.meta.url);
require("tsx/cjs");
const {
  runCheckoutRecovery,
  recoverySettings,
} = require("../../../Source/Features/Recovery/recovery-worker.ts");
const {
  CheckoutDependencyLeaseRepository,
} = require("../../../Source/Features/Recovery/dependency-lease.ts");

test("the production two-slot limit drains all claimed recovery jobs in one run", async () => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder }) => {
      const service = await connect("service_role");
      const rpc = async (sql, values = []) =>
        (await service.query("select public." + sql + " as value", values)).rows[0].value;
      const leaseClient = {
        async rpc(name, args) {
          const data =
            name === "acquire_checkout_dependency_lease"
              ? await rpc("acquire_checkout_dependency_lease($1,$2,$3)", [
                  args.p_dependency,
                  args.p_limit,
                  args.p_lease_seconds,
                ])
              : await rpc("release_checkout_dependency_lease($1)", [args.p_token]);
          return { data, error: null };
        },
      };
      const leases = new CheckoutDependencyLeaseRepository(leaseClient);
      const order = await seedOrder();
      for (let i = 0; i < 8; i++) {
        await rpc(
          "enqueue_checkout_recovery('reconcile_payment',$1,now()-interval '1 hour',null,$2)",
          ["capacity:" + i, order.orderId],
        );
      }
      let active = 0;
      let peak = 0;
      const summary = await runCheckoutRecovery(recoverySettings, {
        sweep: async () => {},
        oldestDueMs: () => rpc("oldest_checkout_recovery_due_ms()"),
        claimRecovery: ({ limit, leaseSeconds, now }) =>
          rpc("claim_checkout_recovery($1,$2,$3)", [limit, leaseSeconds, now]),
        finishRecovery: ({ id, leaseToken, result, nextAttemptAt, reason }) =>
          rpc("finish_checkout_recovery($1,$2,$3,$4,$5)", [
            id,
            leaseToken,
            result,
            nextAttemptAt,
            reason,
          ]),
        acquireDependencyLease: (input) => leases.acquireDependencyLease(input),
        releaseDependencyLease: (token) => leases.releaseDependencyLease(token),
        process: async (_job, signal) => {
          active++;
          peak = Math.max(peak, active);
          try {
            await delay(20, undefined, { signal });
            return "done";
          } finally {
            active--;
          }
        },
      });
      assert.equal(summary.done, 8);
      assert.equal(summary.retry, 0);
      assert.equal(peak, 2);
      assert.deepEqual(
        (
          await admin.query(
            "select status,count(*)::int as count from checkout_recovery_jobs where unique_key like 'capacity:%' group by status",
          )
        ).rows,
        [{ status: "done", count: 8 }],
      );
      assert.equal(
        (
          await admin.query(
            "select count(*)::int as count from checkout_dependency_leases where lease_expires_at>clock_timestamp()",
          )
        ).rows[0].count,
        0,
      );
    },
  );
});
