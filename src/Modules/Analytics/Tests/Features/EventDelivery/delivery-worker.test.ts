import { reconcileAnalyticsFacts } from "../../../Source/Features/EventDelivery/reconcile";
import { executePostHogQuery } from "../../../Source/Features/Reporting/posthog-query";
import { resolveCalendarRange } from "../../../Source/Features/ReportContract/calendar-range";
import { randomUUID } from "node:crypto";
import type { PrivateTrackingContext } from "../../../Source/Features/CommerceFacts/repository";
import { deliverAnalyticsBatch } from "../../../Source/Features/EventDelivery/delivery-worker";
import type { LeasedPublication } from "../../../Source/Features/EventDelivery/delivery-repository";
import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";
import { mockFetch, validEnv, now } from "../Configuration/config-fixture";
import payloads from "../CommerceFacts/payloads.json";
jest.mock("server-only", () => ({}), { virtual: true });
const orderId = randomUUID();
const timestamp = "2026-09-09T00:00:00Z";
function job(revision = 1): LeasedPublication {
  return {
    id: randomUUID(),
    leaseToken: randomUUID(),
    leaseExpiresAt: "2026-12-01T00:00:00Z",
    attempt: 1,
    environment: "staging",
    fact: {
      datasetId: "sole-staging",
      factId: "order:" + orderId,
      orderId,
      revision,
      kind: "order",
      currency: "USD",
      effectiveAt: timestamp,
      recordedAt: timestamp,
      buyerKey: null,
      payload: {
        ...payloads.order,
        paymentMethod: "card",
        fulfillment: "ship",
        status: "paid",
      },
    },
  };
}
const config = readServerAnalyticsConfig(validEnv)!;
function setup(jobs: LeasedPublication[]) {
  const pending = [...jobs];
  const fetch = mockFetch().mockImplementation(() =>
    Promise.resolve(Response.json({ status: 1 })),
  );
  return {
    fetch,
    config,
    now,
    claimPublications: jest.fn((n: number) => Promise.resolve(pending.splice(0, n))),
    completePublication: jest.fn(() => Promise.resolve(true)),
    failPublication: jest.fn(() => Promise.resolve(true)),
    getActivePurchaseContext: jest
      .fn<
        Promise<{
          publicationId: string;
          tracking: PrivateTrackingContext;
        } | null>,
        [string, string]
      >()
      .mockResolvedValue(null),
  };
}
const opts = { limit: 200, deadlineMs: 8000 };
it.each([408, 429, 503])(
  "recovers an authoritative sale after a %s outage with the same publication and effective time",
  async (status) => {
    const original = job();
    const deps = setup([original]);
    deps.fetch.mockResolvedValueOnce(new Response(null, { status }));
    expect(await deliverAnalyticsBatch(deps, opts)).toEqual({
      claimed: 1,
      delivered: 0,
      failed: 0,
      deferred: 1,
    });
    const recovered = setup([{ ...original, attempt: 2, leaseToken: randomUUID() }]);
    expect(await deliverAnalyticsBatch(recovered, opts)).toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      deferred: 0,
    });
    const sent = (d: typeof deps) =>
      JSON.parse(String(d.fetch.mock.calls[0][1]?.body)).batch;
    expect(sent(deps)).toEqual(sent(recovered));
    expect(sent(deps)[0]).toMatchObject({
      uuid: original.id,
      timestamp,
      distinct_id: "commerce:" + orderId,
      properties: {
        fact_revision: 1,
        $geoip_disable: true,
        $process_person_profile: false,
      },
    });
    expect(deps.completePublication).not.toHaveBeenCalled();
  },
);
it("caps claims and capture batches, including late revisions", async () => {
  const deps = setup(Array.from({ length: 205 }, () => job(2)));
  expect(await deliverAnalyticsBatch(deps, { limit: 1000, deadlineMs: 10000 })).toEqual({
    claimed: 200,
    delivered: 200,
    failed: 0,
    deferred: 0,
  });
  expect(
    deps.fetch.mock.calls.map(([, r]) => JSON.parse(String(r?.body)).batch.length),
  ).toEqual([50, 50, 50, 50]);
  expect(deps.getActivePurchaseContext).not.toHaveBeenCalled();
});
it("stops claiming on a configuration failure and reports stale acknowledgements as deferred", async () => {
  const deps = setup(Array.from({ length: 53 }, () => job(2)));
  deps.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
  expect((await deliverAnalyticsBatch(deps, opts)).deferred).toBe(50);
  expect(deps.claimPublications).toHaveBeenCalledTimes(1);
  const lost = setup([job(2)]);
  lost.completePublication.mockResolvedValue(false);
  expect((await deliverAnalyticsBatch(lost, opts)).deferred).toBe(1);
});
it("rechecks consent on each replay and never includes the private receipt", async () => {
  const original = job();
  const deps = setup([original]);
  const link = {
    publicationId: randomUUID(),
    tracking: {
      receiptId: randomUUID(),
      visitorId: randomUUID(),
      sessionId: randomUUID(),
      device: "desktop" as const,
      discovery: null,
      purchaseSession: null,
    },
  };
  deps.getActivePurchaseContext.mockResolvedValue(link);
  await deliverAnalyticsBatch(deps, opts);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  const body = String(deps.fetch.mock.calls[1][1]?.body);
  expect(body).not.toContain(link.tracking.receiptId);
  expect(JSON.parse(body).batch[0]).toMatchObject({
    event: "purchase_confirmed",
    timestamp,
    uuid: link.publicationId,
    distinct_id: link.tracking.visitorId,
    properties: { $session_id: link.tracking.sessionId },
  });
  const revoked = setup([original]);
  await deliverAnalyticsBatch(revoked, opts);
  expect(revoked.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(revoked.fetch.mock.calls)).not.toContain(link.tracking.sessionId);
});
it("bounds a stalled claim and makes no later provider call", async () => {
  const deps = setup([]);
  deps.claimPublications.mockImplementation(() => new Promise(() => {}));
  await expect(
    deliverAnalyticsBatch(deps, { limit: 50, deadlineMs: 15 }),
  ).rejects.toThrow();
  expect(deps.fetch).not.toHaveBeenCalled();
});
it("reconciles replay after the provider received a batch whose acknowledgement was lost", async () => {
  const versions = [job(), job(2)];
  const first = setup(versions);
  const seen = new Map<string, number>();
  function ingest(body: unknown) {
    const { batch } = JSON.parse(String(body));
    for (const e of batch) seen.set(e.uuid, e.properties.fact_revision);
  }
  first.fetch.mockImplementation((_, request) => {
    ingest(request?.body);
    return Promise.resolve(new Response(null, { status: 503 }));
  });
  expect((await deliverAnalyticsBatch(first, opts)).deferred).toBe(2);
  // Durable source and lease reclamation survive without a browser.
  const recovery = setup(
    versions.map((j) => ({ ...j, attempt: 2, leaseToken: randomUUID() })),
  );
  recovery.fetch.mockImplementation((_, request) => {
    ingest(request?.body);
    return Promise.resolve(Response.json({ status: 1 }));
  });
  expect((await deliverAnalyticsBatch(recovery, opts)).delivered).toBe(2);
  const provider = mockFetch().mockImplementation(() =>
    Promise.resolve(
      Response.json({
        name: "sole_analytics_reconciliation",
        execution_id: randomUUID(),
        endpoint_version: 1,
        columns: ["visible_revisions", "warehouse_facts"],
        results: [[seen.size, 1]],
        hasMore: false,
      }),
    ),
  );
  const range = resolveCalendarRange(
    { from: "2026-09-08", to: "2026-09-09", timezone: "America/New_York" },
    new Date("2026-11-01"),
  );
  const report = await reconcileAnalyticsFacts(range, {
    datasetId: "sole-staging",
    source: () =>
      Promise.resolve({
        revisions: 2,
        facts: 1,
        pending: 0,
        leased: 0,
        failed: 0,
        oldestOutstandingAt: null,
      }),
    query: (q) => executePostHogQuery(q, { config, fetch: provider, now }),
  });
  expect(report).toMatchObject({
    status: "matched",
    visibleRevisions: 2,
    warehouseFacts: 1,
    freshness: "unknown",
  });
  expect(provider.mock.calls[0][0]).toBe(
    config.apiHost +
      "/api/projects/" +
      config.projectId +
      "/endpoints/sole_analytics_reconciliation/run/",
  );
});
