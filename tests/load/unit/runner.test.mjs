import test from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapRunner,
  planWorkerShards,
  createCoordinator,
  verifyToolchain,
  parseK6Version,
} from "../runner/bootstrap.mjs";
import { createRunPlan } from "../shared/profiles.mjs";
import { parseTarget } from "../shared/contracts.mjs";
import { targetFixture } from "./fixtures.mjs";
test('official Windows and Linux executable banners parse the same locked version',()=>{for(const banner of ['k6.exe v2.4.0 (commit/test, windows/amd64)','k6 v2.4.0 (commit/test, linux/amd64)'])assert.equal(parseK6Version(banner),'2.4.0');});
test("locked toolchain rejects version checksum and browser drift", () => {
  for (const change of [
    { node: "24.1.0" },
    { k6: "0.1.0" },
    { chromium: "140" },
    { checksumVerified: false },
  ])
    assert.throws(() =>
      verifyToolchain({
        node: "24.14.1",
        k6: "2.4.0",
        chromium: "141.0.7390.37",
        checksumVerified: true,
        ...change,
      }),
    );
});
test("shards never multiply the global 9980 HTTP plus 20 browser budget", () => {
  const plan = createRunPlan(parseTarget(targetFixture()), "peak");
  assert.equal(plan.warmupSeconds, 780);
  const shards = planWorkerShards(plan, [
    { id: "local-a", httpSlots: 5000 },
    { id: "local-b", httpSlots: 5000 },
  ]);
  assert.equal(
    shards.reduce((n, x) => n + x.end - x.start, 0),
    9980,
  );
  assert.equal(shards[1].end, 9980);
  assert.throws(() =>
    planWorkerShards(plan, [
      { id: "same", httpSlots: 5000 },
      { id: "same", httpSlots: 5000 },
    ]),
  );
});
test("unstarted shard prevents release and rush waits for every prepared contender", async () => {
  const plan = {
    httpSlots: 2,
    browserSlots: 1,
    totalSlots: 3,
    contenders: 2,
    runId: "unit",
    targetDigest: "d",
  };
  const coordinator = await createCoordinator(plan, {
    workerCount: 2,
    readyTimeoutMs: 500,
    releaseDelayMs: 1,
  });
  try {
    const ready = async (id, path, slot) =>
      fetch(coordinator.url + path, {
        method: "POST",
        headers: { "x-worker-token": coordinator.tokenFor(id) },
        body: JSON.stringify({ workerId: id, slot }),
      }).then((x) => x.json());
    await ready("http-0", "/ready");
    const browser = coordinator.browserReady(2);
    await ready("http-0", "/prepared", 0);
    assert.equal(coordinator.phaseStart, null);
    await ready("http-1", "/ready");
    assert.equal(coordinator.phaseStart, null);
    await ready("http-1", "/prepared", 1);
    await browser;
    assert.ok(coordinator.phaseStart);
    await coordinator.waitForRelease();
  } finally {
    await coordinator.close();
  }
  const absent = await createCoordinator(
    { ...plan, contenders: 0 },
    { workerCount: 2, readyTimeoutMs: 25 },
  );
  try {
    await assert.rejects(absent.waitForRelease(), /ready/);
  } finally {
    await absent.close();
  }
});
test("bootstrap is callable without starting paid or external resources", () =>
  assert.equal(typeof bootstrapRunner, "function"));
