import test from "node:test";
import assert from "node:assert/strict";
import {
  startTelemetry,
  parsePrometheus,
  collectDatabaseSnapshot,
  readK6LiveCounters,
} from "../operator/telemetry.mjs";
test("live counters use exact Counter samples and reject remote administration URLs", async () => {
  const fetcher = () =>
    Promise.resolve(
      Response.json({
        data: [
          { id: "technical_attempts", attributes: { sample: { count: 100 } } },
          { id: "technical_errors", attributes: { sample: { count: 6 } } },
          { id: "http_reqs", attributes: { sample: { count: 110 } } },
        ],
      }),
    );
  const sample = await readK6LiveCounters("http://127.0.0.1:6565", fetcher);
  assert.equal(sample.attempts, 100);
  assert.equal(sample.errors, 6);
  assert.equal(sample.requests, 110);
  await assert.rejects(
    readK6LiveCounters("https://remote.test", () => assert.fail("remote management")),
    /loopback/,
  );
});
test("missing DB telemetry is explicit and telemetry failures do not invent zero measurements", async () => {
  let calls = 0;
  const handle = await startTelemetry(
    { runId: "run" },
    {
      generator: {
        intervalMs: 1000,
        read: () => {
          calls++;
          return Promise.resolve({
            cpuPercent: 10,
            memoryPercent: 20,
            networkSaturated: false,
          });
        },
      },
      database: { intervalMs: 1000, read: () => Promise.reject(Error("unavailable")) },
    },
  );
  const result = await handle.stop();
  assert.equal(calls, 1);
  assert.equal(result.availability.generator.status, "available");
  assert.equal(result.availability.database.status, "unavailable");
  assert.ok(!("cpuPercent" in result.samples.find((x) => x.source === "database").value));
});
test("Prometheus parser preserves real finite series while discarding private label values", () => {
  const result = parsePrometheus(
    '# comment\nnode_cpu_seconds_total{cpu="0",mode="idle",instance="private"} 42\npg_up 1\ninvalid NaN\n',
  );
  assert.equal(result.find((x) => x.name === "pg_up").value, 1);
  assert.equal(result.length, 2);
  assert.ok(!JSON.stringify(result).includes("private"));
});
test("database probe reports latency separately from application query statistics", async () => {
  const result = await collectDatabaseSnapshot({
    query: () =>
      Promise.resolve({
        rows: [{ connections: 3, max_connections: 100, waiting_locks: 0 }],
      }),
  });
  assert.equal(result.connections, 3);
  assert.ok(Number.isFinite(result.probeLatencyMs));
  assert.equal(result.queryP95Ms, undefined);
});
