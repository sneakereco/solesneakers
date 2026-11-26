import "server-only";
import type { DatasetScope } from "../CommerceFacts/contract";
import type {
  ReportRequest,
  ReportId,
  ReportDataMap,
  ReportEnvelope,
  OverviewData,
  CustomersData,
  TimeBucket,
} from "../ReportContract/types";
import type { HistoryEvidence } from "../EventDelivery/history-source";
import { resolveReportCoverage } from "./report-coverage";
import {
  compileVisitorQueries,
  readSessions,
  readBuyers,
  readCohorts,
} from "./queries/visitors";
import {
  compileAcquisitionQueries,
  readSources,
  readAcquisitionPeriod,
} from "./queries/acquisition";
import { compileProductQueries, readProductRows, readDemand } from "./queries/products";
import { moneyValue } from "../ReportContract/money";
import { calendarBuckets } from "./queries/financial";
import { rate, rows, count } from "./queries/commerce-source";
import { resolveCalendarRange } from "../ReportContract/calendar-range";
import { PostHogQueryError } from "./posthog-query";
import { compileCommerceHealthQueries, mapHealthResult } from "./queries/commerce-health";
import {
  compileFinancialQueries,
  mapPaymentsResult,
  mapSalesResult,
} from "./queries/financial";
import type { CompiledQuery } from "./query-contract";

export const commerceDateDefinitions = {
  order:
    "Provider capture when available at first authorization, otherwise first authorized server confirmation. The chosen order time is immutable.",
  activity:
    "Original orders at confirmation, completed refunds at refund completion, and actual fee and shipping adjustments at their effective times.",
  orderCohort:
    "Lifetime recorded outcomes of orders originally confirmed in the selected period.",
  paymentAttempt:
    "Resolved payment attempts at resolution time. Pending and unknown attempts at their original start time.",
  fulfillment:
    "Latest known fulfillment state of orders originally confirmed in the selected period. Elapsed time runs from recorded payment to fulfillment.",
  value:
    "Original reconciled merchandise after discounts, before refunds, shipping and tax. Averages and even-population medians round half up to the nearest cent.",
  productFilter:
    "Whole orders containing a matching original purchased line. All selected product and taxonomy values must match the same line.",
  attribution:
    "Device and purchase-session acquisition filters use the latest active confirmed-purchase link. Default money includes unattributed orders.",
  operationalCoverage:
    "An outcome during a source outage can be missing when neither the server nor a later provider confirmation recorded it.",
} as const;

/** Task 8 supplies the shared verified same-session funnel and report envelope.
 * The caller binds executePostHogQuery to its server-side configuration/deadline. */
export async function executeCommerceReport(
  request: ReportRequest,
  scope: DatasetScope,
  execute: (query: CompiledQuery) => Promise<unknown>,
) {
  const compiled =
    request.report === "health"
      ? compileCommerceHealthQueries(request, scope)
      : compileFinancialQueries(request, scope);
  const pairs = await Promise.all(
    Object.entries(compiled.queries).map(
      async ([key, query]) => [key, await execute(query)] as const,
    ),
  );
  const raw = { ...Object.fromEntries(pairs), request, activatedAt: scope.activatedAt };
  if (request.report === "sales") return mapSalesResult(raw);
  if (request.report === "payments") return mapPaymentsResult(raw);
  return mapHealthResult(raw);
}

export type ReportingDependencies = {
  dataset: DatasetScope | null;
  now: Date;
  history: HistoryEvidence;
  execute: (query: CompiledQuery) => Promise<unknown>;
};

