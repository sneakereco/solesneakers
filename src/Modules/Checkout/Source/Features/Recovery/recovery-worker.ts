import { log } from "@/lib/utils/log";
import { checkoutAdmissionBudgets } from "../Operations/admission";
import type {
  CheckoutDependency,
  CheckoutDependencyLeaseRepository,
} from "./dependency-lease";
import type { CheckoutRecoveryRepository } from "./recovery-repository";
import type { RecoveryJob } from "./recovery-contract";
import {
  SquareEvidenceConflict,
  SquareTerminalCaptureConflict,
} from "../Payments/payment-facts";

export const recoverySettings = {
  deadlineMs: 45000,
  batchSize: 50,
  concurrency: checkoutAdmissionBudgets?.providers.square ?? 4,
};
export type WorkerOptions = typeof recoverySettings;
export type DependencyLeases = Pick<
  CheckoutDependencyLeaseRepository,
  "acquireDependencyLease" | "releaseDependencyLease"
>;
export type RecoveryDisposition = "done" | "retry" | "review";
export type RecoveryWorkerDependencies = Pick<
  CheckoutRecoveryRepository,
  "claimRecovery" | "finishRecovery"
> &
  DependencyLeases & {
    sweep(): Promise<void>;
    oldestDueMs(): Promise<number>;
    process(
      job: RecoveryJob,
      signal: AbortSignal,
    ): Promise<RecoveryDisposition | "deferred">;
  };

export function deadlineFetch(
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    signal.throwIfAborted();
    const original =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return transport(input, {
      ...init,
      signal: original ? AbortSignal.any([signal, original]) : signal,
    });
  };
}

export async function withDependency<T>(
  leases: DependencyLeases,
  dependency: CheckoutDependency,
  stop: number,
  work: (s: AbortSignal) => Promise<T>,
): Promise<{ value: T } | null> {
  if (Date.now() >= stop) return null;
  const token = await leases.acquireDependencyLease({
    dependency,
    limit: 4,
    leaseSeconds: 120,
  });
  if (!token) return null;
  try {
    const duration = Math.min(10000, stop - Date.now());
    if (duration <= 0) return null;
    const signal = AbortSignal.timeout(duration);
    // Await actual completion. The transport receives this same signal on every request.
    return { value: await work(signal) };
  } finally {
    await leases.releaseDependencyLease(token);
  }
}

// Claims have committed before a lane starts. An invocation never leaves its
// unstarted jobs waiting for a full lease when its processing budget runs out.
export async function drainBatches<T>(
  options: WorkerOptions,
  claim: (n: number) => Promise<T[]>,
  process: (item: T, stop: number) => Promise<void>,
) {
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 50 ||
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 4 ||
    !Number.isInteger(options.deadlineMs) ||
    options.deadlineMs < 1 ||
    options.deadlineMs > 45000
  )
    throw Error("invalid_worker_options");
  const stop = Date.now() + options.deadlineMs;
  while (Date.now() < stop) {
    const rows = await claim(options.batchSize);
    if (!rows.length) return;
    let next = 0;
    const lane = async () => {
      while (next < rows.length) {
        const row = rows[next++];
        await process(row, stop);
      }
    };
    const lanes = await Promise.allSettled(
      Array.from({ length: Math.min(options.concurrency, rows.length) }, lane),
    );
    for (const result of lanes) if (result.status === "rejected") throw result.reason;
  }
}

export async function runCheckoutRecovery(
  options: WorkerOptions,
  deps: RecoveryWorkerDependencies,
) {
  const summary = { claimed: 0, done: 0, retry: 0, review: 0, oldestDueMs: 0 };
  const started = Date.now();
  await deps.sweep();
  const remaining = options.deadlineMs - (Date.now() - started);
  if (remaining > 0)
    await drainBatches(
      { ...options, deadlineMs: remaining },
      (n) =>
        deps.claimRecovery({
          limit: n,
          leaseSeconds: 120,
          now: new Date().toISOString(),
        }),
      async (job, stop) => {
        summary.claimed++;
        let result: RecoveryDisposition = "retry";
        let reason = "dependency_busy";
        try {
          const operation = await withDependency(deps, "square", stop, (signal) =>
            deps.process(job, signal),
          );
          if (operation?.value === "deferred") reason = "awaiting_receipt";
          else if (operation) {
            result = operation.value;
            reason = result === "review" ? "inquiry_review" : "inquiry_unresolved";
          }
        } catch (error) {
          if (error instanceof SquareTerminalCaptureConflict) {
            result = "review";
            reason = "square_terminal_capture_conflict";
          } else if (error instanceof SquareEvidenceConflict) {
            result = "review";
            reason = "square_evidence_conflict";
          } else reason = "recovery_unavailable";
        }
        if (
          result === "retry" &&
          reason === "inquiry_unresolved" &&
          job.unresolvedObservations >= 11
        ) {
          result = "review";
        }
        const base = Math.min(300000, 5000 * 2 ** Math.min(6, job.attempts - 1));
        const delay = Math.min(300000, Math.round(base + (Math.random() * base) / 4));
        const owned = await deps.finishRecovery({
          id: job.id,
          leaseToken: job.leaseToken,
          result,
          reason: result === "done" ? null : reason,
          ...(result === "retry"
            ? { nextAttemptAt: new Date(Date.now() + delay).toISOString() }
            : {}),
        });
        log({
          level: owned && result === "done" ? "info" : "warn",
          layer: "job",
          message: owned ? "checkout_worker" : "checkout_lease",
          operation: "recovery",
          outcome: owned ? result : "lost",
          orderId: job.orderId,
        });
        if (owned) summary[result]++;
      },
    );
  summary.oldestDueMs = await deps.oldestDueMs();
  return summary;
}
