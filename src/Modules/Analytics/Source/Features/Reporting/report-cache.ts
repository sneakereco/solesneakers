import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { DatasetScope } from "../CommerceFacts/contract";
import {
  warehouseFreshness,
  type HistoryEvidence,
} from "../EventDelivery/history-source";
import type {
  ReportRequest,
  ReportDataMap,
  ReportEnvelope,
  ReportId,
  CustomerPeriod,
} from "../ReportContract/types";
import type { getReport } from "./report-service";
import { resolveReportCoverage } from "./report-coverage";
import {
  CSV_EXECUTION,
  ExportScopeError,
  type CompiledQuery,
  type CsvExecution,
} from "./query-contract";
import { checkRankedExport } from "./csv-export";
import { isTransientReportError, PostHogQueryError } from "./posthog-query";
import { reserveReportProject, type ReportStore } from "./report-store";

type Envelope = ReportEnvelope<ReportDataMap[ReportId]>;
export interface ReportLoaderDependencies {
  dataset: DatasetScope | null;
  history: HistoryEvidence;
  project: string;
  clock: () => Date;
  service: typeof getReport;
  store: ReportStore | null;
  execute: (query: CompiledQuery, timeoutMs: number) => Promise<unknown>;
  mode?: CsvExecution;
  deadline?: number;
}

