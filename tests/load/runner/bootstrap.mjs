import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import { ensureBrowserRuntime } from "../browser/probe.mjs";
import { allocateWorkers } from "../operator/workers.mjs";
import { createSupabaseMetricsCollector } from "../operator/telemetry.mjs";
const exec = promisify(execFile),
  require = createRequire(import.meta.url),
  lock = require("../config/toolchain.json");
export function verifyToolchain(value) {
  if (
    value.node !== lock.node ||
    value.k6 !== lock.k6.version ||
    value.chromium !== lock.playwright.chromiumVersion ||
    value.checksumVerified !== true
  )
    throw Error("Toolchain version or checksum differs from the locked runner");
  return value;
}
export function parseK6Version(value) {
  return value.match(/\bk6(?:\.exe)? v([\d.]+)/)?.[1] ?? null;
}
async function trustedK6() {
  const platform = process.platform === "win32" ? "windows" : process.platform,
    asset = lock.k6.assets[`${platform}-${process.arch}`];
  if (!asset) throw Error("Unsupported locked k6 platform");
  const tools = resolve(".load-test/tools");
  await mkdir(tools, { recursive: true });
  const archive = join(tools, asset.file);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch {
    const response = await fetch(
      `https://github.com/grafana/k6/releases/download/v${lock.k6.version}/${asset.file}`,
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok) throw Error("Pinned k6 reference download failed");
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw Error("k6 archive checksum mismatch");
  await writeFile(archive, bytes);
  const extraction = join(tools, `verified-${platform}-${process.arch}`);
  await mkdir(extraction, { recursive: true });
  if (platform === "windows") {
    const script =
      "Expand-Archive -LiteralPath $env:SOLE_K6_ARCHIVE -DestinationPath $env:SOLE_K6_EXTRACTION -Force";
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, SOLE_K6_ARCHIVE: archive, SOLE_K6_EXTRACTION: extraction },
      windowsHide: true,
    });
  } else await exec("tar", ["-xzf", archive, "-C", extraction], { windowsHide: true });
  const folder = asset.file.replace(/\.(zip|tar\.gz)$/, ""),
    binary = join(extraction, folder, platform === "windows" ? "k6.exe" : "k6");
  if (platform !== "windows") await chmod(binary, 0o755);
  return binary;
}
export function createNetworkReader() {
  let previous;
  return async () => {
    try {
      let current;
      if (process.platform === "win32") {
        const script =
          "$ErrorActionPreference='Stop';$route=Get-NetRoute -DestinationPrefix '0.0.0.0/0'|Sort-Object RouteMetric|Select-Object -First 1;$adapter=Get-NetAdapter | Where-Object ifIndex -EQ $route.InterfaceIndex;$stats=$adapter|Get-NetAdapterStatistics;@{received=[double]$stats.ReceivedBytes;sent=[double]$stats.SentBytes;speed=[double]$adapter.ReceiveLinkSpeed;drops=[double]$stats.ReceivedDiscardedPackets+[double]$stats.OutboundDiscardedPackets}|ConvertTo-Json -Compress";
        current = JSON.parse(
          (
            await exec(
              "powershell.exe",
              ["-NoProfile", "-NonInteractive", "-Command", script],
              { windowsHide: true, timeout: 10000 },
            )
          ).stdout,
        );
      } else {
        const routes = await readFile("/proc/net/route", "utf8"),
          iface = routes
            .split("\n")
            .map((x) => x.trim().split(/\s+/))
            .find((x) => x[1] === "00000000")?.[0];
        if (!iface || !/^[\w.-]+$/.test(iface)) throw Error("No measured route");
        const base = `/sys/class/net/${iface}`;
        const values = await Promise.all(
          [
            "statistics/rx_bytes",
            "statistics/tx_bytes",
            "speed",
            "statistics/rx_dropped",
            "statistics/tx_dropped",
          ].map((path) => readFile(`${base}/${path}`, "utf8").then(Number)),
        );
        current = {
          received: values[0],
          sent: values[1],
          speed: values[2] * 1000000,
          drops: values[3] + values[4],
        };
      }
      const at = Date.now();
      if (!(current.speed > 0) || !Object.values(current).every(Number.isFinite))
        throw Error("NIC counters unavailable");
      const prior = previous;
      previous = { ...current, at };
      if (!prior)
        return {
          available: true,
          saturated: null,
          reason: "Waiting for the second NIC sample",
        };
      const seconds = (at - prior.at) / 1000,
        utilization =
          (Math.max(current.received - prior.received, current.sent - prior.sent) * 8) /
          seconds /
          current.speed;
      return {
        available: true,
        saturated: utilization >= 0.7 || current.drops > prior.drops,
        utilization,
        linkBitsPerSecond: current.speed,
        scope: "local NIC counters; upstream transit and geography are separate",
      };
    } catch {
      return {
        available: false,
        reason: "Automatic default-route NIC speed/counters unavailable",
      };
    }
  };
}
export async function bootstrapRunner({ env = process.env, target } = {}) {
  if (process.versions.node !== lock.node)
    throw Error(`Use Node ${lock.node} for the locked load runner`);
  const reference = await trustedK6(),
    binary = env.K6_BINARY ? resolve(env.K6_BINARY) : reference,
    hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  if (hash(await readFile(binary)) !== hash(await readFile(reference)))
    throw Error(
      "Installed k6 binary differs from the checksum-verified official executable",
    );
  const version = parseK6Version(
    (await exec(binary, ["version"], { windowsHide: true })).stdout,
  );
  const runtime = await ensureBrowserRuntime(),
    browser = await chromium.launch({
      executablePath: runtime.executablePath,
      headless: true,
    });
  let chromiumVersion;
  try {
    chromiumVersion = browser.version();
  } finally {
    await browser.close();
  }
  verifyToolchain({
    node: process.versions.node,
    k6: version,
    chromium: chromiumVersion,
    checksumVerified: true,
  });
  return {
    id: "local",
    region: env.LOAD_TEST_RUNNER_REGION ?? "unverified",
    proof: "unproven",
    k6Binary: binary,
    networkReader: createNetworkReader(),
    databaseMetrics: target
      ? createSupabaseMetricsCollector(target, env.SUPABASE_SECRET_KEY)
      : null,
    toolchain: { ...lock, k6ExecutableSha256: hash(await readFile(binary)) },
  };
}
export function planWorkerShards(plan, capabilities) {
  if (
    !capabilities.length ||
    new Set(capabilities.map((x) => x.id)).size !== capabilities.length ||
    capabilities.reduce((n, x) => n + x.httpSlots, 0) < plan.httpSlots
  )
    throw Error("Worker capacity or identities invalid");
  const shards = allocateWorkers(plan, capabilities.length);
  for (let index = 0; index < shards.length; index++) {
    if (shards[index].end - shards[index].start > capabilities[index].httpSlots)
      throw Error("Shard exceeds enrolled runner bound");
    shards[index] = {
      ...shards[index],
      runnerId: capabilities[index].id,
      targetDigest: plan.targetDigest,
      workloadDigest: plan.workloadDigest,
      deadline: plan.deadline,
      generationStart: 0,
      generationEnd: 1000000,
    };
  }
  return shards;
}
export async function createCoordinator(
  plan,
  {
    workerCount = 1,
    readyTimeoutMs = 120000,
    releaseDelayMs = plan.contenders ? 5000 : 2000,
    heartbeat = async () => {},
  } = {},
) {
  const shards = allocateWorkers(plan, workerCount),
    tokens = new Map(shards.map((x) => [x.workerId, randomBytes(32).toString("hex")])),
    ready = new Set(),
    browsers = new Set(),
    prepared = new Set();
  let phaseStart = null,
    closed = false,
    resolveRelease,
    rejectRelease;
  const release = new Promise((done, fail) => {
    resolveRelease = done;
    rejectRelease = fail;
  });
  release.catch(() => {});
  const timeout = setTimeout(
    () => rejectRelease(Error("Not every worker became ready before the deadline")),
    readyTimeoutMs,
  );
  function maybeRelease() {
    if (
      phaseStart === null &&
      ready.size === shards.length &&
      browsers.size === plan.browserSlots &&
      prepared.size === (plan.contenders ?? 0)
    ) {
      phaseStart = Date.now() + releaseDelayMs;
      clearTimeout(timeout);
      resolveRelease(phaseStart);
    }
  }
  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        !["/ready", "/prepared", "/release"].includes(request.url)
      )
        throw Error("Unknown coordinator request");
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 1000) throw Error("Coordinator payload too large");
      }
      const value = JSON.parse(raw),
        shard = shards.find((x) => x.workerId === value.workerId);
      if (!shard || request.headers["x-worker-token"] !== tokens.get(shard.workerId))
        throw Error("Worker not enrolled");
      if (request.url === "/ready") ready.add(shard.workerId);
      if (request.url === "/prepared") {
        if (
          !Number.isInteger(value.slot) ||
          value.slot < shard.start ||
          value.slot >= Math.min(shard.end, plan.contenders)
        )
          throw Error("Prepared slot outside contender range");
        prepared.add(value.slot);
      }
      maybeRelease();
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ phaseStart }));
    } catch {
      response.writeHead(403);
      response.end("{}");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get phaseStart() {
      return phaseStart;
    },
    tokenFor: (id) => tokens.get(id),
    async browserReady(slot) {
      if (slot < plan.httpSlots || slot >= plan.totalSlots)
        throw Error("Browser outside global range");
      browsers.add(slot);
      maybeRelease();
      return release;
    },
    waitForRelease: () => release,
    heartbeat,
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      if (!phaseStart) rejectRelease(Error("Worker coordination stopped before ready"));
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}
