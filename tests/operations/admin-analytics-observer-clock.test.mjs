import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const databaseTime = "2026-11-27T14:00:00.123456+00:00";
const organization = "f68200e7-7bc9-4af4-90da-91f44344535f";
const projectKey = "phc_observerclocktestfixture";

function installProviderFixtures(
  databaseTime,
  clockResult,
  organization,
  projectKey,
  warehouse,
) {
  const calls = [];
  const clientTime = Date.parse(databaseTime) + 350;
  globalThis.Date = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clientTime]));
    }
    static now() {
      return clientTime;
    }
  };
  globalThis.fetch = async (input, init) => {
    const { origin, pathname } = new URL(input);
    switch (origin + pathname) {
      case `https://us.posthog.com/api/organizations/${organization}/projects/501/`:
        return Response.json({
          id: 501,
          organization,
          api_token: projectKey,
          anonymize_ips: true,
        });
      case "https://us.posthog.com/api/projects/501/events_retention/":
        calls.push({ step: "read-policy" });
        return Response.json({ retention_months: 12, retained_from: "2025-11-27" });
      case "https://db.example/rest/v1/rpc/analytics_observer_clock":
        calls.push({ step: "database-clock", args: JSON.parse(init.body) });
        return Response.json(clockResult);
      case "https://db.example/rest/v1/rpc/analytics_record_native_retention": {
        const args = JSON.parse(init.body);
        calls.push({ step: "record-policy", args });
        if (Date.parse(args.p_verified_at) > Date.parse(databaseTime))
          return Response.json(
            { code: "22023", message: "Invalid native retention metadata" },
            { status: 400 },
          );
        return Response.json(true);
      }
      case "https://db.example/rest/v1/rpc/analytics_native_probe":
        calls.push({ step: "request-marker" });
        throw Error("Stop fixture after checking retention and marker allocation order");
      case "https://db.example/rest/v1/rpc/analytics_refresh_claim":
        return Response.json({ prefix: "", token: "fixture-claim" });
      case "https://db.example/rest/v1/rpc/analytics_refresh_snapshot":
        return Response.json({
          observedAt: databaseTime,
          finance: [{ fact_id: "not-yet-synced" }],
          links: [],
        });
      case "https://db.example/rest/v1/rpc/analytics_refresh_finish":
        calls.push({ step: "finish-partition", args: JSON.parse(init.body) });
        return Response.json(true);
      case "https://redis.example/":
        return Response.json({
          result: JSON.parse(init.body)[0] === "eval" ? "b2s=" : 1,
        });
      case "https://us.posthog.com/api/projects/501/endpoints/sole_analytics_observe_finance/run/": {
        calls.push({ step: "read-finance" });
        if (warehouse === "query-error") return new Response(null, { status: 500 });
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
          "updated_at",
          "partition_rows",
        ];
        return Response.json({
          name: "sole_analytics_observe_finance",
          endpoint_version: 1,
          execution_id: "02ca5b65-a269-4c45-8d4a-0c74ff3ae670",
          columns,
          results:
            warehouse === "malformed"
              ? [
                  [
                    "sole-staging",
                    "staging",
                    "provider-only-row",
                    "invalid-revision",
                    "payment_attempt",
                    databaseTime,
                    databaseTime,
                    null,
                    null,
                    null,
                    "{}",
                    databaseTime,
                    1,
                  ],
                ]
              : [],
          hasMore: false,
        });
      }
      default:
        throw Error("Unexpected fixture request");
    }
  };
  process.on("exit", () => console.log(JSON.stringify(calls)));
}

