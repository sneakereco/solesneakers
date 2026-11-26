import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTarget,
  validateResults,
  assertAttestation,
  manifestDigest,
} from "../shared/contracts.mjs";
import { targetFixture } from "./fixtures.mjs";
test("target requires positive staging identities, isolation denylist and budget", () => {
  const target = parseTarget(targetFixture());
  assert.match(target.digest, /^[a-f0-9]{64}$/);
  assert.equal(target.baseUrl, "https://load-fixture.example.test");
  for (const change of [
    { budget: undefined },
    { purpose: "production" },
    { baseUrl: "http://load-fixture.example.test" },
    { baseUrl: "https://user:password@load-fixture.example.test" },
    { baseUrl: "https://load-fixture.example.test?token=secret" },
    { accessToken: "secret" },
  ])
    assert.throws(() => parseTarget(targetFixture(change)));
});
test("production resource conflicts are rejected even with a staging label", () => {
  for (const mutate of [
    (t) => {
      t.baseUrl = "https://www.production.example.test";
    },
    (t) => {
      t.expected.projectId = "prj_production_fixture";
    },
    (t) => {
      t.resources.supabase.projectRef = "productionfixture";
    },
    (t) => {
      t.resources.redis.id = "redis_production_fixture";
    },
    (t) => {
      t.productionDenylist.redisIds = [];
    },
  ]) {
    const target = targetFixture();
    mutate(target);
    assert.throws(() => parseTarget(target));
  }
});
test("reject target redirect and changed commit before allowing writes", () => {
  const target = parseTarget(targetFixture());
  const attestation = {
    ...target.expected,
    baseUrl: target.baseUrl,
    resourceDigest: manifestDigest(target.resources),
    schema: target.migrationHeads,
    nonce: "one-use",
    providerMode: "simulated",
    capabilities: ["shopping", "specialty-claims"],
  };
  assert.doesNotThrow(() => assertAttestation(target, attestation));
  for (const change of [
    { commit: "b".repeat(40) },
    { baseUrl: "https://redirect.example.test" },
    { resourceDigest: "f".repeat(64) },
    { schema: [] },
  ])
    assert.throws(() => assertAttestation(target, { ...attestation, ...change }));
});
test("worker result validation rejects negative, absent and non-finite achieved work", () => {
  const result = {
    version: 1,
    runId: "run",
    workerId: "http-0",
    profile: "smoke",
    activeSamples: [{ at: 0, slots: 8 }],
    offered: 8,
    completed: 7,
    dropped: 0,
    interrupted: 0,
    operations: [],
    resources: [],
    errors: [],
  };
  assert.equal(validateResults(result).completed, 7);
  for (const change of [
    { dropped: -1 },
    { offered: Infinity },
    { activeSamples: [] },
    { completed: 9 },
    { workerId: undefined },
  ])
    assert.throws(() => validateResults({ ...result, ...change }));
});
