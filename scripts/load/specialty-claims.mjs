import http from "node:http";
import { createConnection } from "node:net";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareSpecialtyLoadRun,
  privateLoadState,
  reconcileLoadRun,
  cleanupSpecialtyLoadRun,
} from "./specialty-fixtures.mjs";
import { connectTestDatabase } from "../../tests/database/fixtures/specialty-claims.mjs";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export async function dispatchBurst(actors, send) {
  let release,
    inFlight = 0,
    maxInFlight = 0;
  const barrier = new Promise((r) => {
      release = r;
    }),
    starts = [];
  const pending = actors.map(async (actor) => {
    await barrier;
    starts.push(performance.now());
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    try {
      return await send(actor);
    } finally {
      inFlight--;
    }
  });
  release();
  const responses = await Promise.all(pending);
  return {
    responses,
    maxInFlight,
    dispatchWindowMs: Math.max(...starts) - Math.min(...starts),
  };
}
export function qualifyReport(report) {
  const reasons = [],
    o = report.outcomes,
    r = report.reconciliation;
  if (
    report.requestCount !== 1000 ||
    report.generator.dispatchWindowMs > 1000 ||
    report.generator.maxInFlight < 1000
  )
    reasons.push("generator_did_not_deliver_1000_simultaneous_submissions");
  if (o.unresolved || o.unexpectedErrors)
    reasons.push("unresolved_or_unexpected_outcomes");
  if (
    report.scenario !== "overload" &&
    (o.retryable ||
      report.latency.p95Ms > 3000 ||
      report.latency.p99Ms > 10000 ||
      report.maxResolutionMs > 30000)
  )
    reasons.push("latency_or_resolution_budget_exceeded");
  if (
    r.winnerCount !== report.expected.winners ||
    r.remainingStock !== report.expected.remainingStock ||
    r.negativeStock ||
    r.duplicateIdentities ||
    r.ordinaryPrizeOrderItems
  )
    reasons.push("database_reconciliation_failed");
  const expectedWon = report.scenario === "replayed-attempt" ? 1000 : r.winnerCount;
  if (o.won !== expectedWon || o.won + o.soldOut + o.alreadyClaimed !== 1000)
    reasons.push("valid_business_outcomes_missing");
  return reasons;
}
export function classifyQualification(report) {
  const passed = report.failureReasons.length === 0;
  return {
    passed,
    siteCapacityPassed:
      passed && report.mode === "real-next-development-http-postgrest-postgresql-redis",
    awardEnginePassed: passed && report.mode === "direct-postgrest-award-engine",
  };
}
export function sendLoadRequest(
  origin,
  path,
  {
    agent,
    cookie,
    payload,
    ip = "198.51.100.25",
    headers = {},
    timeout = 30000,
    onDispatch = () => {},
  } = {},
) {
  return new Promise((resolveResponse) => {
    let ended = false;
    const finish = (value) => {
      if (ended) return;
      ended = true;
      resolveResponse(value);
    };
    const data = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      origin + path,
      {
        method: data ? "POST" : "GET",
        agent,
        headers: {
          Origin: origin,
          "User-Agent": "Mozilla/5.0 SpecialtyQualification/1.0",
          "x-forwarded-for": ip,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 32768) {
            req.destroy();
            finish({ status: 0 });
          } else chunks.push(chunk);
        });
        response.on("end", () => {
          let body = null;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            /* Non-JSON denial is a failed result, never a business loss. */
          }
          finish({ status: response.statusCode, body });
        });
        response.on("error", () => finish({ status: 0 }));
      },
    );
    req.once("finish", onDispatch);
    req.on("error", () => finish({ status: 0 }));
    req.setTimeout(timeout, () => {
      req.destroy();
      finish({ status: 0 });
    });
    req.end(data);
  });
}
const request = sendLoadRequest;
export async function prepareHttpActors(origin, count) {
  const url = new URL(origin),
    sockets = [];
  try {
    // Connection setup is outside the measured burst. Bound it to avoid the OS
    // listen backlog; every socket is ready before any claim is dispatched.
    for (let start = 0; start < count; start += 50) {
      await Promise.all(
        Array.from(
          { length: Math.min(50, count - start) },
          () =>
            new Promise((resolveSocket, reject) => {
              const socket = createConnection({
                host: url.hostname,
                port: Number(url.port),
              });
              sockets.push(socket);
              const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error("TCP preparation timed out; no capacity run started."));
              }, 30000);
              socket.once("close", () => clearTimeout(timer));
              socket.once("connect", () => {
                clearTimeout(timer);
                socket.on("error", () => {});
                resolveSocket();
              });
              socket.once("error", (error) => {
                clearTimeout(timer);
                reject(
                  new Error(
                    "TCP preparation failed (" +
                      error.code +
                      "); no capacity run started.",
                  ),
                );
              });
            }),
        ),
      );
      await delay(25);
    }
    return sockets.map((socket) => {
      const agent = new http.Agent({
        keepAlive: true,
        maxSockets: 1,
        maxFreeSockets: 1,
        timeout: 60000,
      });
      let prepared = socket;
      agent.createConnection = (options) => {
        if (prepared) {
          const connected = prepared;
          prepared = null;
          return connected;
        }
        return createConnection(options);
      };
      const destroy = agent.destroy.bind(agent);
      agent.destroy = () => {
        socket.destroy();
        destroy();
      };
      return agent;
    });
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    throw error;
  }
}
const percentile = (values, p) =>
  values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ??
  0;
