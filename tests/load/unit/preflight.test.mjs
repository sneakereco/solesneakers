import test from "node:test";
import assert from "node:assert/strict";
import { preflightRun, createControlClient } from "../operator/preflight.mjs";
import { targetFixture } from "./fixtures.mjs";
import { parseTarget, manifestDigest } from "../shared/contracts.mjs";
const secrets = {
  LOAD_TEST_SIGNING_KEY: "a".repeat(40),
  SUPABASE_SECRET_KEY: "secret",
  SUPABASE_DB_URL: "postgresql://postgres.loadfixture:secret@pooler.test/postgres",
  UPSTASH_REDIS_REST_TOKEN: "secret",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public",
};
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
      assert.ok(options.headers["x-load-test-control"]);
      return Response.json({ nonce: options.headers["x-load-test-nonce"] });
    },
  );
  await client("attest", {});
  assert.ok(called);
});