function digest(value: unknown) {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function reportCacheKey(request: ReportRequest, dataset: DatasetScope) {
  return digest({ request, dataset });
}
const flights = new Map<string, Promise<Envelope>>();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const temporary = () =>
  new PostHogQueryError({ status: "retryable", reason: "provider-unavailable" });
const deadlineError = () =>
  new PostHogQueryError({ status: "retryable", reason: "timeout" });

function refreshLive(report: Envelope, now: number): Envelope {
  if (
    report.data &&
    "activeWindow" in report.data &&
    report.data.activeWindow &&
    now - Date.parse(report.data.activeWindow.end) > 300000
  ) {
    const coverage: Envelope["coverage"] = [
      ...report.coverage,
      {
        code: "incomplete-coverage",
        metric: "activeFiveMinuteVisitors",
        message: "The last observed five-minute window is no longer recent.",
      },
    ];
    // A non-null section includes a verified zero or a genuinely empty table.
    const hasPeriodReading = (period: CustomerPeriod | null) =>
      period !== null &&
      (period.attribution !== null || period.devices !== null || period.cohorts !== null);
    if (!hasPeriodReading(report.data) && !hasPeriodReading(report.data.comparison)) {
      return { ...report, state: "unavailable", data: null, coverage };
    }
    return {
      ...report,
      data: { ...report.data, activeWindow: null, activeFiveMinuteVisitors: null },
      coverage,
    };
  }
  return report;
}
function freshSeconds(r: ReportRequest, now: number) {
  return r.dateBasis === "order-cohort" ||
    ["customers", "products", "health", "overview", "payments"].includes(r.report) ||
    now - Date.parse(r.range.endExclusive) < 86400000
    ? 60
    : 300;
}
function decode(value: string | null, key: string, now: number): Envelope | null {
  if (!value || Buffer.byteLength(value) > 1024 * 1024) return null;
  try {
    const record = JSON.parse(value);
    if (
      record.key !== key ||
      !record.report?.data ||
      !["ready", "stale", "empty"].includes(record.report.state)
    )
      return null;
    const age = now - Date.parse(record.report.asOf);
    return age >= 0 && age < 900000 ? refreshLive(record.report, now) : null;
  } catch {
    return null;
  }
}
function stale(report: Envelope): Envelope {
  if (report.data === null) return report;
  return {
    ...report,
    state: "stale",
    data: report.data,
    coverage: [
      ...report.coverage,
      {
        code: "component-unavailable",
        message:
          "Reporting is temporarily unavailable. Showing the last verified result at its original as-of time.",
      },
    ],
  };
}

/** Two local lanes avoid polling Redis against our own fan-out. The atomic store
 * independently admits each call across all workers and both representations. */
function execution(
  deps: Pick<ReportLoaderDependencies, "store" | "execute" | "mode">,
  project: string,
  deadline: number,
) {
  const store = deps.store!;
  const localProject = reserveReportProject(project, store, deadline);
  const lanes = [Promise.resolve(), Promise.resolve()];
  let calls = 0,
    stopped = false,
    transient = false,
    permanent = false,
    exportError = false;
  const execute = (q: CompiledQuery) => {
    const index = calls++ % 2;
    if (calls > 10) return Promise.reject(temporary());
    const task = lanes[index].then(async () => {
      if (stopped || !localProject) throw temporary();
      const id = randomUUID();
      let acquired = false;
      try {
        for (let attempt = 0; attempt < 8; attempt++) {
          if (stopped || performance.now() >= deadline) throw deadlineError();
          if (await localProject.blocked()) throw temporary();
          const admission = await store.admit(project, id);
          if (admission === "ok") {
            acquired = true;
            break;
          }
          if (admission !== "busy") throw temporary();
          await sleep(150);
        }
        if (!acquired) throw temporary();
        if (localProject.isBlocked()) throw temporary();
        const remaining = Math.floor(deadline - performance.now());
        if (stopped || remaining < 1) throw deadlineError();
        const raw = await deps.execute(q, Math.min(8000, remaining));
        if (deps.mode === CSV_EXECUTION) checkRankedExport(q, raw);
        return raw;
      } catch (error) {
        if (error instanceof ExportScopeError) {
          exportError = true;
          stopped = true;
        } else if (isTransientReportError(error)) {
          transient = true;
          if (error.reason === "rate-limited") {
            stopped = true;
            // Only the coordinated transition may release this permit, even if
            // the response to that Redis write is lost.
            acquired = false;
            await localProject.rateLimited(
              id,
              Math.min(3600000, Math.max(1000, error.retryAfterMs ?? 60000)),
            );
          }
        } else permanent = true;
        throw error;
      } finally {
        if (acquired) await store.release(project, id).catch(() => {});
      }
    });
    lanes[index] = task.then(
      () => {},
      () => {},
    );
    return task;
  };
  return {
    execute,
    close: async () => {
      stopped = true;
      await Promise.all(lanes);
      localProject?.close();
    },
    transientOnly: () => transient && !permanent,
    exportFailed: () => exportError,
  };
}

export function createObservationQueryBudget(
  deps: Pick<ReportLoaderDependencies, "project" | "store" | "execute">,
  deadline: number,
) {
  if (!deps.store) throw new Error("Shared report budget unavailable");
  return execution(deps, providerBudgetKey(deps.project), deadline);
}
function providerBudgetKey(project: string) {
  return "sole:analytics:v1:{" + digest(project) + "}";
}
export async function loadAnalyticsReport(
  request: ReportRequest,
  deps: ReportLoaderDependencies,
): Promise<Envelope> {
  const now = deps.clock(),
    deadline = deps.deadline ?? performance.now() + 20000;
  const resolved = resolveReportCoverage(request, deps.dataset, deps.history, now, false);
  if (resolved.kind === "failure") return resolved.envelope;
  const failed = (): Envelope => ({
    ...resolved.base,
    state: "unavailable",
    data: null,
    coverage: [
      ...resolved.coverage,
      {
        code: "component-unavailable",
        message: "The reporting source is temporarily unavailable.",
      },
    ],
  });
  const store = deps.store;
  if (!store || performance.now() >= deadline) return failed();
  const project = providerBudgetKey(deps.project);
  const key =
    "sole:report:v2:{" +
    digest([
      project,
      reportCacheKey(request, resolved.dataset),
      deps.mode === CSV_EXECUTION ? "csv" : "json",
      deps.history,
      warehouseFreshness(deps.history.observation, now).status,
    ]) +
    "}";
  const isFresh = (r: Envelope) =>
    deps.clock().getTime() - Date.parse(r.asOf) <
    freshSeconds(request, now.getTime()) * 1000;
  const cached = async () => decode(await store.read(key), key, deps.clock().getTime());
  const run = async () => {
    let prior = await cached();
    if (prior && isFresh(prior)) return prior;
    const owner = randomUUID();
    if (!(await store.lock(key, owner))) {
      for (let i = 0; i < 5 && performance.now() + 250 < deadline; i++) {
        await sleep(250);
        prior = await cached();
        if (prior && isFresh(prior)) return prior;
      }
      return prior ? stale(prior) : failed();
    }
    let value: string | null = null;
    try {
      prior = await cached();
      if (prior && isFresh(prior)) return prior;
      const worker = execution(deps, project, deadline);
      let transientUnavailable = false;
      let report: Envelope;
      try {
        report = await deps.service(request, {
          dataset: deps.dataset,
          history: deps.history,
          now,
          execute: worker.execute,
          mode: deps.mode,
          onTransientUnavailable: () => {
            transientUnavailable = true;
          },
        });
      } finally {
        await worker.close();
      }
      if (worker.exportFailed()) throw new ExportScopeError();
      report = refreshLive(report, deps.clock().getTime());
      if (report.data) {
        if (!worker.transientOnly()) {
          const candidate = JSON.stringify({ key, report });
          if (Buffer.byteLength(candidate) <= 1024 * 1024) value = candidate;
        }
        return report;
      }
      prior =
        prior &&
        decode(JSON.stringify({ key, report: prior }), key, deps.clock().getTime());
      return prior && report.state === "unavailable" && transientUnavailable
        ? stale(prior)
        : report;
    } finally {
      await store.finish(key, owner, value).catch(() => {});
    }
  };
  let work = flights.get(key);
  if (!work) {
    if (flights.size >= 32) return failed();
    work = run().finally(() => flights.delete(key));
    flights.set(key, work);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      work,
      new Promise<Envelope>((resolve) => {
        timer = setTimeout(
          () => resolve(failed()),
          Math.max(0, deadline - performance.now()),
        );
      }),
    ]);
    return refreshLive(result, deps.clock().getTime());
  } catch (error) {
    if (error instanceof ExportScopeError) throw error;
    return failed();
  } finally {
    clearTimeout(timer);
  }
}
