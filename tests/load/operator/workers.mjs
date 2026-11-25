import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateJson } from "./journal.mjs";
import { buildThresholds } from "../shared/thresholds.mjs";
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
  return {
    scenarios: { shoppers: scenario },
    thresholds: buildThresholds(plan),
    systemTags: ["status", "method", "name", "scenario", "expected_response"],
    discardResponseBodies: false,
    throw: false,
  };
}
export async function launchWorkers(plan, fixtures, options) {
  const shards = allocateWorkers(plan, options.workerCount ?? 1);
  const handles = [];
  for (const shard of shards) {
    const configPath = resolve(options.artifactDir, `${shard.workerId}-private.json`);
    const accounts = fixtures.sessions.filter(
      (x) => x.slot >= shard.start && x.slot < shard.end,
    );
    await privateJson(configPath, {
      plan,
      shard,
      baseUrl: options.target.baseUrl,
      credential: options.credential,
      fixtures: {
        products: fixtures.products,
        addresses: fixtures.addresses,
        sessions: accounts,
      },
      options: scenarioOptions(plan, shard),
      phaseStart: options.phaseStart,
    });
    const output = join(options.artifactDir, `${shard.workerId}-metrics.jsonl`);
    const script = join(
      root,
      "tests/load/k6",
      plan.profile === "arrival" ? "arrival.js" : "shopping.js",
    );
    const child = (options.spawn ?? spawn)(
      options.k6Binary,
      [
        "run",
        "--quiet",
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
          HOME: options.artifactDir,
          K6_NO_USAGE_REPORT: "true",
        },
      },
    );
    const done = new Promise((resolveDone) => {
      let errorText = "";
      child.stderr.on("data", (data) => {
        if (errorText.length < 2000) errorText += data;
      });
      child.once("error", () =>
        resolveDone({
          exitCode: 2,
          output,
          workerId: shard.workerId,
          error: "Generator could not start",
        }),
      );
      child.once("exit", (code, signal) =>
        resolveDone({
          exitCode: code ?? 1,
          signal,
          output,
          workerId: shard.workerId,
          error: errorText ? "Generator reported errors; inspect private log" : null,
        }),
      );
    });
    handles.push({
      workerId: shard.workerId,
      shard,
      done,
      stop: () => child.kill("SIGTERM"),
      pid: child.pid,
    });
  }
  return handles;
}
