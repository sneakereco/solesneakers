import {
  checkObservation,
  linkObservation,
} from "../../../Source/Features/EventDelivery/observation-refresh";
import { readServerAnalyticsConfig } from "../../../Source/Features/Configuration/server-config";
import {
  executePostHogQuery,
  WAREHOUSE_OBSERVATION_EXECUTION,
} from "../../../Source/Features/Reporting/posthog-query";
import { createObservationQueryBudget } from "../../../Source/Features/Reporting/report-cache";
import {
  CSV_EXECUTION,
  ExportScopeError,
} from "../../../Source/Features/Reporting/query-contract";
import { mockFetch, now, validEnv } from "../Configuration/config-fixture";

const columns = [
  "dataset_id",
  "order_id",
  "active",
  "visitor_id",
  "session_id",
  "device",
  "discovery",
  "purchase_session",
  "updated_at",
];
const updated = "2026-11-26T12:00:00.123456Z";
const source = {
  dataset_id: "sole-staging",
  order_id: "order",
  active: false,
  visitor_id: null,
  session_id: null,
  device: null,
  discovery: null,
  purchase_session: null,
  updated_at: updated,
};
const page = (results: unknown[][]) => ({
  columns: [...columns, "partition_rows"],
  hasMore: false,
  results,
});
test("idle source proves an empty partition, while extra/missing/revoked links invalidate it", () => {
  expect(checkObservation([], page([]), "links")).toBe("matched");
  const row = ["sole-staging", "order", false, null, null, null, null, null, updated, 1];
  expect(checkObservation([source], page([row]), "links")).toBe("matched");
  expect(checkObservation([], page([row]), "links")).toBe("retry");
  expect(checkObservation([source], page([]), "links")).toBe("retry");
  expect(
    checkObservation([source], page([row.map((v, i) => (i === 2 ? true : v))]), "links"),
  ).toBe("retry");
  expect(
    checkObservation(
      [source],
      page([row.map((v, i) => (i === 8 ? "2026-11-26T12:00:00.123455Z" : v))]),
      "links",
    ),
  ).toBe("retry");
});
test("oversized source and provider partitions request refinement", () => {
  expect(checkObservation(Array(501).fill(source), page([]), "links")).toBe("split");
  expect(checkObservation([], { ...page([]), hasMore: true }, "links")).toBe("split");
});

const query = {
  endpoint: linkObservation.name,
  version: linkObservation.version,
  variables: { dataset_id: "sole-staging", prefix: "3" },
  limit: 501,
  offset: 0,
};
const truncated = {
  ...page([]),
  name: query.endpoint,
  endpoint_version: query.version,
  execution_id: "02ca5b65-a269-4c45-8d4a-0c74ff3ae670",
  truncated: true,
  debug: "provider details",
};
const config = readServerAnalyticsConfig(validEnv);

test("a declared warehouse truncation refines a below-limit partition through the real query budget", async () => {
  const fetch = mockFetch().mockResolvedValue(Response.json(truncated));
  const budget = createObservationQueryBudget(
    {
      project: "warehouse-observation-truncation-fixture",
      store: {
        read: () => Promise.resolve(null),
        lock: () => Promise.resolve(true),
        finish: async () => {},
        admit: () => Promise.resolve("ok"),
        release: async () => {},
        cooldown: async () => {},
      },
      execute: (invocation, timeoutMs) =>
        executePostHogQuery(invocation, {
          config,
          fetch,
          now,
          timeoutMs,
          mode: WAREHOUSE_OBSERVATION_EXECUTION,
        }),
    },
    performance.now() + 1000,
  );
  try {
    const result = await budget.execute(query);
    expect(result).toEqual({ ...page([]), truncated: true });
    expect(checkObservation([source], result, "links")).toBe("split");
  } finally {
    await budget.close();
  }
});

test.each([
  { endpoint_version: 2 },
  { name: "sole_analytics_observe_finance" },
  { results: [[1]] },
])("invalid warehouse observation metadata cannot request a split", async (patch) => {
  const fetch = mockFetch().mockResolvedValue(Response.json({ ...truncated, ...patch }));
  await expect(
    executePostHogQuery(query, {
      config,
      fetch,
      now,
      mode: WAREHOUSE_OBSERVATION_EXECUTION,
    }),
  ).rejects.toMatchObject({ reason: "invalid-response" });
});

test("only warehouse observation reads can accept declared truncation", async () => {
  const report = { ...query, endpoint: "sole_analytics_sales" } as const;
  const fetch = mockFetch().mockImplementation(() =>
    Promise.resolve(Response.json({ ...truncated, name: report.endpoint })),
  );
  await expect(executePostHogQuery(report, { config, fetch, now })).rejects.toMatchObject(
    {
      reason: "invalid-response",
    },
  );
  await expect(
    executePostHogQuery(report, {
      config,
      fetch,
      now,
      mode: WAREHOUSE_OBSERVATION_EXECUTION,
    }),
  ).rejects.toMatchObject({ reason: "invalid-response" });
  await expect(
    executePostHogQuery(report, { config, fetch, now, mode: CSV_EXECUTION }),
  ).rejects.toBeInstanceOf(ExportScopeError);
});
