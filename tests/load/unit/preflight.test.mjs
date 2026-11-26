import test from "node:test";
import assert from "node:assert/strict";
import { preflightRun, createControlClient } from "../operator/preflight.mjs";
import { targetFixture } from "./fixtures.mjs";
import { parseTarget, manifestDigest } from "../shared/contracts.mjs";
test("control setup pacing preserves the real API write policy without a retry burst", async () => {
  const times = [],
    target = parseTarget(targetFixture()),
    client = createControlClient(
      target,
      "k".repeat(40),
      async () => {
        times.push(Date.now());
        return Response.json({ ok: true });
      },
      { minimumIntervalMs: 30 },
    );
  await Promise.all([client("status"), client("status"), client("status")]);
  assert.ok(times[2] - times[0] >= 55);
});
const secrets = {
  LOAD_TEST_SIGNING_KEY: "a".repeat(40),
  SUPABASE_SECRET_KEY: "secret",
  SUPABASE_DB_URL: "postgresql://postgres.loadfixture:secret@pooler.test/postgres",
  UPSTASH_REDIS_REST_TOKEN: "secret",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public",
};
test("a request budget too small for the cohort fails before contacting staging", async () => {
  const raw = targetFixture();
  raw.budget.maxRequests = 100;
  let contacted = false;
  const result = await preflightRun(raw, "peak", {
    env: secrets,
    control: async () => {
      contacted = true;
    },
    tooling: async () => ({ status: "pass" }),
    resources: async () => ({ status: "pass" }),
  });
  assert.equal(result.allowed, false);
  assert.equal(contacted, false);
});
test("bulk load cannot send ten thousand shoppers to real Sandbox provider APIs", async () => {
  const target = parseTarget(targetFixture({ providerMode: "sandbox" }));
  const result = await preflightRun(target, "peak", {
    env: secrets,
    control: async () => ({
      ...target.expected,
      baseUrl: target.baseUrl,
      resourceDigest: manifestDigest(target.resources),
      schema: target.migrationHeads,
      providerMode: "sandbox",
      capabilities: ["shopping"],
    }),
    tooling: async () => ({ status: "pass" }),
    resources: async () => ({ status: "pass" }),
  });
  assert.equal(result.allowed, false);
});
test("missing secret or deployment drift prevents admission while missing specialty remains explicit", async () => {
  const target = parseTarget(targetFixture());
  const attest = {
    ...target.expected,
    baseUrl: target.baseUrl,
    resourceDigest: manifestDigest(target.resources),
    schema: target.migrationHeads,
    providerMode: "simulated",
    capabilities: ["shopping"],
    serverAt: Date.now(),
  };
  const deps = {
    env: secrets,
    control: async () => attest,
    tooling: async () => ({ status: "pass" }),
    resources: async () => ({ status: "pass" }),
  };
  let result = await preflightRun(target, "smoke", deps);
  assert.equal(result.allowed, true);
  assert.ok(
    result.coverage.some((x) => x.name === "specialty-claims" && x.status === "unmet"),
  );
  result = await preflightRun(target, "smoke", {
    ...deps,
    env: { ...secrets, SUPABASE_SECRET_KEY: "" },
  });
  assert.equal(result.allowed, false);
  result = await preflightRun(target, "smoke", {
    ...deps,
    control: async () => ({ ...attest, commit: "b".repeat(40) }),
  });
  assert.equal(result.allowed, false);
});
test("signed control refuses redirects and binds nonce and body without exposing keys", async () => {
  let called = false;
  const target = parseTarget(targetFixture());
  const client = createControlClient(
    target,
    secrets.LOAD_TEST_SIGNING_KEY,
    async (url, options) => {
      called = true;
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Origin, target.baseUrl);
      assert.ok(options.headers["x-load-test-control"]);
      return Response.json({ nonce: options.headers["x-load-test-nonce"] });
    },
  );
  await client("attest", {});
  assert.ok(called);
});
