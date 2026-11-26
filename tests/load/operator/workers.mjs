import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateJson } from "./journal.mjs";
import { buildThresholds } from "../shared/thresholds.mjs";
import { createServer } from "node:net";
import { appendFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root = fileURLToPath(new URL("../../../", import.meta.url));
export function allocateWorkers(plan, count = 1) {
  if (!Number.isSafeInteger(count) || count < 1 || count > plan.httpSlots)
    throw Error("Invalid worker count");
  return Array.from({ length: count }, (_, index) => ({
    workerId: `http-${index}`,
    kind: "http",
    index,
    count,
    start: Math.floor((index * plan.httpSlots) / count),
    end: Math.floor(((index + 1) * plan.httpSlots) / count),
  }));
}
function share(total, shard) {
  return (
    Math.floor(((shard.index + 1) * total) / shard.count) -
    Math.floor((shard.index * total) / shard.count)
  );
}
export function scenarioOptions(plan, shard) {
  const size = shard.end - shard.start,
    gracefulStop = `${plan.gracefulStopSeconds}s`;
  const base = { exec: "shopperSession", gracefulStop };
  let scenario;
  if (plan.profile === "arrival")
    scenario = {
      ...base,
      exec: "arrivalSession",
      executor: "constant-arrival-rate",
      rate: share(plan.arrival.rate, shard),
      timeUnit: "1m",
      preAllocatedVUs: share(plan.arrival.preAllocatedVUs, shard),
      maxVUs: size,
      duration: `${plan.warmupSeconds + plan.measurementSeconds}s`,
    };
  else if (plan.stages?.length)
    scenario = {
      ...base,
      executor: "ramping-vus",
      startVUs: 0,
      gracefulRampDown: gracefulStop,
      stages: [
        ...plan.stages.map((stage) => ({
          duration: `${stage.durationSeconds}s`,
          target: share(Math.max(0, stage.totalSlots - plan.browserSlots), shard),
        })),
        { duration: "30s", target: size },
        { duration: `${plan.measurementSeconds}s`, target: size },
      ],
    };
  else
    scenario = {
      ...base,
      executor: "constant-vus",
      vus: size,
      duration: `${plan.measurementSeconds}s`,
    };
  if (plan.contenders) scenario.exec = "rushSession";
  if (plan.contenders) scenario.duration = `${plan.measurementSeconds + 120}s`;
  const allThresholds = buildThresholds(plan);
  return {
    noCookiesReset: true,
    scenarios: { shoppers: scenario },
    thresholds: {
      dropped_iterations: allThresholds.dropped_iterations,
      business_violations: allThresholds.business_violations,
      technical_failure: ["rate<0.01"],
    },
    systemTags: ["status", "method", "name", "scenario", "expected_response"],
    discardResponseBodies: false,
    throw: false,
  };
}
export async function launchWorkers(plan, fixtures, options) {
  const shards = allocateWorkers(plan, options.workerCount ?? 1);
  const handles = [];
  const k6Config = resolve(options.artifactDir, "empty-k6-config.json");
  await privateJson(k6Config, {});
  try {
    for (const shard of shards) {
      const reservation = createServer();
      await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
      const port = reservation.address().port;
      await new Promise((done) => reservation.close(done));
      const configPath = resolve(options.artifactDir, `${shard.workerId}-private.json`);
      const accounts = fixtures.sessions.filter(
        (x) => x.slot >= shard.start && x.slot < shard.end,
      );
      await privateJson(configPath, {
        plan,
        shard,
        baseUrl: options.target.baseUrl,
        credential: options.leaseCredential
          ? await options.leaseCredential(shard)
          : options.credential,
        coordinator: options.coordinator
          ? {
              url: options.coordinator.url,
              token: options.coordinator.tokenFor(shard.workerId),
            }
          : undefined,
        fixtures: {
          products: fixtures.products,
          addresses: fixtures.addresses,
          navigation: fixtures.navigation,
          sessions: accounts,
        },
        options: scenarioOptions(plan, shard),
        phaseStart: options.phaseStart,
      });
      const output = join(options.artifactDir, `${shard.workerId}-metrics.json.gz`);
      const script = join(
        root,
        "tests/load/k6",
        plan.contenders
          ? "rush.js"
          : plan.profile === "arrival"
            ? "arrival.js"
            : "shopping.js",
      );
      const child = (options.spawn ?? spawn)(
        options.k6Binary,
        [
          "run",
          "--quiet",
          "--config",
          k6Config,
          "--address",
          `127.0.0.1:${port}`,
          "--out",
          `json=${output}`,
          "--env",
          `LOAD_RUN_CONFIG=${configPath}`,
          script,
        ],
        {
          cwd: root,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            ...Object.fromEntries(
              ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"]
                .filter((key) => process.env[key])
                .map((key) => [key, process.env[key]]),
            ),
            K6_NO_USAGE_REPORT: "true",
          },
        },
      );
      let resolveReady, rejectReady;
      const ready = new Promise((done, fail) => {
        resolveReady = done;
        rejectReady = fail;
      });
      ready.catch(() => {});
      const logPath = join(options.artifactDir, `${shard.workerId}-private.log`);
      const consume = (data) => {
        const message = String(data);
        if (message.includes("LOAD_WORKER_READY")) resolveReady();
        void appendFile(logPath, message, { mode: 0o600 }).catch(() => {});
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      const done = new Promise((resolveDone) => {
        let errorText = "";
        child.stderr.on("data", (data) => {
          if (errorText.length < 2000) errorText += data;
        });
        child.once("error", () => {
          rejectReady(Error("Generator could not start"));
          resolveDone({
            exitCode: 2,
            output,
            workerId: shard.workerId,
            error: "Generator could not start",
          });
        });
        child.once("exit", (code, signal) => {
          rejectReady(Error("Generator exited before ready"));
          resolveDone({
            exitCode: code ?? 1,
            finishedAt: Date.now(),
            signal,
            output,
            workerId: shard.workerId,
            error: errorText ? "Generator reported errors; inspect private log" : null,
          });
        });
      });
      handles.push({
        workerId: shard.workerId,
        shard,
        done,
        ready,
        configPath,
        managementUrl: `http://127.0.0.1:${port}`,
        stop: async () => {
          if (child.exitCode !== null || child.signalCode) return;
          child.kill("SIGTERM");
          let timer;
          await Promise.race([
            done,
            new Promise((resolveStop) => {
              timer = setTimeout(() => {
                child.kill("SIGKILL");
                resolveStop();
              }, 5000);
            }),
          ]);
          clearTimeout(timer);
          await done;
        },
        pid: child.pid,
      });
    }
    return handles;
  } catch (error) {
    await Promise.allSettled(handles.map((handle) => handle.stop()));
    throw error;
  }
}
export async function stopJournalWorkers(journal, artifactDir) {
  const exec = promisify(execFile);
  for (const entry of journal
    .records()
    .filter((x) => x.kind === "worker" && x.data.pid)) {
    const pid = entry.data.pid;
    if (!Number.isSafeInteger(pid) || pid <= 1)
      throw Error("Invalid recorded worker PID");
    let command;
    try {
      if (process.platform === "win32") {
        const script =
          "$ErrorActionPreference='Stop';(Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:SOLE_LOAD_WORKER_PID)).CommandLine";
        command = (
          await exec(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", script],
            {
              env: { ...process.env, SOLE_LOAD_WORKER_PID: String(pid) },
              windowsHide: true,
              timeout: 10000,
            },
          )
        ).stdout;
      } else command = await readFile(`/proc/${pid}/cmdline`, "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") continue;
      throw Error("Cannot verify recorded worker ownership");
    }
    const config = resolve(artifactDir, `${entry.data.id}-private.json`);
    const normalized = command?.replaceAll("\\", "/");
    if (
      normalized &&
      normalized.includes(config.replaceAll("\\", "/")) &&
      normalized.includes("tests/load/k6")
    ) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
}
