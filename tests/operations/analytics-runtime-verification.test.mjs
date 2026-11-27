import test from "node:test";
import assert from "node:assert/strict";
import { verifyAnalyticsRuntime } from "../../scripts/verify-analytics-runtime.mjs";
import {
  analyticsConfigurationFingerprint,
  analyticsPublicBuildFingerprint,
} from "../../src/Modules/Analytics/Source/Features/Configuration/deployment-identity.ts";
const env = {
  VERCEL_PROJECT_ID: "prj_1WYPAufHsDO7qrv5FOhSynqeZski",
  CRON_SECRET: "synthetic-secret",
  DEPLOYMENT_URL: "https://soles-stg.vercel.app",
  NEXT_PUBLIC_POSTHOG_ENABLED: "true",
  NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "staging",
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
  NEXT_PUBLIC_POSTHOG_PROJECT_KEY: "phc_fixture",
  POSTHOG_QUERY_API_KEY: "synthetic-private-query",
  ANALYTICS_IDENTITY_SECRET: "synthetic-private-identity",
};
const identity = {
  enabled: true,
  environment: "staging",
  configurationSha256: analyticsConfigurationFingerprint(env),
  publicBuildSha256: analyticsPublicBuildFingerprint({
    environment: "staging",
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
    projectKey: env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
  }),
};
test("verifies effective private settings and compiled public settings with an authenticated read", async () => {
  let calls = 0;
  const result = await verifyAnalyticsRuntime("staging", env, async (url, options) => {
    calls++;
    assert.equal(url.pathname, "/api/cron/analytics");
    assert.equal(url.search, "?inspect=1");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + env.CRON_SECRET);
    return Response.json(identity);
  });
  assert.equal(calls, 1);
  assert.equal(result.runtimeVerified, true);
  assert.doesNotMatch(JSON.stringify(result), /synthetic|phc_fixture/);
});
for (const [name, change] of [
  [
    "stale runtime secret",
    {
      configurationSha256: analyticsConfigurationFingerprint({
        ...env,
        POSTHOG_QUERY_API_KEY: "different",
      }),
    },
  ],
  [
    "stale disabled public bundle",
    { publicBuildSha256: analyticsPublicBuildFingerprint(null) },
  ],
  ["wrong environment", { environment: "production" }],
  ["disabled server delivery", { enabled: false }],
])
  test("rejects " + name, async () => {
    await assert.rejects(
      verifyAnalyticsRuntime("staging", env, () =>
        Promise.resolve(Response.json({ ...identity, ...change })),
      ),
      /analytics_runtime_configuration_mismatch/,
    );
  });
test("rejects wrong project/origin before sending credentials", async () => {
  const transport = () => {
    assert.fail("unexpected request");
  };
  await assert.rejects(
    verifyAnalyticsRuntime("production", env, transport),
    /scope_invalid/,
  );
  await assert.rejects(
    verifyAnalyticsRuntime(
      "staging",
      { ...env, DEPLOYMENT_URL: "https://attacker.example" },
      transport,
    ),
    /origin_invalid/,
  );
});

test("preserves production's explicitly disabled fallback when public configuration is incomplete", async () => {
  const partial = {
    ...env,
    VERCEL_PROJECT_ID: "prj_ROOpjgDuPj2405JzeR1yG4iRtFMf",
    DEPLOYMENT_URL: "https://www.solesneakersnc.com",
    NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "production",
    NEXT_PUBLIC_POSTHOG_PROJECT_KEY: "",
  };
  const result = await verifyAnalyticsRuntime("production", partial, () =>
    Promise.resolve(
      Response.json({
        enabled: false,
        environment: null,
        configurationSha256: "unused_disabled_settings",
        publicBuildSha256: analyticsPublicBuildFingerprint(null),
      }),
    ),
  );
  assert.equal(result.enabled, false);
});
