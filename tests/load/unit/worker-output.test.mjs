import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readWorkerResult, percentileHistogram } from "../operator/report.mjs";
test("native gzipped k6 points become bounded histograms and observed active slots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sole-k6-points-"));
  try {
    const plan = {
      runId: "fixture",
      profile: "smoke",
      startedAt: new Date(1000).toISOString(),
      warmupSeconds: 0,
      measurementSeconds: 10,
      measurementStart: 1000,
      measurementEnd: 11000,
    };
    const point = (metric, value, at, tags = {}) => ({
      type: "Point",
      metric,
      data: { value, time: new Date(at).toISOString(), tags },
    });
    const points = [
      point("session_started", 1, 1000),
      point("active_delta", 1, 1000),
      point("operation_ms", 700, 2000, {
        operation: "catalog",
        outcome: "success",
        phase: "hold",
      }),
      point("operation_ms", 2500, 13000, {
        operation: "prepare",
        outcome: "success",
        phase: "hold",
      }),
      point("eligible_checkout_completed", 1, 5000),
      point("session_completed", 1, 11000),
      point("active_delta", -1, 11000),
    ];
    const path = join(dir, "metrics.gz");
    await writeFile(
      path,
      gzipSync(points.map((x) => JSON.stringify(x)).join("\n") + "\n"),
    );
    const result = await readWorkerResult(
      { output: path, workerId: "http-0", exitCode: 0, finishedAt: 13000 },
      plan,
    );
    assert.equal(result.offered, 1);
    assert.equal(result.completed, 1);
    assert.equal(Math.max(...result.activeSamples.map((x) => x.slots)), 1);
    assert.equal(result.activeSamples.at(-1).slots, 0);
    assert.equal(
      percentileHistogram(
        result.operations.find((x) => x.operation === "catalog").histogram,
        95,
      ),
      700,
    );
    assert.equal(
      result.operations.find((x) => x.operation === "prepare").histogram.count,
      1,
    );
    assert.equal(
      result.resources.find((x) => x.type === "checkout-outcomes").completedOnTime,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("missing or truncated worker output never becomes a successful empty result", async () => {
  const result = await readWorkerResult(
    {
      output: join(tmpdir(), "nonexistent-sole-metrics.gz"),
      workerId: "http-0",
      exitCode: 1,
      finishedAt: 11000,
    },
    { runId: "fixture", profile: "smoke", measurementStart: 1000, measurementEnd: 11000 },
  );
  assert.ok(result.errors.length > 0);
  assert.equal(result.completed, 0);
});
