import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import {
  assertLoadTarget,
  validateManifestIdentity,
  validateCredentialArtifact,
} from "../../scripts/load/specialty-fixtures.mjs";
import {
  dispatchBurst,
  qualifyReport,
  prepareHttpActors,
  sendLoadRequest,
} from "../../scripts/load/specialty-claims.mjs";
const local = {
  target: "local",
  origin: "http://localhost:3000",
  project: "specialty-local",
  databaseUrl: "postgresql://postgres:postgres@127.0.0.1:64332/specialty_test_load",
};
test("load target guard rejects production, wrong database/project and supplied real prizes", async () => {
  await assertLoadTarget(local);
  for (const change of [
    { target: "production" },
    { origin: "https://solesneakers.com" },
    { databaseUrl: "postgresql://x:x@localhost:64332/postgres" },
    { project: "production" },
    { productIds: [randomUUID()] },
  ])
    await assert.rejects(assertLoadTarget({ ...local, ...change }));
  await assert.rejects(
    assertLoadTarget({
      target: "staging",
      origin: "https://staging.example.invalid",
      project: "ref",
    }),
    /staging/i,
  );
});
test("changed manifests, missing marker and cleanup outside namespace are refused", () => {
  const runId = randomUUID(),
    manifest = {
      runId,
      origin: local.origin,
      project: local.project,
      databaseIdentity: "specialty_test_load",
      campaignSlug: "black-friday-2026-load-" + runId,
      campaignId: randomUUID(),
      productIds: [randomUUID()],
      marker: "sole-specialty-load-v1",
      privateCredentialFile: "owned/" + runId + "/actors.json",
    };
  validateManifestIdentity(manifest, structuredClone(manifest));
  for (const change of [
    { marker: null },
    { campaignSlug: "black-friday-2026" },
    { productIds: [randomUUID()] },
    { privateCredentialFile: "../../real/actors.json" },
  ])
    assert.throws(() => validateManifestIdentity({ ...manifest, ...change }, manifest));
});
test("barrier starts 1000 independent requests before any response completes", async () => {
  let release,
    started = 0;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const result = dispatchBurst(
    Array.from({ length: 1000 }, (_, i) => i),
    async () => {
      started++;
      await hold;
      return { status: 200 };
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 1000);
  release();
  const run = await result;
  assert.equal(run.maxInFlight, 1000);
  assert.equal(run.responses.length, 1000);
  assert.ok(run.dispatchWindowMs <= 1000);
});
test("credential artifacts are integrity bound and cannot redirect submissions to other prizes", () => {
  const productId = randomUUID(),
    actors = [{ payload: { productId } }],
    raw = JSON.stringify(actors);
  const manifest = {
    requestCount: 1,
    productIds: [productId],
    credentialsSha256: createHash("sha256").update(raw).digest("hex"),
  };
  assert.deepEqual(validateCredentialArtifact(manifest, raw), actors);
  assert.throws(() => validateCredentialArtifact(manifest, raw + " "));
  const foreign = JSON.stringify([{ payload: { productId: randomUUID() } }]);
  assert.throws(() =>
    validateCredentialArtifact(
      {
        ...manifest,
        credentialsSha256: createHash("sha256").update(foreign).digest("hex"),
      },
      foreign,
    ),
  );
});
const good = () => ({
  scenario: "hot-one",
  actorCount: 1000,
  requestCount: 1000,
  outcomes: {
    won: 1,
    soldOut: 999,
    alreadyClaimed: 0,
    retryable: 0,
    unresolved: 0,
    unexpectedErrors: 0,
  },
  latency: { p95Ms: 100, p99Ms: 500 },
  maxResolutionMs: 600,
  generator: { dispatchWindowMs: 100, maxInFlight: 1000 },
  reconciliation: {
    winnerCount: 1,
    remainingStock: 0,
    duplicateIdentities: 0,
    ordinaryPrizeOrderItems: 0,
    negativeStock: false,
  },
  expected: { winners: 1, remainingStock: 0 },
});
test("qualification rejects throttled, slow, queued, unresolved and inconsistent runs", () => {
  assert.deepEqual(qualifyReport(good()), []);
  for (const change of [
    { outcomes: { ...good().outcomes, won: 0, soldOut: 0, retryable: 1000 } },
    { latency: { p95Ms: 3001, p99Ms: 500 } },
    { generator: { dispatchWindowMs: 1001, maxInFlight: 1000 } },
    { generator: { dispatchWindowMs: 100, maxInFlight: 10 } },
    { outcomes: { ...good().outcomes, unresolved: 1 } },
    { reconciliation: { ...good().reconciliation, winnerCount: 2 } },
  ])
    assert.ok(qualifyReport({ ...good(), ...change }).length);
});
test("replayed requests distinguish one unique claimant from 1000 successful responses", () => {
  const report = {
    ...good(),
    scenario: "replayed-attempt",
    actorCount: 1,
    outcomes: { ...good().outcomes, won: 1000, soldOut: 0 },
  };
  assert.deepEqual(qualifyReport(report), []);
});
test("1000 preconnected HTTP actors reach a real server before any response is released", async () => {
  const pending = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    pending.push(res);
    req.resume();
    if (pending.length === 1000)
      for (const response of pending) response.end('{"ok":true}');
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let agents = [];
  try {
    const origin = "http://127.0.0.1:" + server.address().port;
    agents = await prepareHttpActors(origin, 1000);
    const run = await dispatchBurst(agents, (agent) =>
      sendLoadRequest(origin, "/", {
        agent,
        payload: { synthetic: true },
        timeout: 5000,
      }),
    );
    assert.equal(pending.length, 1000);
    assert.equal(run.maxInFlight, 1000);
    assert.ok(run.responses.every((response) => response.status === 200));
  } catch (error) {
    console.error(error.message);
    throw error;
  } finally {
    for (const agent of agents) agent.destroy();
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
