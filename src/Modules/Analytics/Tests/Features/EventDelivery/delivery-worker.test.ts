import type { PublishedEvent } from "../../../Source/Features/EventDelivery/posthog-capture";
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
  type WireEvent = {
    uuid: string;
    distinct_id: string;
    timestamp: string;
    properties: PublishedEvent["properties"];
  };
  const seen = new Map<string, WireEvent>();
  function ingest(body: unknown) {
    const { batch } = JSON.parse(String(body));
    for (const e of batch as WireEvent[]) seen.set(e.uuid, e);
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
  const provider = mockFetch().mockImplementation((url) => {
    const name = String(url).split("/").at(-3);
    const columns = [
      "dataset_id",
      "environment",
      "fact_id",
      "revision",
      "kind",
      "effective_at",
      "recorded_at",
      "currency",
      "order_id",
      "buyer_key",
      "payload",
    ];
    function factRow(f: LeasedPublication["fact"]) {
      return [
        f.datasetId,
        "staging",
        f.factId,
        f.revision,
        f.kind,
        f.effectiveAt,
        f.recordedAt,
        f.currency,
        f.orderId,
        f.buyerKey,
        JSON.stringify(f.payload),
      ];
    }
    let packet: { columns: string[]; results: unknown[][] };
    if (name === "sole_analytics_reconciliation_raw") {
      packet = {
        columns: [
          ...columns,
          "publication_id",
          "actor",
          "event_time",
          "storefront",
          "schema_version",
          "snapshot_rows",
        ],
        results: Array.from(seen.values(), (e) => {
          const p = e.properties;
          return [
            p.dataset_id,
            p.environment,
            p.fact_id,
            p.fact_revision,
            p.fact_kind,
            p.effective_at,
            p.recorded_at,
            p.currency,
            p.order_id,
            p.buyer_key,
            JSON.stringify(p.payload),
            e.uuid,
            e.distinct_id,
            e.timestamp,
            p.storefront,
            p.schema_version,
            seen.size,
          ];
        }),
      };
    } else if (name === "sole_analytics_reconciliation_warehouse") {
      packet = {
        columns: [...columns, "snapshot_rows"],
        results: [[...factRow(versions[1].fact), 1]],
      };
    } else {
      packet = {
        columns: ["visible_revisions", "warehouse_facts"],
        results: [[seen.size, 1]],
      };
    }
    return Promise.resolve(
      Response.json({
        name,
        execution_id: randomUUID(),
        endpoint_version: name === "sole_analytics_reconciliation" ? 1 : 2,
        ...packet,
        hasMore: false,
      }),
    );
  });
  const range = resolveCalendarRange(
    { from: "2026-09-08", to: "2026-09-09", timezone: "America/New_York" },
    new Date("2026-11-01"),
  );
  const report = await reconcileAnalyticsFacts(range, {
    datasetId: "sole-staging",
    source: () =>
      Promise.resolve({
        publications: versions.map((j) => ({ publicationId: j.id, fact: j.fact })),
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
it.each([429, 401, 503])(
  "stops optional sends across all remaining leases on shared %s failure",
  async (status) => {
    const jobs = Array.from({ length: 5 }, () => {
      const next = job();
      const uniqueOrderId = randomUUID();
      return {
        ...next,
        fact: { ...next.fact, orderId: uniqueOrderId, factId: "order:" + uniqueOrderId },
      };
    });
    jobs[4].attempt = 8;
    const deps = setup(jobs);
    deps.getActivePurchaseContext.mockResolvedValue({
      publicationId: randomUUID(),
      tracking: {
        receiptId: randomUUID(),
        visitorId: randomUUID(),
        sessionId: randomUUID(),
        device: "desktop",
        discovery: null,
        purchaseSession: null,
      },
    });
    deps.fetch
      .mockResolvedValueOnce(Response.json({ status: 1 }))
      .mockResolvedValueOnce(
        new Response(null, { status, headers: { "Retry-After": "90" } }),
      );
    expect(await deliverAnalyticsBatch(deps, opts)).toEqual({
      claimed: 5,
      delivered: 0,
      failed: 1,
      deferred: 4,
    });
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.getActivePurchaseContext).toHaveBeenCalledTimes(6);
    const failure =
      status === 401
        ? { status: "configuration-failure", reason: "unauthorized" }
        : {
            status: "retryable",
            reason: status === 429 ? "rate-limited" : "provider-unavailable",
            retryAfterMs: 90000,
          };
    for (const j of jobs)
      expect(deps.failPublication).toHaveBeenCalledWith(j.id, j.leaseToken, failure);
    expect(deps.claimPublications).toHaveBeenCalledTimes(1);
  },
);
it.each([1, 8])(
  "completes an accepted order without a current purchase receipt after another order's 429 (attempt %i)",
  async (attempt) => {
    const consented = job(),
      noReceipt = job(),
      secondOrder = randomUUID();
    noReceipt.fact = {
      ...noReceipt.fact,
      orderId: secondOrder,
      factId: "order:" + secondOrder,
    };
    noReceipt.attempt = attempt;
    const deps = setup([consented, noReceipt]);
    const tracking = {
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
    // The real joined lookup returns null for both missing and revoked grants.
    deps.getActivePurchaseContext.mockImplementation((_dataset, id) =>
      Promise.resolve(id === consented.fact.orderId ? tracking : null),
    );
    deps.fetch
      .mockResolvedValueOnce(Response.json({ status: 1 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "90" } }),
      );
    expect(await deliverAnalyticsBatch(deps, opts)).toEqual({
      claimed: 2,
      delivered: 1,
      deferred: 1,
      failed: 0,
    });
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.getActivePurchaseContext).toHaveBeenCalledWith(
      noReceipt.fact.datasetId,
      secondOrder,
    );
    expect(deps.completePublication).toHaveBeenCalledWith(
      noReceipt.id,
      noReceipt.leaseToken,
    );
    expect(deps.failPublication).toHaveBeenCalledTimes(1);
    expect(deps.failPublication).toHaveBeenCalledWith(
      consented.id,
      consented.leaseToken,
      { status: "retryable", reason: "rate-limited", retryAfterMs: 90000 },
    );
  },
);
