import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { validateResults } from "../shared/contracts.mjs";
import { OPERATION_BUDGETS, evaluateThreshold } from "../shared/thresholds.mjs";
import { redactArtifact } from "../shared/redact.mjs";
import { assertRunInvariants } from "./assertions.mjs";
import { secureDirectory, privateJson } from "./journal.mjs";

export function createHistogram(values = []) {
  const bins = new Map();
  let count = 0,
    sum = 0,
    max = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw Error("Invalid latency observation");
    const bucket = Math.min(120001, Math.ceil(value));
    bins.set(bucket, (bins.get(bucket) ?? 0) + 1);
    count++;
    sum += value;
    max = Math.max(max, value);
  }
  return {
    version: 1,
    precisionMs: 1,
    maxBucketMs: 120000,
    count,
    sum,
    max,
    buckets: [...bins].sort((a, b) => a[0] - b[0]),
  };
}
export function mergeHistograms(histograms) {
  const result = createHistogram(),
    bins = new Map();
  for (const histogram of histograms) {
    if (
      histogram.version !== 1 ||
      histogram.precisionMs !== 1 ||
      histogram.maxBucketMs !== 120000
    )
      throw Error("Latency histograms are not compatible");
    let observed = 0;
    for (const [upper, count] of histogram.buckets) {
      if (
        !Number.isSafeInteger(upper) ||
        upper < 0 ||
        upper > 120001 ||
        !Number.isSafeInteger(count) ||
        count < 0
      )
        throw Error("Invalid histogram bucket");
      bins.set(upper, (bins.get(upper) ?? 0) + count);
      observed += count;
    }
    if (
      observed !== histogram.count ||
      !Number.isFinite(histogram.sum) ||
      histogram.sum < 0 ||
      !Number.isFinite(histogram.max) ||
      histogram.max < 0
    )
      throw Error("Invalid histogram totals");
    result.count += histogram.count;
    result.sum += histogram.sum;
    result.max = Math.max(result.max, histogram.max);
  }
  result.buckets = [...bins].sort((a, b) => a[0] - b[0]);
  return result;
}
export function percentileHistogram(histogram, percentile) {
  if (percentile < 0 || percentile > 100) throw Error("Invalid percentile");
  if (!histogram.count) return null;
  const rank = Math.max(1, Math.ceil((histogram.count * percentile) / 100));
  let total = 0;
  for (const [upper, count] of histogram.buckets) {
    total += count;
    if (total >= rank) return upper === 120001 ? histogram.max : upper;
  }
  throw Error("Histogram count mismatch");
}
export async function readWorkerResult(completion, plan) {
  const result = {
    version: 1,
    runId: plan.runId,
    workerId: completion.workerId,
    profile: plan.profile,
    activeSamples: [],
    offered: 0,
    completed: 0,
    dropped: 0,
    interrupted: 0,
    operations: [],
    resources: [],
    errors: [],
  };
  const start =
      plan.measurementStart ?? Date.parse(plan.startedAt) + plan.warmupSeconds * 1000,
    end = plan.measurementEnd ?? start + plan.measurementSeconds * 1000;
  const groups = new Map(),
    deltas = new Map(),
    counters = new Map(),
    statuses = new Map(),
    dispatch = [],
    durations = [],
    requestCounts = [];
  let eligible = 0,
    onTime = 0,
    last = start,
    bytes = 0;
  const input = createReadStream(completion.output),
    stream = completion.output.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  if (stream !== input) input.on("error", (error) => stream.destroy(error));
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  function groupFor(operation, outcome, route) {
    const key = JSON.stringify([operation, outcome, route]);
    if (!groups.has(key))
      groups.set(key, {
        operation,
        outcome,
        route,
        bins: new Map(),
        count: 0,
        sum: 0,
        max: 0,
      });
    return groups.get(key);
  }
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const point = JSON.parse(line);
      if (point.type !== "Point") continue;
      const { value, time, tags = {} } = point.data ?? {},
        at = Date.parse(time);
      if (!Number.isFinite(value) || !Number.isFinite(at))
        throw Error("Invalid native metric point");
      last = Math.max(last, at);
      const held = tags.phase ? tags.phase === "hold" : at >= start && at <= end;
      if (point.metric === "active_delta") {
        if (value !== 1 && value !== -1) throw Error("Invalid active slot delta");
        deltas.set(at, (deltas.get(at) ?? 0) + value);
      }
      if (point.metric === "session_started") result.offered += value;
      if (point.metric === "session_completed") result.completed += value;
      if (point.metric === "session_interrupted") result.interrupted += value;
      if (point.metric === "dropped_iterations") result.dropped += value;
      if (held && point.metric === "operation_ms") {
        if (!OPERATION_BUDGETS[tags.operation] && tags.operation !== "asset")
          throw Error("Unrecognized operation metric");
        if (
          !["success", "technical", "stock-conflict"].includes(tags.outcome) ||
          value < 0
        )
          throw Error("Invalid operation classification");
        const group = groupFor(tags.operation, tags.outcome, tags.route ?? null),
          bucket = Math.min(120001, Math.ceil(value));
        group.bins.set(bucket, (group.bins.get(bucket) ?? 0) + 1);
        group.count++;
        group.sum += value;
        group.max = Math.max(group.max, value);
      }
      if (held && point.metric === "eligible_checkout_completed") {
        eligible++;
        if (value === 1) onTime++;
        else if (value !== 0) throw Error("Invalid checkout outcome");
      }
      if (held && point.metric === "http_response") {
        const key = JSON.stringify([tags.operation, tags.status, tags.cache]);
        statuses.set(key, (statuses.get(key) ?? 0) + value);
      }
      if (
        held &&
        [
          "http_reqs",
          "data_received",
          "data_sent",
          "operation_offered",
          "operation_completed",
          "stock_unavailable",
        ].includes(point.metric)
      ) {
        const key = JSON.stringify([point.metric, tags.operation ?? null]);
        counters.set(key, (counters.get(key) ?? 0) + value);
        if (point.metric === "data_received" || point.metric === "data_sent")
          bytes += value;
      }
      if (point.metric === "rush_dispatch") dispatch.push(value);
      if (
        point.metric === "session_duration_ms" &&
        tags.outcome === "success" &&
        tags.full_sample === "1" &&
        at - value >= start &&
        at <= end
      )
        durations.push(value);
      if (
        point.metric === "session_requests" &&
        tags.outcome === "success" &&
        tags.full_sample === "1" &&
        at <= end
      )
        requestCounts.push(value);
    }
  } catch {
    result.errors.push("Missing, truncated or invalid private worker metric output");
  } finally {
    reader.close();
    stream.destroy();
    input.destroy();
  }
  let active = 0;
  result.activeSamples.push({ at: Math.max(0, start - 1), slots: 0 });
  for (const [at, delta] of [...deltas].sort((a, b) => a[0] - b[0])) {
    active += delta;
    if (active < 0) {
      result.errors.push("Active slot accounting became negative");
      active = 0;
    }
    result.activeSamples.push({ at, slots: active });
  }
  if (active) {
    result.errors.push("Generator ended with unreleased active sessions");
    result.activeSamples.push({
      at: Math.max(last, completion.finishedAt ?? last) + 1,
      slots: 0,
    });
  }
  if (completion.exitCode !== 0)
    result.errors.push("k6 exited without satisfying its run gates");
  for (const group of groups.values())
    result.operations.push({
      operation: group.operation,
      outcome: group.outcome,
      route: group.route,
      histogram: {
        version: 1,
        precisionMs: 1,
        maxBucketMs: 120000,
        count: group.count,
        sum: group.sum,
        max: group.max,
        buckets: [...group.bins].sort((a, b) => a[0] - b[0]),
      },
    });
  result.resources.push(
    { type: "checkout-outcomes", eligible, completedOnTime: onTime },
    { type: "rush-dispatch", values: dispatch },
    {
      type: "full-session-evidence",
      completedSessions: durations.length,
      meanSessionSeconds: durations.length
        ? durations.reduce((a, b) => a + b, 0) / durations.length / 1000
        : null,
      requestsPerSession: requestCounts.length
        ? requestCounts.reduce((a, b) => a + b, 0) / requestCounts.length
        : null,
    },
    { type: "network-throughput", bytes, measurementSeconds: (end - start) / 1000 },
  );
  for (const [key, count] of counters) {
    const [metric, operation] = JSON.parse(key);
    result.resources.push({ type: "k6-counter", metric, operation, count });
  }
  for (const [key, count] of statuses) {
    const [operation, status, cache] = JSON.parse(key);
    result.resources.push({ type: "http-status", operation, status, cache, count });
  }
  return result;
}
function gate(name, status, reasons = [], details = {}) {
  return { name, status, reasons, ...details };
}
function measuredConcurrency(plan, workers) {
  const start =
      plan.measurementStart ?? Date.parse(plan.startedAt) + plan.warmupSeconds * 1000,
    end = plan.measurementEnd ?? start + plan.measurementSeconds * 1000;
  const events = workers
    .flatMap((worker) =>
      worker.activeSamples.map((sample) => ({ ...sample, workerId: worker.workerId })),
    )
    .sort((a, b) => a.at - b.at);
  const active = new Map();
  let cursor = 0,
    minimum = Infinity,
    maximum = 0,
    fullSeconds = 0;
  for (let second = start; second < end; second += 1000) {
    while (cursor < events.length && events[cursor].at <= second) {
      const value = events[cursor++];
      active.set(value.workerId, value.slots);
    }
    let peak = [...active.values()].reduce((a, b) => a + b, 0);
    while (cursor < events.length && events[cursor].at < Math.min(end, second + 1000)) {
      const value = events[cursor++];
      active.set(value.workerId, value.slots);
      peak = Math.max(
        peak,
        [...active.values()].reduce((a, b) => a + b, 0),
      );
    }
    minimum = Math.min(minimum, peak);
    maximum = Math.max(maximum, peak);
    if (peak >= plan.totalSlots) fullSeconds++;
  }
  return {
    minimumConcurrent: Number.isFinite(minimum) ? minimum : 0,
    maximumConcurrent: maximum,
    fullCohortSeconds: fullSeconds,
    measurementSeconds: Math.ceil((end - start) / 1000),
  };
}
function operationReports(plan, workers) {
  const groups = new Map();
  const start =
      plan.measurementStart ?? Date.parse(plan.startedAt) + plan.warmupSeconds * 1000,
    end = plan.measurementEnd ?? start + plan.measurementSeconds * 1000;
  for (const worker of workers)
    for (let observation of worker.operations) {
      if (
        worker.workerId.startsWith("browser") &&
        observation.at !== undefined &&
        (observation.at < start || observation.at > end)
      )
        continue;
      if (
        observation.type === "request" &&
        observation.resourceType === "document" &&
        Number.isFinite(observation.ttfbMs)
      )
        observation = {
          operation: "page",
          outcome:
            observation.status >= 200 && observation.status < 300
              ? "success"
              : "technical",
          durationMs: observation.ttfbMs,
        };
      if (
        !observation.operation ||
        observation.type === "case" ||
        observation.type === "request"
      )
        continue;
      const operation = observation.operation,
        outcome = observation.outcome ?? "technical";
      const histogram = observation.histogram
        ? mergeHistograms([observation.histogram])
        : createHistogram([observation.durationMs]);
      const group = groups.get(operation) ?? {
        success: [],
        total: 0,
        technical: 0,
        conflicts: 0,
      };
      group.total += histogram.count;
      if (outcome === "success") group.success.push(histogram);
      else if (outcome === "stock-conflict") group.conflicts += histogram.count;
      else group.technical += histogram.count;
      groups.set(operation, group);
    }
  return Object.keys(OPERATION_BUDGETS)
    .filter((name) => name !== "claim" || plan.profile === "claim-rush")
    .map((operation) => {
      const data = groups.get(operation) ?? {
          success: [],
          total: 0,
          technical: 0,
          conflicts: 0,
        },
        histogram = mergeHistograms(data.success);
      const metrics = {
        p95: percentileHistogram(histogram, 95),
        p99: percentileHistogram(histogram, 99),
        failureRate: data.total ? data.technical / data.total : null,
      };
      return {
        operation,
        ...metrics,
        ...evaluateThreshold(operation, metrics),
        samples: histogram.count,
        offered: data.total,
        expectedConflicts: data.conflicts,
        latencyPrecision: "upper bound at 1ms resolution",
      };
    });
}
export function evaluateRun(plan, workerResults, invariants, telemetry) {
  const gates = [],
    workers = [],
    ids = new Set();
  for (const value of workerResults) {
    try {
      const worker = validateResults(value);
      if (
        worker.runId !== plan.runId ||
        worker.profile !== plan.profile ||
        ids.has(worker.workerId)
      )
        throw Error("Worker identity mismatch");
      ids.add(worker.workerId);
      workers.push(worker);
    } catch {
      gates.push(
        gate("worker-evidence", "fail", ["Invalid or duplicate worker evidence"]),
      );
    }
  }
  let operations = [];
  try {
    operations = operationReports(plan, workers);
  } catch {
    gates.push(gate("operation-evidence", "fail", ["Malformed latency evidence"]));
  }
  for (const operation of operations)
    gates.push(
      gate(`operation:${operation.operation}`, operation.status, operation.reasons),
    );
  const achieved = measuredConcurrency(plan, workers);
  gates.push(
    gate(
      "achieved-cohort",
      achieved.minimumConcurrent >= plan.totalSlots && achieved.maximumConcurrent <= 12000
        ? "pass"
        : "fail",
      achieved.minimumConcurrent < plan.totalSlots
        ? ["Full cohort was not observed throughout the measured hold"]
        : [],
    ),
  );
  const totals = workers.reduce(
    (sum, worker) => ({
      offered: sum.offered + worker.offered,
      completed: sum.completed + worker.completed,
      dropped: sum.dropped + worker.dropped,
      interrupted: sum.interrupted + worker.interrupted,
    }),
    { offered: 0, completed: 0, dropped: 0, interrupted: 0 },
  );
  const incompleteOperations = workers.flatMap((worker) =>
    worker.resources
      .filter((x) => x.type === "k6-counter" && x.metric === "operation_offered")
      .filter(
        (offered) =>
          offered.count >
          (worker.resources.find(
            (x) =>
              x.type === "k6-counter" &&
              x.metric === "operation_completed" &&
              x.operation === offered.operation,
          )?.count ?? 0),
      ),
  );
  if (incompleteOperations.length)
    gates.push(
      gate("operation-completion", "fail", [
        "Offered requests have no terminal operation measurement",
      ]),
    );
  gates.push(
    gate(
      "offered-work",
      totals.dropped ||
        totals.interrupted ||
        workers.some((worker) => worker.errors.length)
        ? "fail"
        : totals.offered
          ? "pass"
          : "unmet",
      totals.dropped || totals.interrupted ? ["Dropped or interrupted work"] : [],
    ),
  );
  const browser = workers.find((worker) => worker.workerId.startsWith("browser"));
  if (plan.browserSlots) {
    const coverage = browser?.resources.find((x) => x.type === "browser-coverage"),
      vitals = browser?.resources.find((x) => x.type === "vitals-gate");
    gates.push(
      gate(
        "browser-journeys",
        coverage?.status ?? "unmet",
        coverage?.reasons ?? ["No browser cohort evidence"],
      ),
    );
    gates.push(
      gate(
        "browser-vitals",
        vitals?.status ?? "unmet",
        vitals?.reasons ?? ["No measured LCP/CLS/INP evidence"],
      ),
    );
    const failed =
      browser?.operations.filter((x) => x.type === "case" && x.status !== "pass") ?? [];
    if (failed.length)
      gates.push(
        gate(
          "browser-assertions",
          "fail",
          failed.map((x) => `Rendered case failed: ${x.name}`),
        ),
      );
  }
  let eligible = 0,
    completedOnTime = 0;
  for (const worker of workers.filter((x) => !x.workerId.startsWith("browser")))
    for (const resource of worker.resources)
      if (resource.type === "checkout-outcomes") {
        eligible += resource.eligible;
        completedOnTime += resource.completedOnTime;
      }
  gates.push(
    gate(
      "eligible-checkout",
      !eligible ? "unmet" : completedOnTime / eligible >= 0.99 ? "pass" : "fail",
      eligible ? [] : ["No eligible completed-checkout denominator"],
      { eligible, completedOnTime },
    ),
  );
  const invariantGate = assertRunInvariants(invariants, plan);
  gates.push(gate("durable-invariants", invariantGate.status, invariantGate.reasons));
  const samples = telemetry?.samples ?? [];
  const windowStart =
      plan.measurementStart ?? Date.parse(plan.startedAt) + plan.warmupSeconds * 1000,
    windowEnd = plan.measurementEnd ?? windowStart + plan.measurementSeconds * 1000;
  const heldSamples = samples.filter(
    (sample) => sample.at >= windowStart && sample.at <= windowEnd,
  );
  const hasSource = (source) =>
    telemetry?.availability?.[source]?.status === "available" &&
    heldSamples.some(
      (sample) =>
        sample.source === source && sample.value && typeof sample.value === "object",
    ) &&
    !heldSamples.some(
      (sample) => sample.source === source && (!sample.value || sample.value.error),
    );
  for (const source of plan.requiredTelemetry ?? [
    "generator",
    "application",
    "database",
    "redis",
    "queues",
  ])
    gates.push(
      gate(
        `telemetry:${source}`,
        hasSource(source) ? "pass" : "unmet",
        hasSource(source) ? [] : [`Missing required ${source} telemetry`],
      ),
    );
  const generator = heldSamples
    .filter((x) => x.source === "generator")
    .map((x) => x.value);
  const saturated = generator.some(
    (x) =>
      x.cpuPercent >= 80 ||
      x.memoryPercent >= 85 ||
      x.networkSaturated === true ||
      x.eventLoopP99Ms > 100,
  );
  const completeHeadroom =
    generator.length &&
    generator.every(
      (x) =>
        Number.isFinite(x.cpuPercent) &&
        Number.isFinite(x.memoryPercent) &&
        typeof x.networkSaturated === "boolean",
    );
  gates.push(
    gate(
      "generator-headroom",
      saturated ? "fail" : completeHeadroom ? "pass" : "unmet",
      saturated
        ? ["Generator saturation; capacity result is generator-limited"]
        : completeHeadroom
          ? []
          : ["CPU, memory or unsaturated network proof missing"],
    ),
  );
  const database = heldSamples.filter((x) => x.source === "database").map((x) => x.value);
  if (
    !database.some(
      (x) =>
        Number.isFinite(x.cpuPercent) &&
        Number.isFinite(x.connections) &&
        Number.isFinite(x.maxConnections),
    )
  )
    gates.push(
      gate("database-headroom-evidence", "unmet", [
        "Database CPU/connections telemetry missing",
      ]),
    );
  const redis = heldSamples.filter((x) => x.source === "redis").map((x) => x.value);
  gates.push(
    gate(
      "redis-health",
      redis.some((x) => x.available === false || x.limitExceeded === true)
        ? "fail"
        : redis.length &&
            redis.every(
              (x) =>
                x.available === true &&
                typeof x.limitExceeded === "boolean" &&
                x.simulationOverhead,
            )
          ? "pass"
          : "unmet",
      redis.length &&
        redis.every(
          (x) =>
            x.available === true &&
            typeof x.limitExceeded === "boolean" &&
            x.simulationOverhead,
        )
        ? []
        : ["Redis availability, limit or simulation-overhead evidence missing"],
    ),
  );
  const queues = heldSamples.filter((x) => x.source === "queues").map((x) => x.value);
  gates.push(
    gate(
      "notification-age",
      !queues.length || queues.some((x) => !Number.isFinite(x.oldestDeliverableSeconds))
        ? "unmet"
        : queues.some((x) => x.oldestDeliverableSeconds > 300)
          ? "fail"
          : "pass",
      queues.some((x) => x.oldestDeliverableSeconds > 300)
        ? ["Oldest deliverable notification exceeded five minutes"]
        : [],
    ),
  );
  if (
    !plan.provenance?.commit ||
    !plan.provenance?.deploymentId ||
    !plan.workloadDigest ||
    !plan.targetDigest
  )
    gates.push(
      gate("immutable-provenance", "unmet", [
        "Commit/deployment/workload/resource provenance missing",
      ]),
    );
  if (plan.provenance?.tiers?.verified !== true)
    gates.push(
      gate("tier-parity", "unmet", [
        "Staging resource tiers and production parity are not verified",
      ]),
    );
  const status = gates.some((x) => x.status === "fail")
    ? "fail"
    : gates.some((x) => x.status === "unmet")
      ? "unmet"
      : "pass";
  return redactArtifact({
    version: 1,
    runId: plan.runId,
    profile: plan.profile,
    status,
    provenance: plan.provenance,
    targetDigest: plan.targetDigest,
    workloadDigest: plan.workloadDigest,
    fault: plan.fault ?? null,
    achieved: { ...achieved, ...totals },
    operations,
    browser: {
      cases: browser?.operations.filter((x) => x.type === "case") ?? [],
      errors: browser?.errors ?? [],
      vitals: browser?.resources.find((x) => x.type === "vitals-gate") ?? null,
    },
    gates,
    telemetry: { availability: telemetry?.availability ?? {}, samples },
    scope: {
      capacityProven:
        status === "pass" &&
        ["peak", "soak", "rush", "rush-worst"].includes(plan.profile),
      providerMode: plan.provenance?.providerMode ?? "unknown",
      productionReadiness:
        "separate provider/perimeter and release gates remain required",
    },
  });
}
export async function writeRunReport(report, artifactDir) {
  await secureDirectory(artifactDir);
  const safe = redactArtifact(report),
    jsonPath = join(artifactDir, "report.json"),
    markdownPath = join(artifactDir, "report.md");
  await privateJson(jsonPath, safe);
  const rows = (safe.operations ?? [])
    .map(
      (x) =>
        `| ${x.operation} | ${x.status} | ${x.samples} | ${x.p95 ?? "missing"} | ${x.p99 ?? "missing"} | ${x.failureRate ?? "missing"} |`,
    )
    .join("\n");
  const gates = (safe.gates ?? [])
    .map(
      (x) =>
        `- ${x.name}: ${x.status}${x.reasons?.length ? ` — ${x.reasons.join("; ")}` : ""}`,
    )
    .join("\n");
  const content = `# Load run ${safe.runId}\n\nResult: **${safe.status}** (${safe.profile}).\n\nMeasured concurrent users: ${safe.achieved?.minimumConcurrent ?? "missing"}–${safe.achieved?.maximumConcurrent ?? "missing"}.\n\n| Operation | Result | Samples | p95 ms | p99 ms | Technical failure rate |\n| --- | --- | ---: | ---: | ---: | ---: |\n${rows}\n\n${gates}\n\nProvider mode: ${safe.scope?.providerMode ?? "unknown"}. Capacity proven: ${safe.scope?.capacityProven ?? false}. Production/provider/perimeter conclusions remain separate.\n`;
  await writeFile(markdownPath, content, { mode: 0o600 });
  return {
    jsonPath,
    markdownPath,
    exitCode:
      safe.cleanup?.status === "incomplete"
        ? 3
        : safe.status === "pass"
          ? 0
          : safe.status === "fail"
            ? 1
            : 2,
  };
}
