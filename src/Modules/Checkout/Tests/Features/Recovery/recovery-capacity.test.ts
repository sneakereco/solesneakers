import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  RecoveryWorkerDependencies,
  recoverySettings,
  runCheckoutRecovery,
} from "../../../Source/Features/Recovery/recovery-worker";
import type { RecoveryJob } from "../../../Source/Features/Recovery/recovery-contract";

const originalBudgets = process.env.CHECKOUT_ADMISSION_BUDGETS;
afterEach(() => {
  if (originalBudgets === undefined) delete process.env.CHECKOUT_ADMISSION_BUDGETS;
  else process.env.CHECKOUT_ADMISSION_BUDGETS = originalBudgets;
});

it.each([1, 2])(
  "drains a recovery batch without starving jobs when Square capacity is %i",
  async (capacity) => {
    process.env.CHECKOUT_ADMISSION_BUDGETS = JSON.stringify({
      version: 1,
      revision: "recovery-capacity-regression",
      ipPerMinute: 120,
      globalPerMinute: 400,
      providers: { square: capacity, shippo: 2 },
    });
    let worker!: {
      runCheckoutRecovery: typeof runCheckoutRecovery;
      recoverySettings: typeof recoverySettings;
    };
    jest.isolateModules(() => {
      worker = jest.requireActual("../../../Source/Features/Recovery/recovery-worker");
    });
    const queue: RecoveryJob[] = Array.from({ length: 8 }, () => ({
      id: randomUUID(),
      kind: "reconcile_payment",
      orderId: randomUUID(),
      eventId: null,
      leaseToken: randomUUID(),
      attempts: 1,
      unresolvedObservations: 0,
    }));
    const leases = new Set<string>();
    let peak = 0;
    const deps: RecoveryWorkerDependencies = {
      sweep: async () => {},
      oldestDueMs: () => Promise.resolve(0),
      claimRecovery: ({ limit }) => Promise.resolve(queue.splice(0, limit)),
      acquireDependencyLease: () => {
        if (leases.size >= capacity) return Promise.resolve(null);
        const token = randomUUID();
        leases.add(token);
        peak = Math.max(peak, leases.size);
        return Promise.resolve(token);
      },
      releaseDependencyLease: (token) => {
        leases.delete(token);
        return Promise.resolve();
      },
      process: async (_job, signal) => {
        await delay(10, undefined, { signal });
        return "done";
      },
      finishRecovery: () => Promise.resolve(true),
    };
    const result = await worker.runCheckoutRecovery(worker.recoverySettings, deps);
    expect(result).toEqual({
      claimed: 8,
      done: 8,
      retry: 0,
      review: 0,
      oldestDueMs: 0,
    });
    expect(peak).toBeLessThanOrEqual(capacity);
    expect(leases.size).toBe(0);
  },
);
