import { pairingFingerprint } from "./check-analytics-deployment.mjs";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { requireAnalytics as require } from "./analytics-operator-runtime.mjs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    mode: { type: "string" },
    fixture: { type: "string" },
    environment: { type: "string" },
    "start-instant": { type: "string" },
    "end-instant": { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
  },
});
const { mode, environment } = values;
const feature = "../src/Modules/Analytics/Source/Features/";
const { pairOwnerProject } = require(feature + "Configuration/operator-pairing.ts");
const { resolveActiveDataset } = require(feature + "Configuration/dataset.ts");
const { createFactRepository } = require(feature + "CommerceFacts/repository.ts");
const { executePostHogQuery, PostHogQueryError } = require(
  feature + "Reporting/posthog-query.ts",
);
const { SNAPSHOT_LIMIT, reconciliationWindow } = require(
  feature + "EventDelivery/reconciliation-evidence.ts",
);
const { readHistoryEvidence } = require(feature + "EventDelivery/history-source.ts");
const { reconcileAnalyticsFacts, reconciliationEndpoint } = require(
  feature + "EventDelivery/reconcile.ts",
);
const { getDefaultCalendarRange, resolveCalendarRange } = require(
  feature + "ReportContract/calendar-range.ts",
);
let category = "invalid-arguments";
try {
  if (
    !["config", "reconcile", "transport", "queries", "journey"].includes(mode) ||
    (["queries", "journey"].includes(mode) && environment !== "staging") ||
    !["staging", "production"].includes(environment)
  )
    throw Error();
  let fixtures;
  if (mode === "queries" && values.fixture) {
    category = "invalid-fixture";
    const { validateQueryFixtures } = require("./analytics-query-fixtures.ts");
    fixtures = validateQueryFixtures(JSON.parse(readFileSync(values.fixture, "utf8")));
  }
  category = "owner-pairing-unavailable";
  const config = await pairOwnerProject(process.env, environment);
  if (mode === "config") {
    console.log(
      JSON.stringify({
        mode,
        environment,
        status: "paired-ip-discard-verified",
        pairingFingerprint: pairingFingerprint(config),
        captureEnabled: process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true",
      }),
    );
    process.exit(0);
  }
  if (
    !config ||
    config.environment !== environment ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY
  )
    throw Error();
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
      },
    },
  );
  const scope = await resolveActiveDataset(createFactRepository(db), environment);
  if (!scope || scope.financialSource !== "warehouse") throw Error();
  const now = () => new Date();
  const def = getDefaultCalendarRange(now());
  category = "invalid-range";
  const precise =
    values["start-instant"] !== undefined || values["end-instant"] !== undefined;
  if (precise && (values.from !== undefined || values.to !== undefined)) throw Error();
  const range = precise
    ? reconciliationWindow(values["start-instant"], values["end-instant"])
    : resolveCalendarRange(
        { ...def, from: values.from ?? def.from, to: values.to ?? def.to },
        now(),
      );
  const project =
    config.projectId.length <= 2 ? "***" : "***" + config.projectId.slice(-2);
  const query = (q) => executePostHogQuery(q, { config, now, fetch });
  const sourceSnapshot = async (dataset, start, end) => {
    const { data, error } = await db.rpc("analytics_reconciliation_snapshot", {
      p_dataset_id: dataset,
      p_limit: SNAPSHOT_LIMIT,
      p_start: start,
      p_end: end,
    });
    if (error) throw Error();
    return data;
  };
  category = "provider-unavailable";
  if (mode === "transport") {
    const data = await query({
      endpoint: reconciliationEndpoint.name,
      version: reconciliationEndpoint.version,
      variables: {
        dataset_id: scope.datasetId,
        start_inclusive: range.startInclusive,
        end_exclusive: range.endExclusive,
      },
      limit: 1,
      offset: 0,
    });
    if (
      data.hasMore ||
      data.columns.join(",") !== "visible_revisions,warehouse_facts" ||
      data.results.length !== 1 ||
      data.results[0].some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      throw Error();
    console.log(
      JSON.stringify({
        mode,
        environment,
        project,
        status: "endpoint-readable",
        queryAsOf: now().toISOString(),
      }),
    );
  } else if (mode === "journey") {
    category = "journey-evidence-unavailable";
    const { journeyEvidence, journeyEndpoint, verifyJourney } = require(
      feature + "EventDelivery/journey-evidence.ts",
    );
    const input = journeyEvidence.parse(JSON.parse(readFileSync(values.fixture, "utf8")));
    const observedRange = reconciliationWindow(input.start, input.end);
    if (
      Date.parse(input.browserClosedAt) < Date.parse(input.start) ||
      Date.parse(input.browserClosedAt) >= Date.parse(input.end)
    )
      throw Error();
    const def = journeyEndpoint(scope);
    const events = await query({
      endpoint: def.name,
      version: def.version,
      variables: {
        start_inclusive: input.start,
        end_exclusive: input.end,
        session_id: input.sessionId,
      },
      limit: 101,
      offset: 0,
    });
    verifyJourney(
      input,
      events,
      await sourceSnapshot(scope.datasetId, input.start, input.end),
    );
    const result = await reconcileAnalyticsFacts(observedRange, {
      datasetId: scope.datasetId,
      query,
      source: sourceSnapshot,
    });
    if (result.status !== "matched") throw Error();
    console.log(
      JSON.stringify({
        environment,
        mode,
        status: "consented-journey-and-published-order-refund-matched",
      }),
    );
  } else if (mode === "queries") {
    // The operator supplies independently expected DTOs for an isolated staging
    // fixture window. This mode has no API for creating fixtures or Endpoints.
    category = "fixture-unavailable";
    if (!fixtures || precise || values.from || values.to) throw Error();
    const { parseReportRequest } = require(feature + "ReportContract/filters.ts");
    const { executeCommerceReport } = require(feature + "Reporting/report-service.ts");
    for (const fixture of fixtures) {
      if (fixture.scenario === "corrected") {
        category = "correction-evidence-unavailable";
        const window = resolveCalendarRange(
          { from: fixture.from, to: fixture.to, timezone: def.timezone },
          now(),
        );
        const snapshot = await sourceSnapshot(
          scope.datasetId,
          window.startInclusive,
          window.endExclusive,
        );
        const { verifyFixtureCorrection } = require("./analytics-query-fixtures.ts");
        verifyFixtureCorrection(
          snapshot,
          scope.datasetId,
          window.startInclusive,
          window.endExclusive,
        );
      }
      for (const report of ["sales", "payments", "health"]) {
        category = "invalid-fixture";
        if (
          typeof fixture.from !== "string" ||
          typeof fixture.to !== "string" ||
          !fixture[report]
        )
          throw Error();
        const request = parseReportRequest(
          new URLSearchParams({
            report,
            from: fixture.from,
            to: fixture.to,
            compare: "true",
          }),
          now(),
        );
        category = "provider-unavailable";
        const actual = await executeCommerceReport(request, scope, query);
        category = "fixture-mismatch";
        if (!isDeepStrictEqual(actual, fixture[report])) throw Error();
      }
    }
    console.log(
      JSON.stringify({
        mode,
        environment,
        project,
        status: "hosted-commerce-fixture-matched",
        windows: fixtures.length,
        queryAsOf: now().toISOString(),
      }),
    );
  } else {
    const { observation } = await readHistoryEvidence(db, scope.datasetId);
    const result = await reconcileAnalyticsFacts(range, {
      datasetId: scope.datasetId,
      query,
      observation,
      source: sourceSnapshot,
    });
    console.log(JSON.stringify({ mode, environment, project, ...result }));
    if (result.status !== "matched") process.exitCode = 1;
  }
} catch (e) {
  console.error(
    JSON.stringify({
      mode: ["config", "reconcile", "transport", "queries", "journey"].includes(mode)
        ? mode
        : null,
      environment: ["staging", "production"].includes(environment) ? environment : null,
      status: "unavailable",
      category: e instanceof PostHogQueryError ? e.reason : category,
    }),
  );
  process.exitCode = 1;
}
