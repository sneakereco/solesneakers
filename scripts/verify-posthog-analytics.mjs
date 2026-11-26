import { createRequire, registerHooks } from "node:module";
import { parseArgs } from "node:util";
import { register } from "tsx/cjs/api";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    mode: { type: "string" },
    environment: { type: "string" },
    "start-instant": { type: "string" },
    "end-instant": { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
  },
});
const { mode, environment } = values;
const require = createRequire(import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier,
      context,
    );
  },
});
register();
const feature = "../src/Modules/Analytics/Source/Features/";
const { readServerAnalyticsConfig } = require(feature + "Configuration/server-config.ts");
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
    !["reconcile", "transport"].includes(mode) ||
    !["staging", "production"].includes(environment)
  )
    throw Error();
  category = "configuration-unavailable";
  const config = readServerAnalyticsConfig(process.env);
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
  } else {
    const { observation } = await readHistoryEvidence(db, scope.datasetId);
    const result = await reconcileAnalyticsFacts(range, {
      datasetId: scope.datasetId,
      query,
      observation,
      source: async (dataset, start, end) => {
        const { data, error } = await db.rpc("analytics_reconciliation_snapshot", {
          p_dataset_id: dataset,
          p_limit: SNAPSHOT_LIMIT,
          p_start: start,
          p_end: end,
        });
        if (error) throw Error();
        return data;
      },
    });
    console.log(JSON.stringify({ mode, environment, project, ...result }));
    if (result.status !== "matched") process.exitCode = 1;
  }
} catch (e) {
  console.error(
    JSON.stringify({
      mode: ["reconcile", "transport"].includes(mode) ? mode : null,
      environment: ["staging", "production"].includes(environment) ? environment : null,
      status: "unavailable",
      category: e instanceof PostHogQueryError ? e.reason : category,
    }),
  );
  process.exitCode = 1;
}
