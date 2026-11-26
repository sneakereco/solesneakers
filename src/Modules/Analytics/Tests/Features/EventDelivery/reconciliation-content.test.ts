import { reconciliationWindow } from "../../../Source/Features/EventDelivery/reconciliation-evidence";
import {
  factPayloadSchemas,
  type OrderFact,
} from "../../../Source/Features/CommerceFacts/contract";
import { reconcileAnalyticsFacts } from "../../../Source/Features/EventDelivery/reconcile";
import { resolveCalendarRange } from "../../../Source/Features/ReportContract/calendar-range";
import { base, payloads } from "../CommerceFacts/fixtures";
import type { CompiledQuery } from "../../../Source/Features/Reporting/query-contract";
jest.mock("server-only", () => ({}), { virtual: true });
const range = resolveCalendarRange(
  { from: "2026-11-25", to: "2026-11-25", timezone: "America/New_York" },
  new Date("2026-11-26T12:00:00Z"),
);
const fact: OrderFact = {
  ...base,
  datasetId: "sole-staging",
  effectiveAt: "2026-11-25T18:00:00.000123Z",
  kind: "order",
  payload: factPayloadSchemas.order.parse(payloads.order),
};
const publication = "5e950aa9-c063-447d-a976-8e745990b17e",
  otherPublication = "57157ba8-04b9-484b-869f-d3f7889eb514",
  otherId = "241cb0d9-fe64-4c35-b703-dedf90548759";