function runWorker({ clockResult, source = "native", warehouse }) {
  const directory = mkdtempSync(join(tmpdir(), "sole-analytics-clock-"));
  const path = join(directory, "attestation.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        environment: "staging",
        projectId: "501",
        region: "https://us.posthog.com",
        activationInstant: "2026-11-27T13:00:00Z",
        geoIpDisabled: true,
        sourceAndDefinitionsVerified: true,
      }),
    );
    const fixture = `(${installProviderFixtures})(...${JSON.stringify([
      databaseTime,
      clockResult,
      organization,
      projectKey,
      warehouse,
    ])})`;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "data:text/javascript;base64," + Buffer.from(fixture).toString("base64"),
        "scripts/refresh-admin-analytics.mjs",
        "--environment",
        "staging",
        "--source",
        source,
        "--attestation",
        path,
      ],
      {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        env: {
          SystemRoot: process.env.SystemRoot,
          NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "staging",
          NEXT_PUBLIC_POSTHOG_ENABLED: "true",
          NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
          NEXT_PUBLIC_POSTHOG_PROJECT_KEY: projectKey,
          POSTHOG_API_HOST: "https://us.posthog.com",
          POSTHOG_PROJECT_ID: "501",
          POSTHOG_OWNER_STAGING_PROJECT_ID: "501",
          POSTHOG_OWNER_PRODUCTION_PROJECT_ID: "502",
          POSTHOG_OWNER_ORGANIZATION_ID: organization,
          POSTHOG_OPERATOR_API_KEY: "phx_operator_fixture_long_enough",
          POSTHOG_QUERY_API_KEY: "phx_query_fixture_long_enough",
          ANALYTICS_IDENTITY_SECRET: "fake-identity-secret-longer-than-32-bytes",
          NEXT_PUBLIC_SUPABASE_URL: "https://db.example",
          SUPABASE_SECRET_KEY: "fake-secret",
          UPSTASH_REDIS_REST_URL: "https://redis.example",
          UPSTASH_REDIS_REST_TOKEN: "fake-token",
        },
      },
    );
    assert.ifError(result.error);
    const calls = JSON.parse(result.stdout.trimEnd().split("\n").at(-1));
    return { code: result.status, calls };
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
}

test("retention uses database time captured before the provider read when the client is ahead", () => {
  const { code, calls } = runWorker({ clockResult: databaseTime });
  assert.equal(code, 1);
  assert.deepEqual(calls, [
    { step: "database-clock", args: { p_dataset_id: "sole-staging" } },
    { step: "read-policy" },
    {
      step: "record-policy",
      args: {
        p_dataset_id: "sole-staging",
        p_months: 12,
        p_retained_from: "2025-11-27",
        p_verified_at: databaseTime,
      },
    },
    { step: "request-marker" },
  ]);
});

test("invalid database time stops the native worker before reading the provider policy", () => {
  const { code, calls } = runWorker({ clockResult: "2026-11-27T14:00:00" });
  assert.equal(code, 1);
  assert.deepEqual(calls, [
    { step: "database-clock", args: { p_dataset_id: "sole-staging" } },
  ]);
});

for (const [warehouse, expected] of [
  ["missing-row", 75],
  ["malformed", 1],
  ["query-error", 1],
]) {
  test(`warehouse worker handles ${warehouse} without advancing the partition proof`, () => {
    const { code, calls } = runWorker({ source: "warehouse", warehouse });
    assert.deepEqual(calls, [
      { step: "read-finance" },
      {
        step: "finish-partition",
        args: {
          p_dataset_id: "sole-staging",
          p_token: "fixture-claim",
          p_result: "retry",
          p_observed_at: null,
        },
      },
    ]);
    assert.equal(code, expected);
  });
}

test("observer clock migration follows the deployment prefix and grants only service access", () => {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(directory).sort();
  const bootstrap = migrations.indexOf("20261127134000_analytics_schema_bootstrap.sql");
  const clock = migrations.findIndex((name) =>
    name.endsWith("_analytics_observer_clock.sql"),
  );
  assert.ok(bootstrap >= 0 && clock > bootstrap);
  assert.equal(
    migrations.filter((name) => name.startsWith(migrations[clock].slice(0, 14))).length,
    1,
  );
  const sql = readFileSync(new URL(migrations[clock], directory), "utf8");
  assert.match(sql, /security invoker set search_path\s*=\s*''/i);
  assert.match(
    sql,
    /when p_dataset_id in \('sole-staging', 'sole-production'\) then pg_catalog\.statement_timestamp\(\)/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.analytics_observer_clock\(text\)\s+from public, anon, authenticated, sole_analytics_staging_reader, sole_analytics_production_reader;/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.analytics_observer_clock\(text\) to service_role;/i,
  );
});