export async function runSpecialtyBurst(manifest, options = {}) {
  const { actors, app } = await privateLoadState(manifest);
  const engine = manifest.mode === "award-rpc",
    origin = engine ? app.services.origin : manifest.origin;
  const agents = await prepareHttpActors(origin, actors.length);
  const invoke = async (actor, recovery, options = {}) => {
    if (!engine)
      return request(
        origin,
        recovery ? "/api/specialty/claims/result" : "/api/specialty/claims",
        {
          agent: agents[actor.index],
          cookie: actor.cookie,
          ip: actor.ip,
          payload: recovery
            ? {
                attemptId: actor.payload.attemptId,
                recoverySecret: actor.payload.recoverySecret,
              }
            : actor.payload,
          ...options,
        },
      );
    const proof = JSON.parse(
      Buffer.from(actor.payload.validationToken.split(".")[0], "base64url").toString(),
    ).value;
    const command = {
      attemptId: actor.payload.attemptId,
      recoveryHash: app.helpers.hashRecoverySecret(actor.payload.recoverySecret),
      inputHash: app.helpers.fingerprintInput(actor.payload, app.secret),
      payloadHash: app.helpers.fingerprintSubmission(actor.payload.productId, proof),
      eligibility: proof,
    };
    const response = await request(
      origin,
      "/rest/v1/rpc/" +
        (recovery ? "read_specialty_claim_result" : "accept_specialty_claim"),
      {
        agent: agents[actor.index],
        headers: {
          Authorization: "Bearer " + app.services.serviceKey,
          apikey: app.services.serviceKey,
        },
        payload: recovery
          ? { p_attempt_id: command.attemptId, p_recovery_hash: command.recoveryHash }
          : { p_command: command },
        ...options,
      },
    );
    if (response.status >= 400 && ["55P03", "57014"].includes(response.body?.code))
      return { ...response, rawStatus: response.status, status: 503 };
    if (recovery && response.status === 200 && !response.body)
      return { ...response, status: 202 };
    return response;
  };
  let lock;
  try {
    // TCP is ready before the barrier; preparation does not issue HTTP work.
    if (manifest.scenario === "overload") {
      lock = await connectTestDatabase();
      await lock.query("begin");
      await lock.query(
        "select v.id from public.product_variants v where product_id=any($1::uuid[]) for update",
        [manifest.productIds],
      );
      setTimeout(() => void lock.query("commit").catch(() => {}), 7000).unref();
    }
    const dispatches = [],
      latencies = [],
      resolution = [],
      initialCodes = {};
    let networkInFlight = 0,
      networkMax = 0,
      retryCount = 0,
      lostResponses = 0;
    const outcomes = {
      won: 0,
      soldOut: 0,
      alreadyClaimed: 0,
      retryable: 0,
      unresolved: 0,
      unexpectedErrors: 0,
    };
    const burst = await dispatchBurst(
      actors.map((actor, index) => ({ ...actor, index })),
      async (actor) => {
        const start = performance.now();
        let response = await invoke(actor, false, {
          onDispatch: () => {
            dispatches.push(performance.now());
            networkMax = Math.max(networkMax, ++networkInFlight);
          },
        });
        networkInFlight--;
        latencies.push(performance.now() - start);
        const initialStatus = response.rawStatus ?? response.status;
        initialCodes[initialStatus] = (initialCodes[initialStatus] ?? 0) + 1;
        if (
          manifest.scenario === "lost-response" &&
          response.body?.result?.status === "won"
        ) {
          response = { status: 0 };
          lostResponses++;
        }
        let result = response.body?.result;
        if (!result && response.status && ![202, 429, 503].includes(response.status)) {
          outcomes.unexpectedErrors++;
          resolution.push(performance.now() - start);
          return;
        }
        while (!result && performance.now() - start < 29000) {
          retryCount++;
          await delay(500 + Math.random() * 500);
          response = await invoke(actor, true, {
            timeout: Math.max(1, 30000 - (performance.now() - start)),
          });
          result = response.body?.result;
          if (!result && response.status === 202 && performance.now() - start < 28000) {
            response = await invoke(actor, false, {
              timeout: Math.max(1, 30000 - (performance.now() - start)),
            });
            result = response.body?.result;
          }
        }
        const key = {
          won: "won",
          sold_out: "soldOut",
          already_claimed: "alreadyClaimed",
        }[result?.status];
        if (key) outcomes[key]++;
        else if (result) outcomes.unexpectedErrors++;
        else {
          outcomes.unresolved++;
          if ([429, 503].includes(response.status)) outcomes.retryable++;
        }
        resolution.push(performance.now() - start);
      },
    );
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const report = {
      target: manifest.target,
      mode: engine
        ? "direct-postgrest-award-engine"
        : "real-next-development-http-postgrest-postgresql-redis",
      sourceSha: sha,
      dirty: !!execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
      scenario: manifest.scenario,
      actorCount: manifest.actorCount,
      requestCount: manifest.requestCount,
      outcomes,
      latency: { p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99) },
      maxResolutionMs: Math.max(...resolution),
      generator: {
        node: process.version,
        dispatchWindowMs: dispatches.length
          ? Math.max(...dispatches) - Math.min(...dispatches)
          : Infinity,
        maxInFlight: networkMax,
        scheduledDispatchWindowMs: burst.dispatchWindowMs,
        establishedConnections: agents.length,
        distinctSyntheticIps: new Set(actors.map((actor) => actor.ip)).size,
        serverIngressWindowMs: null,
      },
      initialHttpStatuses: initialCodes,
      retryCount,
      lostResponses,
      reconciliation: await reconcileLoadRun(manifest),
      runtimeDiagnostics: {
        gateway: app.services.getDiagnostics(),
        next: await nextTimings(app.privateDir),
      },
      expected: {
        winners: manifest.expectedWinners,
        remainingStock: manifest.initialStock - manifest.expectedWinners,
      },
      differences: [
        ...(engine
          ? [
              "Award engine isolation only: protected Next API, browser validation, BotID and Redis quotas are not part of this measured path; site capacity remains a separate gate",
            ]
          : []),
        "Next development server; local shared machine and Docker",
        "Prepared signed eligibility; Shippo cold validation not measured",
        "BotID supported development HUMAN verdict; no hosted WAF/bot evidence",
        "Actual Redis scripts via local REST bridge; IP quotas enforced with trusted loopback-only synthetic forwarded addresses; shared-IP run is separate",
        "Synthetic Auth provider; real app origin/browser-cookie/credential checks",
        "Server ingress timing unavailable; socket flush dispatch measured",
      ],
    };
    report.failureReasons = qualifyReport(report);
    if (manifest.scenario === "lost-response" && lostResponses !== 1) {
      report.failureReasons.push("committed_response_loss_not_exercised");
    }
    Object.assign(report, classifyQualification(report));
    return report;
  } finally {
    for (const agent of agents) agent.destroy();
    if (lock) {
      await lock.query("rollback").catch(() => {});
      await lock.end();
    }
    void options;
  }
}
async function nextTimings(privateDir) {
  const log = await readFile(resolve(privateDir, "next.log"), "utf8").catch(() => "");
  const requests = log
    .split("\n")
    .filter((line) => line.includes("POST /api/specialty/claims "));
  const values = (label) =>
    requests.flatMap((line) => {
      const match = line.match(new RegExp(label + ": ([\\d.]+)(ms|s)"));
      return match ? [Number(match[1]) * (match[2] === "s" ? 1000 : 1)] : [];
    });
  return {
    completedResponses: requests.length,
    proxyP95Ms: percentile(values("proxy.ts"), 0.95),
    handlerP95Ms: percentile(values("application-code"), 0.95),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
  );
  let manifest;
  try {
    manifest = await prepareSpecialtyLoadRun({
      target: args.target ?? "local",
      scenario: args.scenario ?? "hot-one",
      mode: args.mode ?? "protected",
      concurrency: Number(args.concurrency ?? 1000),
      origin: args["base-url"] ?? "http://localhost:3000",
    });
    const report = await runSpecialtyBurst(manifest);
    await mkdir("test-results/specialty/load", { recursive: true });
    await writeFile(
      "test-results/specialty/load/" +
        manifest.scenario +
        (manifest.mode === "award-rpc" ? "-award-rpc" : "") +
        ".json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(
      "Specialty load setup/qualification failed: " +
        String(error.message).split("\n")[0],
    );
    process.exitCode = 1;
  } finally {
    if (manifest) await cleanupSpecialtyLoadRun(manifest);
  }
}