const names = [
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
const rawNames = [
  "publication_id",
  "actor",
  "event_time",
  "storefront",
  "schema_version",
];
function row(f = fact): unknown[] {
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
    f.payload,
  ];
}
function raw(f = fact, id = publication): unknown[] {
  return [...row(f), id, "commerce:" + f.orderId, f.effectiveAt, "sole", 2];
}
type Row = unknown[];
function scenario(
  rawRows: Row[],
  warehouse: Row[],
  changes: {
    truncated?: boolean;
    rowTotal?: number;
    sourceCount?: number;
    missingSnapshot?: boolean;
    newRevision?: OrderFact;
  } = {},
) {
  const source = {
    facts: 1,
    revisions: changes.sourceCount ?? (changes.newRevision ? 2 : 1),
    pending: 0,
    leased: 0,
    failed: 0,
    oldestOutstandingAt: null,
  };
  function query(q: CompiledQuery) {
    if (q.endpoint === "sole_analytics_reconciliation")
      return Promise.resolve({
        columns: ["visible_revisions", "warehouse_facts"],
        results: [
          [
            new Set(rawRows.map((r) => r[2] + ":" + r[3])).size,
            new Set(warehouse.map((r) => r[2])).size,
          ],
        ],
        hasMore: false,
      });
    const isRaw = String(q.endpoint) === "sole_analytics_reconciliation_raw";
    const rows = isRaw ? rawRows : warehouse;
    return Promise.resolve({
      columns: [...names, ...(isRaw ? rawNames : []), "snapshot_rows"],
      results: rows.map((r) => [...r, changes.rowTotal ?? rows.length]),
      hasMore: changes.truncated ?? false,
    });
  }
  return reconcileAnalyticsFacts(range, {
    datasetId: fact.datasetId,
    source: () =>
      Promise.resolve(
        changes.missingSnapshot
          ? source
          : {
              ...source,
              publications: [
                ...(changes.newRevision
                  ? [{ publicationId: otherPublication, fact: changes.newRevision }]
                  : []),
                { publicationId: publication, fact },
              ],
            },
      ),
    query,
  });
}
it("finds missing and extra facts despite equal totals on both surfaces", async () => {
  const wrong = { ...fact, factId: otherId };
  const result = await scenario([raw(wrong, otherPublication)], [row(wrong)]);
  expect(result).toMatchObject({
    status: "mismatch",
    differences: { raw: { missing: 1, extra: 1 }, warehouse: { missing: 1, extra: 1 } },
  });
  expect(JSON.stringify(result)).not.toContain(otherId);
});
it("compares cents, nulls, original microseconds, UUIDs and latest revision", async () => {
  const changed = {
    ...fact,
    payload: {
      ...fact.payload,
      totalCollectedCents: fact.payload.totalCollectedCents + 1,
    },
  };
  expect(
    await scenario([raw(), raw(changed)], [row({ ...fact, revision: 2 })]),
  ).toMatchObject({
    status: "mismatch",
    differences: { raw: { conflicting: 1 }, warehouse: { conflicting: 1 } },
  });
  expect(
    await scenario(
      [raw(fact, otherPublication)],
      [row({ ...fact, effectiveAt: "2026-11-25T18:00:00.000124Z" })],
    ),
  ).toMatchObject({
    status: "mismatch",
    differences: { raw: { conflicting: 1 }, warehouse: { conflicting: 1 } },
  });
  expect(
    await scenario(
      [raw()],
      [row({ ...fact, payload: { ...fact.payload, taxCents: null } })],
    ),
  ).toMatchObject({ status: "mismatch", differences: { warehouse: { conflicting: 1 } } });
});
it("accepts duplicate observations, equivalent offsets and reordered JSON keys", async () => {
  const reordered = {
    ...fact,
    effectiveAt: "2026-11-25T13:00:00.000123-05:00",
    payload: Object.fromEntries(
      Object.entries(fact.payload).reverse(),
    ) as typeof fact.payload,
  };
  expect(await scenario([raw(reordered), raw()], [row(reordered), row()])).toMatchObject({
    status: "matched",
    differences: {
      raw: { missing: 0, extra: 0, conflicting: 0 },
      warehouse: { missing: 0, extra: 0, conflicting: 0 },
    },
  });
});
it.each([
  { truncated: true },
  { rowTotal: 3 },
  { sourceCount: 2001 },
  { missingSnapshot: true },
])(
  "marks incomplete evidence unavailable, including a missing page %#",
  async (change) => {
    expect(await scenario([raw()], [row()], change)).toMatchObject({
      status: "incomplete",
    });
  },
);
it("rejects malformed evidence without exposing data", async () => {
  const invalid = raw();
  invalid[10] = { email: "hidden" };
  const outcome = await scenario([invalid], [row()]);
  expect(outcome).toMatchObject({ status: "incomplete" });
  expect(JSON.stringify(outcome)).not.toContain("hidden");
});
it("detects a stale warehouse even when revisions arrive in a different order", async () => {
  const latest = { ...fact, revision: 3 };
  expect(
    await scenario([raw(latest, otherPublication), raw()], [row()], {
      newRevision: latest,
    }),
  ).toMatchObject({
    status: "mismatch",
    differences: { warehouse: { conflicting: 1 }, raw: { conflicting: 0 } },
  });
  expect(
    await scenario([raw(), raw(latest, otherPublication)], [row(latest)], {
      newRevision: latest,
    }),
  ).toMatchObject({ status: "matched" });
});
it("validates paired sub-day instants and keeps adjacent microsecond boundaries distinct", () => {
  const lower = "2026-11-25T09:00:00.000001-05:00",
    upper = "2026-11-25T14:00:00.000002Z";
  expect(reconciliationWindow(lower, upper)).toEqual({
    startInclusive: lower,
    endExclusive: upper,
  });
  expect(() => reconciliationWindow(upper, lower)).toThrow();
  expect(() => reconciliationWindow(lower, undefined)).toThrow();
  expect(() => reconciliationWindow("2026-11-25", upper)).toThrow();
});
it("detects a missing provider page with an inconsistent distinct-count summary", async () => {
  const noPage = await reconcileAnalyticsFacts(range, {
    datasetId: fact.datasetId,
    source: () =>
      Promise.resolve({
        revisions: 1,
        facts: 1,
        pending: 0,
        leased: 0,
        failed: 0,
        oldestOutstandingAt: null,
        publications: [{ publicationId: publication, fact }],
      }),
    query: (q) =>
      Promise.resolve(
        q.endpoint === "sole_analytics_reconciliation"
          ? {
              columns: ["visible_revisions", "warehouse_facts"],
              results: [[1, 1]],
              hasMore: false,
            }
          : {
              columns: [
                ...names,
                ...(q.endpoint === "sole_analytics_reconciliation_raw" ? rawNames : []),
                "snapshot_rows",
              ],
              results: [],
              hasMore: false,
            },
      ),
  });
  expect(noPage).toMatchObject({ status: "incomplete", reason: "missing-rows" });
});
it("reads the raw JSON integer tokens and rejects fractional cents that JavaScript would round to the same integer", async () => {
  const event = raw();
  event[3] = "1";
  event[15] = "2";
  event[10] = JSON.stringify(fact.payload);
  expect(await scenario([event], [row()])).toMatchObject({ status: "matched" });
  event[10] = String(event[10]).replace(
    '"totalCollectedCents":2100',
    '"totalCollectedCents":2100.00000000000000001',
  );
  expect(await scenario([event], [row()])).toMatchObject({ status: "incomplete" });
  event[10] = JSON.stringify(fact.payload);
  event[3] = "1.9";
  expect(await scenario([event], [row()])).toMatchObject({ status: "incomplete" });
});
it("advises a narrower interval when the source window count exceeds the cap", async () => {
  expect(await scenario([raw()], [row()], { rowTotal: 2001 })).toMatchObject({
    status: "incomplete",
    reason: "oversized-window",
    action: "narrow-interval",
  });
});
