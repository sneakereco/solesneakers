import "server-only";
import type { DatasetScope } from "../CommerceFacts/contract";
import type {
  ReportRequest,
  ReportId,
  ReportFilters,
  ReportScope,
  CoverageIssue,
} from "../ReportContract/types";
import { behaviorReportAvailability } from "../EventDelivery/behavior-archive";
import {
  analyticsInstantMicros as micros,
  formatAnalyticsMicros as stamp,
} from "../EventDelivery/instant";
import {
  warehouseFreshness,
  type HistoryEvidence,
} from "../EventDelivery/history-source";

const filterKeys = [
  "device",
  "source",
  "channel",
  "campaign",
  "paymentMethod",
  "fulfillment",
  "customer",
  "status",
  "productId",
  "variantId",
  "brandId",
  "categoryId",
  "sizeId",
] as const;

export function resolveReportCoverage(
  request: ReportRequest,
  dataset: DatasetScope | null,
  history: HistoryEvidence,
  now: Date,
  comparisonOnly: boolean,
) {
  const coverage: CoverageIssue[] = [];
  const filters: ReportFilters = Object.fromEntries(
    filterKeys.filter((k) => request[k] !== undefined).map((k) => [k, request[k]]),
  );
  const attribution: ReportScope["attribution"] = {
    orderScope:
      request.device || request.source || request.channel || request.campaign
        ? "filtered-orders"
        : "all-orders",
    eligibleOrders: null,
    attributedOrders: null,
    unattributedOrders: null,
  };
  const freshness = warehouseFreshness(history.observation, now);
  const base = {
    behaviorThrough: null as string | null,
    range: request.range,
    asOf: now.toISOString(),
    ingestionAsOf: freshness.sourceFreshThrough,
    datasetStartedAt: dataset?.activatedAt ?? null,
    coverage,
    scope: {
      filters,
      attribution,
      dateBasis: request.dateBasis,
      dataset: dataset
        ? {
            datasetId: dataset.datasetId,
            environment: dataset.environment,
            storefront: "sole" as const,
            currency: "USD" as const,
          }
        : null,
    },
  };
  const fail = (
    state: "unavailable" | "unconfigured",
    code: CoverageIssue["code"],
    message: string,
  ) => {
    coverage.push({ code, message });
    return { ...base, state, data: null };
  };
  if (!dataset)
    return {
      kind: "failure" as const,
      envelope: fail(
        "unconfigured",
        "component-unavailable",
        "An activated analytics dataset is unavailable.",
      ),
    };
  const liveOnly = micros(request.range.endExclusive) <= micros(dataset.activatedAt);
  if (liveOnly && (request.report !== "customers" || comparisonOnly))
    return {
      kind: "failure" as const,
      envelope: fail(
        "unavailable",
        "before-dataset-start",
        "This period ends before analytics activation.",
      ),
    };
  if (dataset.financialSource !== "warehouse")
    return {
      kind: "failure" as const,
      envelope: fail(
        "unavailable",
        "component-unavailable",
        "Verified warehouse commerce data is unavailable.",
      ),
    };
  if (
    !liveOnly &&
    Date.parse(request.range.startInclusive) < Date.parse(dataset.activatedAt)
  )
    coverage.push({
      code: "before-dataset-start",
      message: "The selected period starts before analytics activation.",
    });
  if (
    request.compare &&
    Date.parse(request.range.comparisonStartInclusive) < Date.parse(dataset.activatedAt)
  )
    coverage.push({
      code: "before-dataset-start",
      metric: "comparison",
      message: "Comparison coverage begins at activation.",
    });
  if (freshness.status !== "current")
    coverage.push({
      code: "unverified-ingestion",
      message:
        freshness.status === "lagging"
          ? "Observed warehouse ingestion is behind the five-minute target."
          : "Warehouse ingestion freshness has not been verified.",
    });
  const nowMicros = micros(now.toISOString());
  const behaviorEnd = (from: string, to: string, metric: string, allowPrefix = false) => {
    const lo = micros(from) > micros(dataset.activatedAt) ? from : dataset.activatedAt;
    const hi = micros(to) < nowMicros ? to : now.toISOString();
    if (micros(hi) <= micros(lo)) return null;
    const result = behaviorReportAvailability(dataset, { start: lo, end: hi }, history);
    if (result.available) return hi;
    const [gap] = result.gaps;
    if (
      allowPrefix &&
      micros(hi) === nowMicros &&
      result.gaps.length === 1 &&
      micros(gap.start) > micros(lo) &&
      micros(gap.end) === micros(hi)
    ) {
      coverage.push({
        code: "incomplete-coverage",
        metric,
        message: "Consented activity is verified through " + gap.start + ".",
      });
      return gap.start;
    }
    coverage.push({
      code: "incomplete-coverage",
      metric,
      message: "Verified consented visitor history does not cover this interval.",
    });
    return null;
  };
  let comparisonThrough: string | null = null,
    activeWindow: { start: string; end: string } | null = null;
  const report: ReportId = request.report;
  const behavioral = report !== "sales" && report !== "payments";
  base.behaviorThrough = behavioral
    ? behaviorEnd(
        request.range.startInclusive,
        request.range.endExclusive,
        "behavior",
        request.range.partial,
      )
    : null;
  const behavior = base.behaviorThrough !== null;
  if (request.compare && (report === "overview" || report === "health"))
    comparisonThrough = behaviorEnd(
      request.range.comparisonStartInclusive,
      request.range.comparisonEndExclusive,
      "comparison",
    );
  const compar = comparisonThrough !== null;
  if (report === "customers" && !comparisonOnly) {
    const latest = history.native.reduce((end, interval) => {
      const stop = micros(interval.end) < nowMicros ? micros(interval.end) : nowMicros;
      return micros(interval.start) < stop && stop > end ? stop : end;
    }, 0n);
    const windowStart = latest - 300000000n;
    if (
      latest &&
      nowMicros - latest <= 300000000n &&
      windowStart >= micros(dataset.activatedAt) &&
      behaviorReportAvailability(
        { ...dataset, behaviorArchiveCutoff: null },
        { start: stamp(windowStart), end: stamp(latest) },
        { ...history, archive: [] },
      ).available
    ) {
      activeWindow = { start: stamp(windowStart), end: stamp(latest) };
    } else
      coverage.push({
        code: "incomplete-coverage",
        metric: "activeFiveMinuteVisitors",
        message:
          "A complete recent five-minute native observation window is unavailable.",
      });
  }
  if (liveOnly) {
    if (!activeWindow)
      return {
        kind: "failure" as const,
        envelope: fail(
          "unavailable",
          "before-dataset-start",
          "This period ends before analytics activation and recent activity is unavailable.",
        ),
      };
    coverage.push({
      code: "before-dataset-start",
      metric: "period",
      message:
        "The selected period predates activation. Only the independently verified recent activity window is available.",
    });
  }
  if (behavioral)
    for (const key of ["paymentMethod", "fulfillment", "customer", "status"] as const)
      if (request[key])
        coverage.push({
          code: "inapplicable-filter",
          filter: key,
          metric: "traffic",
          message:
            "This business filter applies to confirmed commerce outcomes. Visitor and session activity retain their behavioral scope.",
        });
  if (behavioral)
    for (const key of [
      "productId",
      "variantId",
      "brandId",
      "categoryId",
      "sizeId",
    ] as const)
      if (request[key])
        coverage.push({
          code: "inapplicable-filter",
          filter: key,
          metric: "traffic",
          message:
            "Traffic denominators are measured independently of purchased line filters. Product behavior requires a matching observed reference.",
        });
  if (report === "products" && !comparisonOnly)
    for (const key of [
      "device",
      "source",
      "channel",
      "campaign",
      "paymentMethod",
      "fulfillment",
      "customer",
      "status",
    ] as const)
      if (request[key])
        coverage.push({
          code: "inapplicable-filter",
          filter: key,
          metric: "inventory",
          message:
            "Current stock covers recorded variants independently of shopper and order filters.",
        });
  const setAttribution = (a: { eligibleOrders: number; attributedOrders: number }) => {
    Object.assign(attribution, a, {
      unattributedOrders: a.eligibleOrders - a.attributedOrders,
    });
  };

  return {
    kind: "ready" as const,
    liveOnly,
    dataset,
    base,
    coverage,
    fail,
    freshness,
    behavior,
    compar,
    comparisonThrough,
    activeWindow,
    setAttribution,
  };
}
