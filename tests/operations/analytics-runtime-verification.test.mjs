import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyAnalyticsRuntime,
  vercelAnalyticsTransport,
} from "../../scripts/verify-analytics-runtime.mjs";
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

const cliEnv = {
  ...env,
  VERCEL_TOKEN: "synthetic-vercel-credential",
  VERCEL_ORG_ID: "team_yj8Rl9ibCXwtdttRrYPhnLcD",
};
test("authenticates the exact protected deployment through Vercel without forwarding the CLI token as a curl argument", async () => {
  let calls = 0;
  const transport = vercelAnalyticsTransport(cliEnv, async (command, args, options) => {
    calls++;
    assert.equal(command, "vercel");
    assert.deepEqual(args.slice(0, 4), [
      "curl",
      env.DEPLOYMENT_URL + "/api/cron/analytics?inspect=1",
      "--scope",
      cliEnv.VERCEL_ORG_ID,
    ]);
    assert.ok(args.includes("Authorization: Bearer " + env.CRON_SECRET));
    assert.ok(args.includes("--fail"));
    assert.ok(args.includes("--max-redirs"));
    for (const unsafe of [
      "--token",
      cliEnv.VERCEL_TOKEN,
      "--location",
      "-L",
      "--config",
      "--next",
      "--yes",
    ])
      assert.equal(args.includes(unsafe), false);
    assert.equal(options.env.VERCEL_TOKEN, cliEnv.VERCEL_TOKEN);
    assert.ok(options.timeout <= 45000);
    return { stdout: JSON.stringify(identity) + "\n200" };
  });
  assert.equal(
    (await verifyAnalyticsRuntime("staging", cliEnv, transport)).runtimeVerified,
    true,
  );
  assert.equal(calls, 1);
});
test("keeps provider process errors and credential-bearing output out of verification failures", async () => {
  const transport = vercelAnalyticsTransport(cliEnv, () => {
    throw Error("private " + cliEnv.VERCEL_TOKEN + " " + env.CRON_SECRET);
  });
  await assert.rejects(verifyAnalyticsRuntime("staging", cliEnv, transport), (error) => {
    assert.equal(error.message, "analytics_runtime_inspection_unavailable");
    assert.doesNotMatch(String(error), /synthetic|private/);
    return true;
  });
});
test("rejects invalid protected-access credentials before launching a process", () => {
  for (const candidate of [
    { ...cliEnv, VERCEL_TOKEN: "" },
    { ...cliEnv, VERCEL_ORG_ID: "team_other" },
  ])
    assert.throws(
      () => vercelAnalyticsTransport(candidate, () => assert.fail("unexpected process")),
      /scope_invalid/,
    );
});
test("keeps project and origin validation ahead of authenticated CLI access", async () => {
  const transport = vercelAnalyticsTransport(cliEnv, () =>
    assert.fail("unexpected process"),
  );
  await assert.rejects(
    verifyAnalyticsRuntime("production", cliEnv, transport),
    /scope_invalid/,
  );
  await assert.rejects(
    verifyAnalyticsRuntime(
      "staging",
      { ...cliEnv, DEPLOYMENT_URL: "https://attacker.example" },
      transport,
    ),
    /origin_invalid/,
  );
});
test("does not count redirects or malformed CLI output as a verified deployment", async () => {
  for (const stdout of [
    "redirect\n302",
    JSON.stringify(identity),
    JSON.stringify(identity) + "\ninvalid",
  ]) {
    const transport = vercelAnalyticsTransport(cliEnv, async () => ({ stdout }));
    await assert.rejects(
      verifyAnalyticsRuntime("staging", cliEnv, transport),
      /inspection_unavailable/,
    );
  }
});
