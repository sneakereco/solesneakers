import test from "node:test";
import assert from "node:assert/strict";
import { allocateWorkers, scenarioOptions } from "../operator/workers.mjs";
test("worker partitions are disjoint and reserve browser slots in every scenario", () => {
  const plan = {
    httpSlots: 9980,
    browserSlots: 20,
    totalSlots: 10000,
    profile: "peak",
    measurementSeconds: 1800,
    warmupSeconds: 750,
    gracefulStopSeconds: 600,
    stages: [
      { durationSeconds: 30, totalSlots: 100 },
      { durationSeconds: 120, totalSlots: 100 },
    ],
  };
  const shards = allocateWorkers(plan, 3);
  assert.equal(
    shards.reduce((n, s) => n + s.end - s.start, 0),
    9980,
  );
  assert.equal(shards[2].end, 9980);
  assert.equal(shards[0].start, 0);
  const opts = scenarioOptions(plan, shards[0]);
  assert.equal(opts.scenarios.shoppers.executor, "ramping-vus");
  assert.equal(opts.scenarios.shoppers.stages.at(-1).duration, "1800s");
});
test("arrival starts full sessions without request rate or pacing inflation", () => {
  const plan = {
    httpSlots: 11980,
    browserSlots: 20,
    totalSlots: 12000,
    profile: "arrival",
    measurementSeconds: 600,
    warmupSeconds: 600,
    gracefulStopSeconds: 600,
    arrival: { rate: 1200, timeUnit: "1m", preAllocatedVUs: 10000, maxVUs: 11980 },
  };
  const shards = allocateWorkers(plan, 2);
  const options = shards.map((s) => scenarioOptions(plan, s));
  assert.equal(
    options.reduce((n, o) => n + o.scenarios.shoppers.rate, 0),
    1200,
  );
  assert.equal(
    options.reduce((n, o) => n + o.scenarios.shoppers.maxVUs, 0),
    11980,
  );
  assert.equal(options[0].scenarios.shoppers.duration, "1200s");
});
