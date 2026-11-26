import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { Client } from "pg";
import { parseTarget, assertAttestation } from "../shared/contracts.mjs";
import { createRunPlan } from "../shared/profiles.mjs";
import { validateDispatchWindow } from "../shared/campaign.mjs";
import { preflightRun, createControlClient, boundedFetch } from "./preflight.mjs";
import { executeRun, executeAcceptance, executeSelectedProfile } from "./orchestrate.mjs";
import { openJournal, privateJson, secureDirectory } from "./journal.mjs";
import { seedFixtures } from "./seed.mjs";
import { createFixtureClients } from "./fixture-clients.mjs";
import {
  createSessionAuth,
  prepareSessionPool,
  leaseShopper,
  accountSlotsForPlan,
} from "./sessions.mjs";
import { launchWorkers, stopJournalWorkers } from "./workers.mjs";
import {
  startTelemetry,
  createGeneratorCollector,
  collectDatabaseSnapshot,
  collectQueueSnapshot,
  readK6LiveCounters,
} from "./telemetry.mjs";
import {
  collectDurableOutcomes,
  collectInventoryOutcomes,
  inventoryViolations,
} from "./assertions.mjs";
import { drainRun, cleanupRun, createCleanupClients } from "./cleanup.mjs";
import { evaluateRun, readWorkerResult, writeRunReport } from "./report.mjs";
import { runBrowserCohort } from "../browser/probe.mjs";
import { enrollTarget } from "./enroll.mjs";
import { createErrorGuard } from "./guards.mjs";
const exec = promisify(execFile);
export async function loadOperatorEnvironment() {
  let env = { ...process.env };
  if (env.LOAD_TEST_DOPPLER_CONFIG) {
    if (
      !/^[\w-]+$/.test(env.LOAD_TEST_DOPPLER_CONFIG) ||
      /^(dev|prd|prod|production)$/.test(env.LOAD_TEST_DOPPLER_CONFIG)
    )
      throw Error("Select an explicitly named staging Doppler configuration");
    const result = await exec(
      "doppler",
      [
        "secrets",
        "download",
        "--no-file",
        "--format",
        "json",
        "--project",
        "solesneakers",
        "--config",
        env.LOAD_TEST_DOPPLER_CONFIG,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    env = { ...JSON.parse(result.stdout), ...env };
  }
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return env;
}
async function operatorSetup(env) {
  const path = resolve(env.LOAD_TEST_CONFIG ?? ".load-test/staging.json");
  let raw;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw Error("Staging target config is invalid");
    if (!env.LOAD_TEST_RESOURCE_MANIFEST || !env.LOAD_TEST_BASE_URL)
      throw Error(
        "Deploy staging, authorize its enrollment environment, and supply LOAD_TEST_BASE_URL with the immutable deployment URL.",
      );
    const commit =
      env.LOAD_TEST_EXPECTED_COMMIT ??
      (await exec("git", ["rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
    raw = await enrollTarget(
      JSON.parse(env.LOAD_TEST_RESOURCE_MANIFEST),
      env.LOAD_TEST_BASE_URL,
      commit,
      (target) => createControlClient(target, env.LOAD_TEST_SIGNING_KEY)("attest", {}),
    );
    await secureDirectory(resolve(".load-test"));
    await privateJson(path, raw);
  }
  return parseTarget(raw);
}
export function verifyDatabaseBinding(target, value) {
  const url = new URL(value);
  const ref = target.resources.supabase.projectRef;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (!url.hostname.includes(`db.${ref}.`) &&
      !decodeURIComponent(url.username).endsWith(`.${ref}`)) ||
    target.productionDenylist.hosts.includes(url.hostname) ||
    target.productionDenylist.supabaseRefs.some(
      (id) =>
        url.hostname.includes(`db.${id}.`) ||
        decodeURIComponent(url.username).endsWith(`.${id}`),
    )
  )
    throw Error("Database URL does not belong to the enrolled staging project");
}
export async function runCommand(input) {
  const env = await loadOperatorEnvironment(),
    target = await operatorSetup(env),
    control = createControlClient(target, env.LOAD_TEST_SIGNING_KEY);
  let runner;
  const commandDeadline = Date.now() + target.budget.maxDurationSeconds * 1000;
  const db = new Client({
    connectionString: env.SUPABASE_DB_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    query_timeout: 12000,
  });
  let connected = false;
  const redis = new Redis({
      url: target.resources.redis.url,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    admin = createClient(
      target.resources.supabase.url,
      env.SUPABASE_SECRET_KEY ?? "missing",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: boundedFetch },
      },
    );
  const resources = async () => {
    verifyDatabaseBinding(target, env.SUPABASE_DB_URL);
    if (!connected) {
      await db.connect();
      connected = true;
    }
    const heads = (
      await db.query(
        "select version from supabase_migrations.schema_migrations order by version desc limit 1",
      )
    ).rows;
    if (!target.migrationHeads.includes(heads[0]?.version))
      throw Error("Actual database migration head differs from enrollment");
    await redis.ping();
    return { status: "pass" };
  };
  const tooling = async () => {
    const { bootstrapRunner } = await import("../runner/bootstrap.mjs");
    runner = await bootstrapRunner({ env, target });
    return { status: "pass" };
  };
  const preflight = (profile) =>
    preflightRun(target, profile, { env, control, resources, tooling });
  const run = async (profile, options = {}) => {
    if (profile === "faults" && !options.fault)
      options = { ...options, fault: "response-loss" };
    if (["perimeter", "sandbox"].includes(profile)) {
      const { probeBoundedContracts } = await import("./provider-contracts.mjs");
      return probeBoundedContracts(profile, target, env);
    }
    const plan = createRunPlan(target, profile, options),
      artifactDir = resolve(".load-test/runs", plan.runId);
    await secureDirectory(artifactDir);
    const journal = await openJournal(plan, artifactDir);
    await privateJson(join(artifactDir, "run-plan.json"), plan);
    process.stderr.write(`Load run ${plan.runId}; private artifacts: ${artifactDir}\n`);
    const assertActive = async () => {
      if (Date.now() >= commandDeadline)
        throw Error("The command duration budget was exhausted");
      try {
        await readFile(join(artifactDir, "stop.request"));
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      throw Error("Operator stop requested");
    };
    const clients = { db, control };
    let cleanupClients,
      telemetryHandle,
      telemetry,
      workers = [],
      browserAbort = new AbortController(),
      monitor,
      leaseTimer,
      coordinator,
      measured = false,
      stopReason;
    const phase = {
      preflight: () => preflight(profile),
      recheck: async () => {
        if (Date.now() >= commandDeadline)
          throw Error("The command duration budget was exhausted");
        return assertAttestation(
          target,
          await control("attest", {}),
          profile === "claim-rush" ? ["shopping", "specialty-claims"] : ["shopping"],
        );
      },
      register: async () =>
        control("register", {
          runId: plan.runId,
          phaseId: plan.runId,
          profile,
          start: 0,
          end: plan.totalSlots,
          expiresAt: Date.now() + 4 * 3600000,
        }),
      seed: async () => {
        const fixtures = await seedFixtures(
          target,
          plan,
          {
            ...createFixtureClients({ admin, db, control, runId: plan.runId }),
            assertActive,
          },
          journal,
        );
        cleanupClients = createCleanupClients({
          db,
          admin,
          control,
          runId: plan.runId,
          journal,
        });
        return fixtures;
      },
      sessions: async (context) => {
        const pool = await prepareSessionPool(target, plan, context.fixtures, {
          assertActive,
          auth: createSessionAuth(target, env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        });
        context.fixtures.sessions = [];
        const accountSlots = accountSlotsForPlan(plan);
        for (let slot = 0; slot < plan.totalSlots; slot++) {
          const account = accountSlots.has(slot);
          const lease = await leaseShopper(pool, slot, 0, { account });
          const identity = { ...lease };
          delete identity.release;
          context.fixtures.sessions.push(identity);
        }
        return pool;
      },
      measure: async (context) => {
        if (
          Date.now() +
            (plan.warmupSeconds +
              plan.measurementSeconds +
              plan.gracefulStopSeconds +
              120) *
              1000 >
          commandDeadline
        )
          throw Error(
            "Insufficient approved time remains for the full profile and drain; the measured hold will not be shortened",
          );
        if (
          context.registration.expiresAt <
          Date.now() + (plan.durationSeconds + 120) * 1000
        )
          context.registration = await phase.register();
        const discovery = await runBrowserCohort(
          {
            ...plan,
            httpSlots: 0,
            browserSlots: 2,
            browserViewports: { mobile: 1, desktop: 1 },
            warmupSeconds: 0,
            measurementSeconds: 0,
          },
          context.fixtures,
          {
            target,
            credential: context.registration.credential,
            mode: "discovery",
            phaseStart: Date.now(),
          },
        );
        if (discovery.errors.length)
          throw Error("Browser discovery failed before main load");
        const captured = discovery.resources.filter(
          (x) => x.type === "navigation-assets",
        );
        context.fixtures.navigation = {
          paths: [...new Set(captured.flatMap((x) => x.paths))].slice(0, 100),
          replay: captured.flatMap((x) => x.replay).slice(0, 5),
        };
        const { createCoordinator } = await import("../runner/bootstrap.mjs");
        const phaseStart = Date.now() + 120000;
        const leaseIds = [];
        coordinator = await createCoordinator(plan, {
          workerCount: Number(env.LOAD_TEST_WORKERS ?? 1),
          heartbeat: async () => {
            if (leaseIds.length)
              await control("heartbeat", { runId: plan.runId, workerIds: leaseIds });
          },
        });
        plan.provenance = {
          ...target.expected,
          providerMode: target.providerMode,
          region: target.region,
          runnerRegion: env.LOAD_TEST_RUNNER_REGION ?? "unverified",
          tiers: { verified: false },
          toolchain: runner.toolchain,
        };
        plan.requiredTelemetry = target.telemetry;
        const safeAbort = async (reason) => {
          if (stopReason) return;
          stopReason = reason;
          browserAbort.abort();
          await Promise.allSettled(workers.map((x) => x.stop()));
          await coordinator?.close();
          await control("revoke", { runId: plan.runId }).catch(() => {});
        };
        const signals = () => {
          void safeAbort("Operator stopped the run");
        };
        process.once("SIGINT", signals);
        process.once("SIGTERM", signals);
        let eventBusy = false,
          lastIdentity = 0;
        const errorGuard = createErrorGuard();
        const live = new Map();
        try {
          workers = await launchWorkers(plan, context.fixtures, {
            artifactDir,
            target,
            k6Binary: runner.k6Binary,
            credential: context.registration.credential,
            phaseStart,
            workerCount: Number(env.LOAD_TEST_WORKERS ?? 1),
            coordinator,
            leaseCredential: async (shard) => {
              const lease = await control("lease", {
                runId: plan.runId,
                workerId: shard.workerId,
                start: shard.start,
                end: shard.end,
              });
              leaseIds.push(shard.workerId);
              leaseTimer ??= setInterval(() => {
                void coordinator
                  .heartbeat()
                  .catch(() => safeAbort("Worker lease renewal failed"));
              }, 10000);
              return lease.credential;
            },
          });
          for (const worker of workers)
            await journal.intent("worker", worker.workerId, {
              id: worker.workerId,
              pid: worker.pid,
            });
          for (const worker of workers)
            void worker.done.then(() => {
              if (Date.now() < (plan.measurementEnd ?? Infinity))
                void safeAbort("A generator stopped before the measured hold ended");
            });
          telemetryHandle = await startTelemetry(plan, {
            generator: createGeneratorCollector(runner.networkReader),
            database: {
              intervalMs: 60000,
              read: async () => ({
                ...(await collectDatabaseSnapshot(db)),
                ...(await runner.databaseMetrics.read()),
              }),
            },
            application: {
              intervalMs: 5000,
              read: async () => {
                const values = await Promise.all(
                  workers.map(async (worker) => {
                    const sample = await readK6LiveCounters(worker.managementUrl);
                    live.set(worker.workerId, sample);
                    return sample;
                  }),
                );
                return {
                  observer: "generator HTTP counters",
                  requests: values.reduce((n, x) => n + x.requests, 0),
                  technicalAttempts: values.reduce((n, x) => n + x.attempts, 0),
                  unexpectedErrors: values.reduce((n, x) => n + x.errors, 0),
                };
              },
            },
            redis: {
              intervalMs: 10000,
              read: async () => {
                const started = performance.now();
                await redis.ping();
                return {
                  available: true,
                  limitExceeded: null,
                  simulationOverhead: {
                    controlProbeMs: performance.now() - started,
                    ledgerUsage:
                      "shares enrolled staging Redis; provider API limits not exported",
                  },
                };
              },
            },
            queues: {
              intervalMs: 10000,
              read: () =>
                collectQueueSnapshot(
                  db,
                  context.fixtures.products.map((x) => x.variantId),
                ),
            },
          });
          monitor = setInterval(async () => {
            if (eventBusy) return;
            eventBusy = true;
            try {
              if (
                await readFile(join(artifactDir, "stop.request"), "utf8").then(
                  () => true,
                  () => false,
                )
              )
                await safeAbort("Operator stop requested");
              const current = [...live.values()];
              const requests = current.reduce((n, x) => n + x.requests, 0);
              if (requests >= target.budget.maxRequests * 0.9)
                await safeAbort("Approved request budget reached its stop reserve");
              const total = {
                attempts: current.reduce((n, x) => n + x.attempts, 0),
                errors: current.reduce((n, x) => n + x.errors, 0),
              };
              if (
                coordinator.phaseStart &&
                Date.now() > coordinator.phaseStart + 15000 &&
                workers.some(
                  (worker) =>
                    !live.has(worker.workerId) ||
                    Date.now() - live.get(worker.workerId).at > 15000,
                )
              )
                await safeAbort("Live emergency counters became unavailable");
              if (errorGuard.observe({ at: Date.now(), ...total }))
                await safeAbort(
                  "Unexpected technical errors exceeded five percent for sixty seconds",
                );
              if (Date.now() - lastIdentity > 30000) {
                lastIdentity = Date.now();
                await phase.recheck();
                const variants = await collectInventoryOutcomes(
                  db,
                  context.fixtures.products,
                );
                if (
                  variants.length !== context.fixtures.products.length ||
                  inventoryViolations(variants).length
                ) {
                  await privateJson(join(artifactDir, "live-invariant-violation.json"), {
                    at: Date.now(),
                    variants,
                  });
                  await safeAbort("Live inventory conservation violation");
                }
              }
              await control("events", { runId: plan.runId });
            } catch {
              await safeAbort(
                "Control identity, worker lease or recovery channel became unavailable",
              );
            } finally {
              eventBusy = false;
            }
          }, 5000);
          const browserPromise = runBrowserCohort(plan, context.fixtures, {
            target,
            credential: await control("lease", {
              runId: plan.runId,
              workerId: "browser-0",
              start: plan.httpSlots,
              end: plan.totalSlots,
            }).then((value) => {
              leaseIds.push("browser-0");
              return value.credential;
            }),
            signal: browserAbort.signal,
            ready: (slot) => coordinator.browserReady(slot),
            get phaseStart() {
              return coordinator.phaseStart ?? phaseStart;
            },
          });
          void browserPromise.catch(() =>
            safeAbort("Browser worker could not start or complete"),
          );
          await coordinator.waitForRelease();
          plan.measurementStart = coordinator.phaseStart + plan.warmupSeconds * 1000;
          plan.measurementEnd = plan.measurementStart + plan.measurementSeconds * 1000;
          await privateJson(join(artifactDir, "run-plan.json"), plan);
          const timeout = setTimeout(
            () => {
              void safeAbort("Run deadline reached");
            },
            Math.max(
              1,
              Math.min(
                commandDeadline,
                plan.measurementEnd + plan.gracefulStopSeconds * 1000,
              ) - Date.now(),
            ),
          );
          let completions, browser;
          try {
            [completions, browser] = await Promise.all([
              Promise.all(workers.map((worker) => worker.done)),
              browserPromise,
            ]);
          } finally {
            clearTimeout(timeout);
          }
          const results = await Promise.all(
            completions.map((value) => readWorkerResult(value, plan)),
          );
          results.push(browser);
          if (stopReason) results[0]?.errors.push(stopReason);
          measured = true;
          return { workers: results, telemetry: null };
        } finally {
          clearInterval(monitor);
          clearInterval(leaseTimer);
          process.removeListener("SIGINT", signals);
          process.removeListener("SIGTERM", signals);
          await Promise.allSettled(workers.map((x) => x.stop()));
          browserAbort.abort();
          await coordinator?.close();
          telemetry = await telemetryHandle?.stop();
        }
      },
      revoke: () => control("revoke", { runId: plan.runId }),
      drain: async () => {
        cleanupClients ??= createCleanupClients({
          db,
          admin,
          control,
          runId: plan.runId,
          journal,
        });
        return drainRun(target, plan, cleanupClients, journal);
      },
      assert: async () => {
        const value = await collectDurableOutcomes(clients, plan, journal);
        await privateJson(join(artifactDir, "durable-invariants.json"), value);
        return value;
      },
      cleanup: () => cleanupRun(target, journal, cleanupClients),
      report: async (context) => {
        context.report.artifactDir = artifactDir;
        context.report.files = await writeRunReport(context.report, artifactDir);
      },
    };
    if (
      profile === "faults" &&
      ![
        "square-timeout",
        "timeout-after-capture",
        "response-loss",
        "decline",
        "shippo-unavailable",
        "smtp-outage",
      ].includes(plan.fault)
    )
      return {
        profile,
        status: "unmet",
        gates: [
          {
            name: "fault-mechanism",
            status: "unmet",
            reasons: [
              "Exclusive dependency fault or event/expiry scenario mechanism has not been enrolled",
            ],
          },
        ],
        cleanup: { status: "cleaned" },
      };
    const originalMeasure = phase.measure;
    phase.measure = async (context) => {
      if (plan.fault) await control("faults", { runId: plan.runId, kind: plan.fault });
      try {
        return await originalMeasure(context);
      } finally {
        if (plan.fault) await control("faults", { runId: plan.runId, kind: "none" });
      }
    };
    return executeRun(target, profile, {
      plan,
      phase,
      evaluate: (context) => {
        const report = evaluateRun(
          plan,
          context.measured?.workers ?? [],
          context.invariants,
          telemetry ?? {},
        );
        const resources = context.measured?.workers.flatMap((x) => x.resources) ?? [];
        const full = resources.filter(
          (x) => x.type === "full-session-evidence" && x.completedSessions,
        );
        const count = full.reduce((n, x) => n + x.completedSessions, 0);
        report.fullSessionEvidence = {
          completedSessions: count,
          meanSessionSeconds: count
            ? full.reduce((n, x) => n + x.meanSessionSeconds * x.completedSessions, 0) /
              count
            : null,
          requestsPerSession: count
            ? full.reduce((n, x) => n + x.requestsPerSession * x.completedSessions, 0) /
              count
            : null,
        };
        if (plan.contenders) {
          const values = resources
            .filter((x) => x.type === "rush-dispatch")
            .flatMap((x) => x.values);
          const dispatch = validateDispatchWindow(values, {
            releaseAt: coordinator?.phaseStart ?? 0,
            dispatchWindowMs: 1000,
          });
          if (values.length !== plan.contenders) {
            dispatch.status = "fail";
            dispatch.reasons.push("Not every contender dispatched exactly once");
          }
          report.gates.push({ name: "opening-dispatch", ...dispatch });
        }
        const navigation = resources.filter((x) => x.type === "navigation-assets");
        if (!navigation.some((x) => x.replay?.length))
          report.gates.push({
            name: "next-navigation-replay",
            status: "unmet",
            reasons: [
              "No safe observed Flight navigation replay was exercised by protocol workers",
            ],
          });
        report.gates.push(
          {
            name: "provider-perimeter",
            status: "unmet",
            reasons: [
              "Separate normal-perimeter and real Sandbox contract runs remain required",
            ],
          },
          {
            name: "resource-cost",
            status: "unmet",
            reasons: [
              `No new resources provisioned; actual provider usage within USD ${target.budget.maxCostUsd} ceiling requires platform evidence`,
            ],
          },
        );
        if (!measured)
          report.gates.push({
            name: "measurement",
            status: "unmet",
            reasons: ["No complete coordinated measurement"],
          });
        report.status = report.gates.some((x) => x.status === "fail")
          ? "fail"
          : report.gates.some((x) => x.status === "unmet")
            ? "unmet"
            : "pass";
        report.scope.capacityProven =
          report.status === "pass" && report.scope.capacityProven;
        return report;
      },
    });
  };
  try {
    if (input.action) {
      const dir = resolve(".load-test/runs", input.runId),
        plan = JSON.parse(await readFile(join(dir, "run-plan.json"), "utf8"));
      if (plan.runId !== input.runId || plan.targetDigest !== target.digest)
        throw Error("Recovery target identity changed");
      const check = await preflightRun(target, "recovery", {
        env,
        control,
        resources,
        tooling: async () => ({ status: "pass" }),
      });
      if (!check.allowed) return { summary: check, exitCode: 2 };
      if (plan.profile === "sandbox-contract") {
        const { probeBoundedContracts } = await import("./provider-contracts.mjs");
        const result = await probeBoundedContracts("sandbox", target, {
          ...env,
          LOAD_TEST_SANDBOX_RUN_ID: input.runId,
        });
        return {
          summary: {
            status: result.sdkStatus,
            report: result.files.markdownPath,
            cleanup: result.cleanup,
          },
          exitCode:
            result.cleanup?.status === "incomplete"
              ? 3
              : result.sdkStatus === "pass"
                ? 0
                : 2,
        };
      }
      const recoveryJournal = await openJournal(plan, dir);
      if (
        recoveryJournal
          .records()
          .some(
            (x) =>
              x.kind === "lifecycle" &&
              x.key === "cleanup-complete" &&
              x.status === "committed",
          )
      )
        return {
          summary: { status: "cleaned", runId: input.runId, artifactDir: dir },
          exitCode: 0,
        };
      const owned = recoveryJournal
        .records()
        .filter((x) => ["catalog", "account", "shipping", "registry"].includes(x.kind));
      if (owned.length && owned.every((x) => x.status === "deleted")) {
        const value = await cleanupRun(
          target,
          recoveryJournal,
          createCleanupClients({
            db,
            admin,
            control,
            runId: input.runId,
            journal: recoveryJournal,
          }),
        );
        return {
          summary: { status: value.status, artifactDir: dir },
          exitCode: value.status === "cleaned" ? 0 : 3,
        };
      }
      await control("revoke", { runId: input.runId });
      await writeFile(join(dir, "stop.request"), "stop", { mode: 0o600 });
      if (input.action === "stop")
        return {
          summary: {
            status: "stopped",
            runId: input.runId,
            action: "Run --recover with this same ID after active workers stop",
          },
          exitCode: 3,
        };
      await stopJournalWorkers(await openJournal(plan, dir), dir);
      plan.recoverySeconds = Math.max(60, plan.recoverySeconds ?? 0);
      const journal = await openJournal(plan, dir),
        clients = createCleanupClients({
          db,
          admin,
          control,
          runId: input.runId,
          journal,
        });
      const drain = await drainRun(target, plan, clients, journal);
      const invariant = await collectDurableOutcomes({ db, control }, plan, journal);
      const cleanup = await cleanupRun(target, journal, clients);
      await privateJson(join(dir, "recovery.json"), { drain, invariant, cleanup });
      return {
        summary: { status: cleanup.status, artifactDir: dir },
        exitCode: cleanup.status === "cleaned" ? 0 : 3,
      };
    }
    const result =
      input.profile === "acceptance"
        ? await executeAcceptance(target, {
            capabilities: (await preflight("smoke")).attestation?.capabilities,
            run: async (profile, options) => {
              delete options.profile;
              return run(profile, options);
            },
          })
        : await executeSelectedProfile(input.profile, run);
    return {
      summary: {
        status: result.status,
        runId: result.runId,
        report: result.files?.markdownPath ?? result.artifactDir,
        stages: result.stages?.map((x) => ({
          profile: x.profile,
          status: x.status,
          report: x.files?.markdownPath,
        })),
      },
      exitCode:
        result.cleanup?.status === "incomplete"
          ? 3
          : result.status === "pass"
            ? 0
            : result.status === "fail"
              ? 1
              : 2,
    };
  } finally {
    if (connected) await db.end();
  }
}
