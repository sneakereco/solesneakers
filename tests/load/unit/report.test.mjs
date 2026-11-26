import { fixture } from "./report-fixture.mjs";
import test from "node:test";
test("a configured telemetry source without hold observations is unmet", () => {
  const f = fixture();
  f.telemetry.samples = f.telemetry.samples.filter((x) => x.source !== "application");
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "unmet");
});
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateRun,
  writeRunReport,
  mergeHistograms,
  percentileHistogram,
  createHistogram,
} from "../operator/report.mjs";
test("browser protocol samples and document TTFB count only inside the hold", () => {
  const f = fixture();
  f.workers[0].operations = f.workers[0].operations.filter(
    (x) => !["page", "catalog", "cart_validate"].includes(x.operation),
  );
  f.workers[1].operations.push(
    { type: "request", resourceType: "document", status: 200, at: 5000, ttfbMs: 120 },
    { type: "request", resourceType: "fetch", status: 200, at: 5000, ttfbMs: 20000 },
    ...["catalog", "cart_validate"].map((operation) => ({
      operation,
      outcome: "success",
      durationMs: 100,
      at: 5000,
    })),
    { operation: "catalog", outcome: "success", durationMs: 30000, at: 0 },
  );
  const report = evaluateRun(f.plan, f.workers, f.invariants, f.telemetry);
  assert.equal(report.status, "pass");
  assert.equal(report.operations.find((x) => x.operation === "page").samples, 1);
  assert.equal(report.operations.find((x) => x.operation === "catalog").p99, 100);
});
test("uncompleted offered operations cannot disappear from the final gate", () => {
  const f = fixture();
  f.workers[0].resources.push(
    { type: "k6-counter", metric: "operation_offered", operation: "pay", count: 2 },
    { type: "k6-counter", metric: "operation_completed", operation: "pay", count: 1 },
  );
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "fail");
});
test("telemetry gaps inside the hold and absent queue/Redis values stay unmet", () => {
  for (const change of [
    (f) =>
      f.telemetry.samples.push({ source: "database", at: 5000, value: { error: "gap" } }),
    (f) => (f.telemetry.samples.find((x) => x.source === "queues").value = {}),
    (f) => (f.telemetry.samples.find((x) => x.source === "redis").value = {}),
  ]) {
    const f = fixture();
    change(f);
    assert.equal(
      evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status,
      "unmet",
    );
  }
});
test("startup CPU is excluded from the hold while exact saturation limits fail", () => {
  const f = fixture();
  f.telemetry.samples.push({
    source: "generator",
    at: 0,
    value: { cpuPercent: 100, memoryPercent: 20, networkSaturated: false },
  });
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "pass");
  for (const value of [
    { cpuPercent: 80, memoryPercent: 20 },
    { cpuPercent: 20, memoryPercent: 85 },
  ]) {
    const g = fixture();
    Object.assign(g.telemetry.samples[0].value, value);
    assert.equal(
      evaluateRun(g.plan, g.workers, g.invariants, g.telemetry).status,
      "fail",
    );
  }
});
test("unverified tier parity is unmet and browser failures name the exact case", () => {
  const f = fixture();
  f.plan.provenance.tiers.verified = false;
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "unmet");
  f.workers[1].operations.push({
    type: "case",
    name: "cart-revision-race",
    status: "fail",
  });
  assert.ok(
    JSON.stringify(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry)).includes(
      "cart-revision-race",
    ),
  );
});
test("one failing operation fails whole run and exact budgets are enforced", () => {
  const f = fixture();
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "pass");
  f.workers[0].operations.find((x) => x.operation === "prepare").durationMs = 5000;
  const result = evaluateRun(f.plan, f.workers, f.invariants, f.telemetry);
  assert.equal(result.status, "fail");
  assert.equal(result.operations.find((x) => x.operation === "prepare").status, "fail");
});
test("fast stock conflicts cannot hide slow successful winners", () => {
  const f = fixture();
  f.workers[0].operations = f.workers[0].operations.filter(
    (x) => x.operation !== "prepare",
  );
  f.workers[0].operations.push(
    { operation: "prepare", outcome: "success", durationMs: 5000 },
    ...Array.from({ length: 100 }, () => ({
      operation: "prepare",
      outcome: "stock-conflict",
      durationMs: 1,
    })),
  );
  assert.equal(
    evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).operations.find(
      (x) => x.operation === "prepare",
    ).p95,
    5000,
  );
});
test("percentiles merge sample counts instead of worker percentiles", () => {
  const a = createHistogram([10000]),
    b = createHistogram(Array(100).fill(10));
  const merged = mergeHistograms([a, b]);
  assert.equal(percentileHistogram(merged, 95), 10);
  assert.equal(percentileHistogram(merged, 99), 10);
  assert.equal(merged.count, 101);
  assert.throws(() => mergeHistograms([a, { ...b, precisionMs: 10 }]), /compatible/);
});
test("missing DB evidence is unmet and a stopped browser reduces achieved cohort", () => {
  const f = fixture();
  f.telemetry.availability.database = { status: "unavailable" };
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "unmet");
  f.telemetry.availability.database = { status: "available" };
  f.workers[1].activeSamples = [
    { at: 1000, slots: 2 },
    { at: 6000, slots: 0 },
  ];
  const result = evaluateRun(f.plan, f.workers, f.invariants, f.telemetry);
  assert.equal(result.status, "fail");
  assert.equal(result.achieved.minimumConcurrent, 8);
});
test("99 percent checkout gate includes failed eligible attempts before reservation", () => {
  const f = fixture();
  f.workers[0].resources[0] = {
    type: "checkout-outcomes",
    eligible: 100,
    completedOnTime: 98,
  };
  assert.equal(evaluateRun(f.plan, f.workers, f.invariants, f.telemetry).status, "fail");
});
test("report shows operation, missing telemetry, and capture failures without credentials", async () => {
  const f = fixture();
  f.workers[0].operations.find((x) => x.operation === "pay").durationMs = 6000;
  f.telemetry.availability.database = {
    status: "unavailable",
    reason: "https://db.test/status?token=private-token",
  };
  f.invariants.captures.push({ ...f.invariants.captures[0], id: "another-payment" });
  const directory = await mkdtemp(join(tmpdir(), "sole-report-"));
  try {
    const report = evaluateRun(f.plan, f.workers, f.invariants, f.telemetry);
    const files = await writeRunReport(report, directory);
    assert.equal(files.exitCode, 1);
    const markdown = await readFile(files.markdownPath, "utf8");
    assert.ok(markdown.includes("pay"));
    assert.ok(markdown.includes("database"));
    assert.ok(markdown.includes("Duplicate capture"));
    assert.ok(!markdown.includes("private-token"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
