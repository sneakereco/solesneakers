import assert from "node:assert/strict";
import test from "node:test";
import { createRunPlan, acceptanceProfiles } from "../shared/profiles.mjs";
import { parseTarget } from "../shared/contracts.mjs";
import { buildThresholds, evaluateThreshold } from "../shared/thresholds.mjs";
import { targetFixture, RUN_OPTIONS } from "./fixtures.mjs";
test("aggregate slots include browsers and cannot multiply the configured target", () => {
  const target = parseTarget(targetFixture());
  const peak = createRunPlan(target, "peak", RUN_OPTIONS);
  assert.deepEqual(
    [peak.httpSlots, peak.browserSlots, peak.totalSlots],
    [9980, 20, 10000],
  );
  const rush = createRunPlan(target, "rush", RUN_OPTIONS);
  assert.deepEqual(
    [rush.contenders, rush.background, rush.browserSlots],
    [8000, 1980, 20],
  );
  const worst = createRunPlan(target, "rush-worst", RUN_OPTIONS);
  assert.deepEqual(
    [worst.contenders, worst.background, worst.browserSlots],
    [9980, 0, 20],
  );
  assert.throws(() =>
    createRunPlan(target, "stress", { ...RUN_OPTIONS, totalSlots: 12001 }),
  );
  assert.throws(() =>
    createRunPlan(target, "smoke", { ...RUN_OPTIONS, totalSlots: 10000 }),
  );
  assert.throws(() =>
    createRunPlan(target, "peak", { ...RUN_OPTIONS, durationSeconds: 5 }),
  );
});
test("peak and soak preserve their measured hold while user sessions have bounded drain", () => {
  const target = parseTarget(targetFixture());
  const peak = createRunPlan(target, "peak", RUN_OPTIONS);
  assert.equal(peak.measurementSeconds, 1800);
  assert.equal(createRunPlan(target, "soak", RUN_OPTIONS).measurementSeconds, 7200);
  assert.equal(peak.gracefulStopSeconds, 600);
  assert.deepEqual(peak.mix, { browse: 55, search: 25, cart: 15, checkout: 5 });
  assert.deepEqual(peak.sessionSeconds, [300, 600]);
  assert.equal(peak.accountPoolSize, 3960);
});
test("arrival uses full sessions and refuses a calibration without completed target sessions", () => {
  const target = parseTarget(targetFixture());
  assert.throws(() => createRunPlan(target, "arrival", RUN_OPTIONS));
  assert.throws(() =>
    createRunPlan(target, "arrival", {
      ...RUN_OPTIONS,
      arrivalEvidence: { profile: "calibration", completedSessions: 0 },
    }),
  );
  const plan = createRunPlan(target, "arrival", {
    ...RUN_OPTIONS,
    arrivalEvidence: {
      profile: "peak",
      passed: true,
      totalSlots: 10000,
      completedSessions: 1000,
      meanSessionSeconds: 450,
      requestsPerSession: 12,
    },
  });
  assert.equal(plan.arrival.unit, "sessions");
  assert.equal(plan.arrival.rate, 1331);
  assert.equal(plan.arrival.timeUnit, "1m");
  assert.equal(plan.arrival.maxVUs + plan.browserSlots, 12000);
  assert.equal(plan.measurementSeconds, 600);
});
test("acceptance includes each independent workload and a failed threshold is not success", () => {
  assert.ok(
    acceptanceProfiles().some((p) => p.profile === "claim-rush" && p.contenders === 1000),
  );
  assert.ok(
    acceptanceProfiles().some((p) => p.profile === "peak" && p.cacheState === "cold"),
  );
  assert.ok(
    acceptanceProfiles().some((p) => p.profile === "peak" && p.cacheState === "warm"),
  );
  const plan = createRunPlan(parseTarget(targetFixture()), "peak", RUN_OPTIONS);
  assert.deepEqual(
    buildThresholds(plan)["operation_ms{operation:catalog,outcome:success}"],
    ["p(95)<1000", "p(99)<2000"],
  );
  assert.equal(
    evaluateThreshold("catalog", { p95: 1000, p99: 1500, failureRate: 0 }).status,
    "fail",
  );
  assert.equal(
    evaluateThreshold("catalog", { p95: 900, p99: 1500, failureRate: 0 }).status,
    "pass",
  );
  assert.equal(
    evaluateThreshold("catalog", { p95: null, p99: 1500, failureRate: 0 }).status,
    "unmet",
  );
});
test("ordinary shopping does not require a nonexistent claim metric", () => {
  const target = parseTarget(targetFixture());
  assert.equal(
    buildThresholds(createRunPlan(target, "peak", RUN_OPTIONS))[
      "operation_ms{operation:claim,outcome:success}"
    ],
    undefined,
  );
  assert.ok(
    buildThresholds(createRunPlan(target, "claim-rush", RUN_OPTIONS))[
      "operation_ms{operation:claim,outcome:success}"
    ],
  );
});
