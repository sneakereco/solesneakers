import {
  behaviorHistoryCoverage,
  financialHistorySource,
} from "../../../Source/Features/EventDelivery/history-source";
import { reconcileAnalyticsFacts } from "../../../Source/Features/EventDelivery/reconcile";
import { resolveCalendarRange } from "../../../Source/Features/ReportContract/calendar-range";
jest.mock("server-only", () => ({}), { virtual: true });
const range = resolveCalendarRange(
  { from: "2026-04-01", to: "2026-04-02", timezone: "America/New_York" },
  new Date("2026-11-01"),
);
const interval = { start: range.startInclusive, end: range.endExclusive };
it("preserves launch finance after raw expiry and identifies behavior coverage holes", () => {
  expect(financialHistorySource("warehouse")).toBe("analytics_financial_export");
  expect(financialHistorySource("events")).toBeNull();
  const gap = "2026-04-02T05:00:00.000Z";
  const cutoff = "2026-04-02T04:00:00.000Z";
  const native = { start: gap, end: interval.end };
  expect(
    behaviorHistoryCoverage(
      interval,
      cutoff,
      [{ start: interval.start, end: cutoff }],
      [native],
    ),
  ).toEqual([{ start: cutoff, end: gap }]);
  expect(behaviorHistoryCoverage(interval, cutoff, [], [])).toEqual([interval]);
});
it("reconciles distinct visible revisions and trusted warehouse latest facts separately from delivery backlog", async () => {
  const deps = {
    datasetId: "sole-staging",
    source: () =>
      Promise.resolve({
        revisions: 4,
        facts: 3,
        pending: 1,
        leased: 0,
        failed: 0,
        oldestOutstandingAt: interval.start,
      }),
    query: jest.fn().mockResolvedValue({
      columns: ["visible_revisions", "warehouse_facts"],
      results: [[3, 3]],
      hasMore: false,
    }),
  };
  expect(await reconcileAnalyticsFacts(range, deps)).toMatchObject({
    status: "mismatch",
    visibleRevisions: 3,
    warehouseFacts: 3,
  });
  deps.query.mockResolvedValue({
    columns: ["visible_revisions", "warehouse_facts"],
    results: [[4, 3]],
    hasMore: false,
  });
  expect(await reconcileAnalyticsFacts(range, deps)).toMatchObject({
    status: "matched",
    source: { pending: 1 },
    sourceFreshThrough: null,
  });
  deps.query.mockResolvedValue({
    columns: ["visible_revisions", "warehouse_facts"],
    results: [[0, 0]],
    hasMore: true,
  });
  await expect(reconcileAnalyticsFacts(range, deps)).rejects.toThrow();
});
