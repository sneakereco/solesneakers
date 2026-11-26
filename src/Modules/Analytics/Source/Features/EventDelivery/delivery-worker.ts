import "server-only";
import type { FactRepository } from "../CommerceFacts/repository";
import type { OrderFact } from "../CommerceFacts/contract";
import type { TrackingContext } from "../VisitorMeasurement/contract";
import type {
  DeliveryFailure,
  DeliveryRepository,
  LeasedPublication,
} from "./delivery-repository";
import {
  captureBatch,
  captureTrackedPurchase,
  type CaptureDependencies,
  type PublishedEvent,
} from "./posthog-capture";

export type DeliveryDependencies = CaptureDependencies &
  DeliveryRepository &
  Pick<FactRepository, "getActivePurchaseContext">;
export type DrainResult = {
  claimed: number;
  delivered: number;
  failed: number;
  deferred: number;
};
class PublicationFailure extends Error {
  constructor(readonly failure: DeliveryFailure) {
    super(failure.reason);
  }
}
function businessEvent({ id, environment, fact }: LeasedPublication): PublishedEvent {
  const properties = {
    schema_version: 2 as const,
    storefront: "sole" as const,
    environment,
    dataset_id: fact.datasetId,
    fact_id: fact.factId,
    fact_revision: fact.revision,
    effective_at: fact.effectiveAt,
    recorded_at: fact.recordedAt,
    currency: fact.currency,
    buyer_key: fact.buyerKey,
    order_id: fact.orderId,
    fact_kind: fact.kind,
    payload: fact.payload,
  };
  // The transport revalidates the same kind/payload discriminated union at the wire boundary.
  return {
    uuid: id,
    event: "sole_analytics_fact_v2",
    timestamp: fact.effectiveAt,
    distinctId:
      "commerce:" +
      (fact.orderId ??
        (fact.kind === "payment_attempt"
          ? fact.payload.attemptId
          : fact.factId.split(":").at(-1))),
    properties: properties as PublishedEvent["properties"],
  };
}
type TrackingDependencies = CaptureDependencies &
  Pick<FactRepository, "getActivePurchaseContext"> & { signal?: AbortSignal };
export async function publishTrackedPurchase(
  fact: OrderFact,
  context: TrackingContext,
  deps: TrackingDependencies,
): Promise<"published" | "not-consented"> {
  if (!fact.orderId || fact.revision !== 1) return "not-consented";
  const current = await deps.getActivePurchaseContext(fact.datasetId, fact.orderId);
  if (!current || current.tracking.receiptId !== context.receiptId)
    return "not-consented";
  deps.signal?.throwIfAborted();
  const { visitorId, sessionId, device, discovery, purchaseSession } = current.tracking;
  const result = await captureTrackedPurchase(
    {
      visitorId,
      sessionId,
      device,
      discovery,
      purchaseSession,
      uuid: current.publicationId,
      timestamp: fact.effectiveAt,
      orderId: fact.orderId,
      datasetId: fact.datasetId,
    },
    deps,
  );
  if (result.status !== "accepted") throw new PublicationFailure(result);
  return "published";
}

export async function deliverAnalyticsBatch(
  deps: DeliveryDependencies,
  options: { limit: number; deadlineMs: number },
): Promise<DrainResult> {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    !Number.isFinite(options.deadlineMs) ||
    options.deadlineMs < 1
  )
    throw new RangeError("Invalid analytics drain bounds");
  const limit = Math.min(options.limit, 200),
    budget = Math.min(options.deadlineMs, 8000);
  const deadline = performance.now() + budget;
  const controller = new AbortController();
  const result: DrainResult = { claimed: 0, delivered: 0, failed: 0, deferred: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let claiming = false;
  const timeout = new Promise<DrainResult>((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (claiming) reject(new Error("Analytics claim timed out"));
      else
        resolve({
          ...result,
          deferred: result.claimed - result.failed - result.delivered,
        });
    }, budget);
  });
  const active = () => !controller.signal.aborted && performance.now() < deadline;
  const captureDeps = () => ({
    ...deps,
    signal: controller.signal,
    timeoutMs: Math.max(0, Math.floor(deadline - performance.now())),
    fetch: ((input, init) =>
      deps.fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal,
      })) as typeof fetch,
  });
  async function settle(job: LeasedPublication, failure?: DeliveryFailure) {
    if (!active()) return;
    try {
      const saved = failure
        ? await deps.failPublication(job.id, job.leaseToken, failure)
        : await deps.completePublication(job.id, job.leaseToken);
      if (!saved) result.deferred++;
      else if (!failure) result.delivered++;
      else if (failure.status === "permanent-failure" || job.attempt >= 8)
        result.failed++;
      else result.deferred++;
    } catch {
      result.deferred++;
    }
  }
  async function drain() {
    while (active() && result.claimed < limit) {
      const size = Math.min(50, limit - result.claimed);
      claiming = true;
      const jobs = await deps.claimPublications(size, 30, (counts) => {
        result.claimed += counts.failed + counts.deferred;
        result.failed += counts.failed;
        result.deferred += counts.deferred;
      });
      claiming = false;
      result.claimed += jobs.length;
      if (!jobs.length || !active()) break;
      const sent = await captureBatch(jobs.map(businessEvent), captureDeps());
      if (sent.status !== "accepted") {
        await Promise.all(jobs.map((job) => settle(job, sent)));
        break;
      }
      // Settle ordinary publications immediately. Keep optional lookups/sends bounded.
      const tracked = jobs.filter(
        (j) => j.fact.kind === "order" && j.fact.revision === 1 && j.fact.orderId,
      );
      const trackedIds = new Set(tracked.map((j) => j.id));
      await Promise.all(jobs.filter((j) => !trackedIds.has(j.id)).map((j) => settle(j)));
      let sharedFailure: DeliveryFailure | undefined;
      for (const job of tracked) {
        if (!active()) break;
        const fact = job.fact as OrderFact;
        try {
          const context = await deps.getActivePurchaseContext(
            fact.datasetId,
            fact.orderId!,
          );
          if (context && !sharedFailure && active())
            await publishTrackedPurchase(fact, context.tracking, captureDeps());
          // Accepted business delivery is complete when the current grant is absent.
          await settle(job, context ? sharedFailure : undefined);
        } catch (error) {
          if (
            error instanceof PublicationFailure &&
            error.failure.status !== "permanent-failure"
          ) {
            // Suppress further provider sends while continuing bounded receipt lookups.
            sharedFailure = error.failure;
          }
          await settle(
            job,
            error instanceof PublicationFailure
              ? error.failure
              : (sharedFailure ?? { status: "retryable", reason: "network" }),
          );
        }
      }
      if (jobs.length < size || result.deferred || result.failed) break;
    }
    return { ...result, deferred: result.claimed - result.delivered - result.failed };
  }
  try {
    return await Promise.race([drain(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
