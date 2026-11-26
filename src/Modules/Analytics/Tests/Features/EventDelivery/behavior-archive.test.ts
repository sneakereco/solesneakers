import {
  compileBehaviorArchive,
  compileBehaviorHistorySql,
  behaviorReportAvailability,
} from "../../../Source/Features/EventDelivery/behavior-archive";
import { warehouseFreshness } from "../../../Source/Features/EventDelivery/history-source";
jest.mock("server-only", () => ({}), { virtual: true });
it("limits the SQL export to named fields, its activated environment and bounded overlap", () => {
  const scope = {
    datasetId: "sole-staging",
    environment: "staging",
    financialSource: "warehouse",
    activatedAt: "2026-10-01T00:00:00Z",
    schemaVersion: 2,
    behaviorArchiveCutoff: null,
  } as const;
  const sql = compileBehaviorArchive(scope);
  expect(sql).toContain("{data_interval_start} - INTERVAL 2 DAY");
  expect(sql).toContain("{data_interval_end}");
  expect(sql).toContain("2026-10-01T00:00:00Z");
  expect(sql).toContain("properties.environment='staging'");
  expect(sql).not.toMatch(
    /\bSELECT \*|\bproperties\s*(?:AS|,)|\bperson\.|\$ip|\$current_url|receipt_id|purchase_confirmed/i,
  );
  expect(() =>
    compileBehaviorArchive({ ...scope, datasetId: "sole-production" }),
  ).toThrow();
});
it("requires independent ingestion observations to establish source freshness", () => {
  const q = new Date("2026-11-01T12:00:00Z");
  expect(warehouseFreshness(null, q).status).toBe("unknown");
  expect(
    warehouseFreshness(
      { sourceFreshThrough: "2026-11-01T11:54:00Z", observedAt: q.toISOString() },
      q,
    ).status,
  ).toBe("lagging");
  expect(
    warehouseFreshness(
      { sourceFreshThrough: "2026-11-01T11:56:00Z", observedAt: q.toISOString() },
      q,
    ).status,
  ).toBe("current");
});
it("queries disjoint native/archive periods and deduplicates event UUIDs, with missing evidence unavailable", () => {
  const scope = {
    datasetId: "sole-staging",
    environment: "staging",
    financialSource: "warehouse",
    activatedAt: "2024-01-01T00:00:00Z",
    schemaVersion: 2,
    behaviorArchiveCutoff: "2026-01-01T00:00:00Z",
  } as const;
  const sql = compileBehaviorHistorySql(scope);
  expect(sql).toContain("timestamp >= parseDateTime64BestEffort('2026-01-01T00:00:00Z'");
  expect(sql).toContain("occurred_at < parseDateTime64BestEffort('2026-01-01T00:00:00Z'");
  expect(sql).toContain("PARTITION BY dataset_id,event_uuid");
  expect(
    behaviorReportAvailability(
      scope,
      { start: scope.activatedAt, end: scope.behaviorArchiveCutoff },
      { archive: [], native: [], observation: null },
    ).available,
  ).toBe(false);
  expect(
    compileBehaviorHistorySql({ ...scope, behaviorArchiveCutoff: null }),
  ).not.toContain("analytics_behavior_export");
});