const components = [
  "grossMerchandise",
  "discounts",
  "merchandiseRefunds",
  "shippingCollected",
  "shippingRefunds",
  "taxCollected",
  "taxRefunds",
  "unallocatedRefunds",
  "netMerchandise",
  "netShipping",
  "netTax",
  "totalCollected",
] as const;
function attachTraffic(
  series: TimeBucket[],
  raw: unknown,
  request: ReportRequest,
  comparison: boolean,
  through: string | null,
) {
  const records = rows(raw, ["period", "visitors", "sessions"], 2000);
  const byDate = new Map(records.map((r) => [r.period, r]));
  if (byDate.size !== records.length) throw new RangeError("Duplicate visitor bucket.");
  let i = 0;
  return calendarBuckets(request, comparison, (date) => {
    const bucket = series[i++],
      r = byDate.get(date);
    return {
      ...bucket,
      visitors:
        bucket.confirmedOrders === null ||
        !through ||
        Date.parse(bucket.startInclusive) >= Date.parse(through)
          ? null
          : count(r?.visitors ?? 0),
      sessions:
        bucket.confirmedOrders === null ||
        !through ||
        Date.parse(bucket.startInclusive) >= Date.parse(through)
          ? null
          : count(r?.sessions ?? 0),
    };
  });
}
export async function getReport<T extends ReportId>(
  request: ReportRequest & { report: T },
  deps: ReportingDependencies,
): Promise<ReportEnvelope<ReportDataMap[T]>> {
  return getReportPeriod(request, deps, false);
}
async function getReportPeriod<T extends ReportId>(
  request: ReportRequest & { report: T },
  deps: ReportingDependencies,
  comparisonOnly: boolean,
): Promise<ReportEnvelope<ReportDataMap[T]>> {
  const { now, execute } = deps;
  const result = resolveReportCoverage(
    request,
    deps.dataset,
    deps.history,
    now,
    comparisonOnly,
  );
  if (result.kind === "failure") return result.envelope;
  const {
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
  } = result;
  const report: ReportId = request.report;
  try {
    const queries: Record<string, CompiledQuery> = {};
    const include = (compiled: { queries: Record<string, CompiledQuery> }) =>
      Object.assign(queries, compiled.queries);
    if (report === "overview" || report === "sales" || report === "payments")
      include(
        compileFinancialQueries(
          { ...request, report: report === "overview" ? "sales" : report },
          dataset,
        ),
      );
    if (report === "health") include(compileCommerceHealthQueries(request, dataset));
    if (report === "overview" || report === "customers" || report === "health")
      include(compileVisitorQueries(request, dataset, now));
    const ranked = report === "overview" ? { ...request, page: 1, pageSize: 5 } : request;
    if (report === "overview" || report === "acquisition")
      include(
        compileAcquisitionQueries(
          { ...ranked, sort: report === "overview" ? "sessions" : request.sort },
          dataset,
        ),
      );
    if (report === "overview" || report === "products")
      include(
        compileProductQueries(
          { ...ranked, sort: report === "overview" ? "netMerchandise" : request.sort },
          dataset,
        ),
      );
    if (!behavior) {
      delete queries.sessions;
      delete queries.visitorSeries;
    }
    if (!compar) {
      delete queries.comparisonSessions;
      delete queries.comparisonVisitorSeries;
    }
    if (result.liveOnly) {
      delete queries.customers;
      delete queries.cohorts;
    }
    if (!activeWindow) delete queries.active;
    else if (queries.active) {
      queries.active.variables.start_inclusive = activeWindow.start;
      queries.active.variables.end_exclusive = activeWindow.end;
    }
    const optionalSections = new Set([
      "sessions",
      "comparisonSessions",
      "visitorSeries",
      "comparisonVisitorSeries",
      "active",
      ...(report === "overview" ? ["purchaseSession", "products"] : []),
    ]);
    const values: Record<string, unknown> = Object.fromEntries(
      await Promise.all(
        Object.entries(queries).map(async ([k, q]) => {
          if ("inventory_enabled" in q.variables)
            q.variables.inventory_enabled = comparisonOnly ? "no" : "yes";
          if ("behavior_enabled" in q.variables) {
            const through =
              k === "active"
                ? activeWindow?.end
                : k.startsWith("comparison")
                  ? comparisonThrough
                  : base.behaviorThrough;
            q.variables.behavior_enabled = through ? "yes" : "no";
            q.variables.behavior_end = through ?? q.variables.end_exclusive;
          }
          try {
            return [k, await execute(q)] as const;
          } catch (error) {
            if (!optionalSections.has(k)) throw error;
            coverage.push({
              code: "component-unavailable",
              metric: k,
              message: "This report section is temporarily unavailable.",
            });
            return [k, null] as const;
          }
        }),
      ),
    );
    const financialResults = { ...values, request, activatedAt: dataset.activatedAt };
    function optional<Value>(key: string, parse: (raw: unknown) => Value): Value | null {
      if (!values[key]) return null;
      try {
        return parse(values[key]);
      } catch {
        coverage.push({
          code: "component-unavailable",
          metric: key,
          message: "This report section returned an invalid result.",
        });
        return null;
      }
    }
    const sessions = optional("sessions", (raw) => readSessions(raw, request));
    const comparison = optional("comparisonSessions", (raw) =>
      readSessions(raw, request),
    );
    if (sessions?.invalidEvents)
      coverage.push({
        code: "incomplete-coverage",
        metric: "sessions",
        missingCount: sessions.invalidEvents,
        message: "Observations with invalid native session timing were excluded.",
      });
    let data: ReportDataMap[ReportId];
    let empty = false;
    if (report === "payments") {
      const p = mapPaymentsResult(financialResults);
      setAttribution(p.attribution);
      empty = p.paidOrders === 0 && p.methods.totalCount === 0;
      data = p;
    } else if (report === "health") {
      const p = mapHealthResult(financialResults);
      setAttribution(p.attribution);
      if (sessions) p.funnel = sessions.funnel;
      if (p.comparison && comparison) p.comparison.funnel = comparison.funnel;
      data = p;
      empty =
        p.attribution.eligibleOrders === 0 &&
        !p.outcomes.length &&
        sessions?.sessions === 0;
    } else if (report === "customers") {
      const p = result.liveOnly ? null : readBuyers(values.customers);
      if (p) setAttribution(p.attribution);
      const live = optional("active", (raw) =>
        count(rows(raw, ["visitors"], 1)[0]?.visitors),
      );
      if (result.liveOnly && live === null)
        return fail(
          "unavailable",
          "component-unavailable",
          "Recent activity could not be verified.",
        );
      const c: CustomersData = {
        ...(p ?? {
          attribution: null,
          buyers: null,
          newBuyers: null,
          returningBuyers: null,
          missingBuyerOrders: null,
          selectedPeriodSpend: moneyValue(null),
          observedLifetimeSpend: moneyValue(null),
        }),
        comparison: null,
        activeWindow: live !== null ? activeWindow : null,
        visitors: sessions?.visitors ?? null,
        sessions: sessions?.sessions ?? null,
        activeFiveMinuteVisitors: live,
        cohorts: result.liveOnly ? null : readCohorts(values.cohorts, now),
        devices: sessions?.devices ?? null,
      };
      empty = c.buyers === 0 && c.missingBuyerOrders === 0 && c.sessions === 0;
      data = c;
    } else if (report === "acquisition") {
      const purchaseSession = readAcquisitionPeriod(
        values.purchaseSession,
        values.purchaseSeries,
        request,
        dataset.activatedAt,
        base.behaviorThrough,
      );
      const discovery = readAcquisitionPeriod(
        values.discovery,
        values.discoverySeries,
        request,
        dataset.activatedAt,
        base.behaviorThrough,
      );
      setAttribution(purchaseSession.attribution);
      data = { purchaseSession, discovery, comparison: null };
      empty =
        behavior &&
        purchaseSession.sources.totalCount === 0 &&
        discovery.sources.totalCount === 0;
    } else if (report === "products") {
      const p = readProductRows(values.products, request, behavior);
      setAttribution(p.attribution);
      const demand = readDemand(values.signals, request, behavior);
      if (!comparisonOnly && demand.inventory.availableUnits === null)
        coverage.push({
          code: "component-unavailable",
          metric: "inventory",
          message:
            "Current stock requires recorded inventory observations for matching variants.",
        });
      data = { ...p, ...demand, comparison: null };
      empty =
        behavior &&
        p.products.totalCount === 0 &&
        demand.unmetDemand.searches === 0 &&
        demand.unmetDemand.unavailableSizeSelections === 0;
    } else {
      const sales = mapSalesResult(financialResults);
      setAttribution(sales.attribution);
      empty =
        sales.confirmedOrders === 0 &&
        sales.totalCollected.cents === 0 &&
        sales.unallocatedRefunds.cents === 0 &&
        sales.fees.cents === 0;
      if (report === "sales") data = sales;
      else {
        const funnel =
          sessions?.funnel ??
          (
            ["session", "product-view", "cart-addition", "checkout", "purchase"] as const
          ).map((step) => ({
            step,
            sessions: null,
            fromStart: rate(null, null),
            fromPrevious: rate(null, null),
          }));
        const overview: OverviewData = {
          summary: {
            netMerchandise: sales.netMerchandise,
            confirmedOrders: sales.confirmedOrders,
            averageOrderValue: sales.averageOrderValue,
            buyers: sales.buyers.known,
            conversion: sessions?.conversion ?? rate(null, null),
            visitors: sessions?.visitors ?? null,
            sessions: sessions?.sessions ?? null,
          },
          comparison: sales.comparison
            ? {
                netMerchandise: sales.comparison.netMerchandise,
                confirmedOrders: sales.comparison.confirmedOrders,
                averageOrderValue: sales.comparison.averageOrderValue,
                buyers: sales.comparison.buyers.known,
                conversion: comparison?.conversion ?? rate(null, null),
                visitors: comparison?.visitors ?? null,
                sessions: comparison?.sessions ?? null,
              }
            : null,
          funnel,
          series:
            optional("visitorSeries", (raw) =>
              attachTraffic(sales.series, raw, request, false, base.behaviorThrough),
            ) ?? sales.series,
          comparisonSeries: sales.comparisonSeries
            ? (optional("comparisonVisitorSeries", (raw) =>
                attachTraffic(
                  sales.comparisonSeries!,
                  raw,
                  request,
                  true,
                  comparisonThrough,
                ),
              ) ?? sales.comparisonSeries)
            : null,
          components: Object.fromEntries(
            components.map((k) => [k, sales[k]]),
          ) as OverviewData["components"],
          leadingSources:
            optional(
              "purchaseSession",
              (raw) => readSources(raw, ranked, behavior).sources.rows,
            ) ?? [],
          leadingProducts:
            optional(
              "products",
              (raw) => readProductRows(raw, ranked, behavior).products.rows,
            ) ?? [],
        };
        data = overview;
        empty = empty && sessions?.sessions === 0;
      }
    }
    if (
      request.compare &&
      ("cohorts" in data || "unmetDemand" in data || "purchaseSession" in data) &&
      Date.parse(request.range.comparisonEndExclusive) > Date.parse(dataset.activatedAt)
    ) {
      const eastern = new Intl.DateTimeFormat("en-CA", {
        timeZone: request.range.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const range = resolveCalendarRange(
        {
          from: eastern.format(new Date(request.range.comparisonStartInclusive)),
          to: eastern.format(
            new Date(Date.parse(request.range.comparisonEndExclusive) - 1),
          ),
          timezone: request.range.timezone,
        },
        now,
      );
      const prior = await getReportPeriod<ReportId>(
        { ...request, range, compare: false },
        deps,
        true,
      );
      for (const issue of prior.coverage)
        if (issue.code !== "unverified-ingestion" && issue.code !== "inapplicable-filter")
          coverage.push({ ...issue, metric: "comparison." + (issue.metric ?? "report") });
      const previous = prior.data;
      if (previous && "cohorts" in previous && "cohorts" in data) {
        const {
          activeFiveMinuteVisitors,
          activeWindow: priorWindow,
          comparison: nestedComparison,
          ...period
        } = previous;
        void activeFiveMinuteVisitors;
        void priorWindow;
        void nestedComparison;
        data.comparison = period;
      } else if (previous && "unmetDemand" in previous && "unmetDemand" in data) {
        const { inventory, comparison: nestedComparison, ...period } = previous;
        void inventory;
        void nestedComparison;
        data.comparison = period;
      } else if (previous && "purchaseSession" in previous && "purchaseSession" in data) {
        data.comparison = {
          purchaseSession: previous.purchaseSession,
          discovery: previous.discovery,
        };
      }
    }
    return {
      ...base,
      data: data as ReportDataMap[T],
      state:
        !result.liveOnly && freshness.status === "lagging"
          ? "stale"
          : empty
            ? "empty"
            : "ready",
    };
  } catch (error) {
    return fail(
      error instanceof PostHogQueryError && error.category === "configuration-failure"
        ? "unconfigured"
        : "unavailable",
      "component-unavailable",
      "The reporting source could not return a verified result.",
    );
  }
}
