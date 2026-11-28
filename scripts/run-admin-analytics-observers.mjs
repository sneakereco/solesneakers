import { spawn as spawnProcess } from "node:child_process";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { OBSERVATION_PENDING_EXIT_CODE } from "./analytics-native-readback.mjs";

const worker = fileURLToPath(new URL("./refresh-admin-analytics.mjs", import.meta.url));
const windowMs = 240_000;
const nativeTimes = [0, 180_000];
const warehouseIntervalMs = 10_000;
const workerLimitMs = 35_000;
const exitGraceMs = 1_000;
const workerSlotMs = workerLimitMs + exitGraceMs;
const outputLimitBytes = 8 * 1024;
const defaultClock = {
  now: () => performance.now(),
  sleep,
  setTimer: setTimeout,
  clearTimer: clearTimeout,
};
const workerSettings = [
  "SystemRoot",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_POSTHOG_PROJECT_KEY",
  "POSTHOG_API_HOST",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_QUERY_API_KEY",
  "POSTHOG_OPERATOR_API_KEY",
  "POSTHOG_OWNER_ORGANIZATION_ID",
  "POSTHOG_OWNER_STAGING_PROJECT_ID",
  "POSTHOG_OWNER_PRODUCTION_PROJECT_ID",
  "ANALYTICS_IDENTITY_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

function validatedAttestation(env, environment) {
  try {
    const raw = env.ANALYTICS_OBSERVER_ATTESTATION;
    if (!raw || Buffer.byteLength(raw) > 2_048) return null;
    const evidence = JSON.parse(raw);
    const {
      projectId,
      region,
      activationInstant,
      geoIpDisabled,
      sourceAndDefinitionsVerified,
    } = evidence;
    const expected = env[`POSTHOG_OWNER_${environment.toUpperCase()}_PROJECT_ID`];
    const other =
      environment === "staging"
        ? env.POSTHOG_OWNER_PRODUCTION_PROJECT_ID
        : env.POSTHOG_OWNER_STAGING_PROJECT_ID;
    if (
      Object.keys(evidence).length !== 6 ||
      evidence.environment !== environment ||
      env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT !== environment ||
      typeof projectId !== "string" ||
      !/^[1-9]\d*$/.test(projectId) ||
      !Number.isSafeInteger(Number(projectId)) ||
      projectId !== expected ||
      projectId === other ||
      projectId !== env.POSTHOG_PROJECT_ID ||
      !["https://us.posthog.com", "https://eu.posthog.com"].includes(region) ||
      region !== env.POSTHOG_API_HOST ||
      typeof activationInstant !== "string" ||
      activationInstant.startsWith("0000-") ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(activationInstant) ||
      new Date(activationInstant).toISOString().slice(0, 19) !==
        activationInstant.slice(0, 19) ||
      geoIpDisabled !== true ||
      sourceAndDefinitionsVerified !== true
    )
      return null;
    return evidence;
  } catch {
    return null;
  }
}

function runWorker({ environment, source, attestationPath, env, clock, spawn }) {
  return new Promise((resolveWorker) => {
    const args = [worker, "--environment", environment, "--source", source];
    if (source === "native") args.push("--attestation", attestationPath);
    let child;
    try {
      child = spawn(process.execPath, args, {
        env: source === "native" ? { ...env, NEXT_PUBLIC_POSTHOG_ENABLED: "true" } : env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolveWorker("spawn-failed");
      return;
    }
    let finishing, graceTimer, workerTimer;
    let bytes = 0;
    function finish(status) {
      clock.clearTimer(workerTimer);
      clock.clearTimer(graceTimer);
      resolveWorker(status);
    }
    function stop(status) {
      if (finishing) return;
      finishing = status;
      // Do not start another observer while this child may still be running.
      graceTimer = clock.setTimer(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref?.();
        finish("exit-unconfirmed");
      }, exitGraceMs);
      try {
        child.kill("SIGKILL");
      } catch {
        // Wait for close or the grace deadline.
      }
    }
    const count = (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > outputLimitBytes) stop("output-limit");
    };
    child.stdout.on("data", count);
    child.stderr.on("data", count);
    child.once("error", () => {
      if (!child.pid) finish("spawn-failed");
      else stop("worker-error");
    });
    child.once("close", (code) => {
      if (finishing) finish(finishing);
      else if (code === 0) finish(null);
      else if (code === OBSERVATION_PENDING_EXIT_CODE) finish("pending");
      else finish("worker-failed");
    });
    workerTimer = clock.setTimer(() => stop("timeout"), workerLimitMs);
  });
}

export async function runObservers({
  environment,
  run = false,
  env = process.env,
  clock = defaultClock,
  spawn = spawnProcess,
}) {
  if (!["staging", "production"].includes(environment))
    throw Error("Invalid observer environment.");
  if (run !== true)
    return {
      environment,
      status: "dry-run",
      windowMs,
      nativeTimes: [...nativeTimes],
      warehouseIntervalMs,
    };
  if (env.ANALYTICS_OBSERVER_PROBES_APPROVED !== "true")
    return { environment, status: "skipped", reason: "probes-not-approved" };
  const attestation = validatedAttestation(env, environment);
  if (!attestation)
    return { environment, status: "skipped", reason: "attestation-unverified" };

  const directory = await mkdtemp(join(tmpdir(), "sole-analytics-observers-"));
  const attestationPath = join(directory, "attestation.json");
  try {
    await writeFile(attestationPath, JSON.stringify(attestation), {
      flag: "wx",
      mode: 0o600,
    });
    const childEnv = Object.fromEntries(
      workerSettings
        .filter((key) => typeof env[key] === "string")
        .map((key) => [key, env[key]]),
    );
    const start = clock.now();
    const lastWorkerStart = start + windowMs - workerSlotMs;
    const native = { attempted: 0, failed: 0, pending: 0 };
    const warehouse = { attempted: 0, failed: 0, pending: 0 };
    const failures = {};
    let nextWarehouse = start;
    while (true) {
      const beforeSleep = clock.now();
      const nextNative = start + (nativeTimes[native.attempted] ?? Infinity);
      const lastWarehouseStart = nextNative - workerSlotMs;
      const warehouseStart = Math.max(beforeSleep, nextWarehouse);
      const next = warehouseStart <= lastWarehouseStart ? warehouseStart : nextNative;
      if (next > lastWorkerStart) break;
      if (next > beforeSleep) await clock.sleep(next - beforeSleep);
      const now = clock.now();
      if (now > lastWorkerStart) break;
      if (now < next || (now > lastWarehouseStart && now < nextNative)) continue;
      const source = now >= nextNative ? "native" : "warehouse";
      const counts = source === "native" ? native : warehouse;
      if (source === "warehouse") nextWarehouse = now + warehouseIntervalMs;
      counts.attempted++;
      const outcome = await runWorker({
        environment,
        source,
        attestationPath,
        env: childEnv,
        clock,
        spawn,
      });
      if (outcome === "pending") counts.pending++;
      else if (outcome) {
        counts.failed++;
        failures[outcome] = (failures[outcome] ?? 0) + 1;
      }
      if (outcome === "exit-unconfirmed") break;
    }
    let status = "failed";
    if (
      native.attempted === nativeTimes.length &&
      warehouse.attempted > 0 &&
      !native.failed &&
      !warehouse.failed
    ) {
      // Completion counts worker progress. Coverage still requires a complete
      // database sweep and is recorded independently by the SQL proof ledger.
      status =
        native.pending === native.attempted || warehouse.pending === warehouse.attempted
          ? "pending"
          : "completed";
    }
    return {
      environment,
      status,
      native,
      warehouse,
      failures,
    };
  } finally {
    await rm(attestationPath, { force: true });
    await rmdir(directory);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({
      options: {
        environment: { type: "string" },
        run: { type: "boolean" },
      },
    });
    const result = await runObservers(values);
    console.log(JSON.stringify(result));
    if (result.status === "pending") process.exitCode = OBSERVATION_PENDING_EXIT_CODE;
    else if (result.status === "failed" || result.status === "skipped")
      process.exitCode = 1;
  } catch {
    console.error("Analytics observer runner unavailable.");
    process.exitCode = 1;
  }
}
