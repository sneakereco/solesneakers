import "server-only";
import type { DatasetScope } from "../CommerceFacts/contract";
import type {
  ReportRequest,
  ReportId,
  ReportDataMap,
  ReportEnvelope,
  OverviewData,
  CustomersData,
  SalesPeriod,
  HealthPeriod,
  TimeBucket,
} from "../ReportContract/types";
import type { HistoryEvidence } from "../EventDelivery/history-source";
import { resolveReportCoverage } from "./report-coverage";
import {
  compileVisitorQueries,
  compileActiveQuery,
  readSessions,
  readBuyers,
  readCohorts,
} from "./queries/visitors";
import {
  compileAcquisitionQueries,
  readSources,
  readAcquisitionPeriod,
  readAcquisitionSeries,
} from "./queries/acquisition";
import { compileProductQueries, readProductRows, readDemand } from "./queries/products";
import { moneyValue } from "../ReportContract/money";
import { calendarBuckets } from "./queries/financial";
import { rate, rows, count } from "./queries/commerce-source";
import { resolveCalendarRange } from "../ReportContract/calendar-range";
import { isTransientReportError, PostHogQueryError } from "./posthog-query";
import {
  compileCommerceHealthQueries,
  mapHealthResult,
  readHealthPeriod,
} from "./queries/commerce-health";
import {
  compileFinancialQueries,
  mapPaymentsResult,
  mapSalesResult,
  readSalesPeriod,
  readSalesReport,
  readSalesBuckets,
  readPaymentsPeriod,
} from "./queries/financial";
import type { CompiledQuery, CsvExecution } from "./query-contract";

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
  /** Server-only cache eligibility for the actual cause of a wholly unavailable selection. */
  onTransientUnavailable?: () => void;
  mode?: CsvExecution;
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
  activatedAt: string,
) {
  const records = rows(raw, ["period", "visitors", "sessions"], 2000);
  const byDate = new Map(records.map((r) => [r.period, r]));
  if (byDate.size !== records.length) throw new RangeError("Duplicate visitor bucket.");
  let i = 0;
  const values = calendarBuckets(request, comparison, (date) => {
    const bucket = series[i++],
      r = byDate.get(date);
    byDate.delete(date);
    return {
      ...bucket,
      visitors:
        Date.parse(bucket.endExclusive) <= Date.parse(activatedAt) ||
        !through ||
        Date.parse(bucket.startInclusive) >= Date.parse(through)
          ? null
          : count(r?.visitors ?? 0),
      sessions:
        Date.parse(bucket.endExclusive) <= Date.parse(activatedAt) ||
        !through ||
        Date.parse(bucket.startInclusive) >= Date.parse(through)
          ? null
          : count(r?.sessions ?? 0),
    };
  });
  if (byDate.size) throw new RangeError("Unexpected visitor bucket.");
  return values;
}

function overviewSummary(
  sales: SalesPeriod | null,
  sessions: ReturnType<typeof readSessions> | null,
) {
  return {
    netMerchandise: sales?.netMerchandise ?? moneyValue(null),
    confirmedOrders: sales?.confirmedOrders ?? null,
    averageOrderValue: sales?.averageOrderValue ?? moneyValue(null),
    buyers: sales?.buyers.known ?? null,
    missingBuyerOrders: sales?.buyers.missingOrders ?? null,
    conversion: sessions?.conversion ?? rate(null, null),
    visitors: sessions?.visitors ?? null,
    sessions: sessions?.sessions ?? null,
  };
}

function hasOperationalEvidence(period: HealthPeriod | null) {
  return Boolean(
    period?.outcomes?.length ||
      period?.fulfillmentPreference ||
      period?.backlog?.length ||
      period?.paymentToFulfillment?.length,
  );
}

export async function getReport<T extends ReportId>(
  request: ReportRequest & { report: T },
  deps: ReportingDependencies,
): Promise<ReportEnvelope<ReportDataMap[T]>> {
  return getReportPeriod(request, deps, false);
}

/** On a transport failure, successful required siblings still provide evidence
 * about whether the whole selection could be served from the transient fallback. */
function validateRequiredSibling(
  endpoint: CompiledQuery["endpoint"],
  key: string,
  raw: unknown,
  request: ReportRequest,
  activatedAt: string,
  through: string | null,
) {
  switch (endpoint) {
    case "sole_analytics_sales":
      return readSalesPeriod(raw);
    case "sole_analytics_sales_series":
      return readSalesBuckets(raw, request, key === "comparisonSeries", activatedAt);
    case "sole_analytics_payments":
      return readPaymentsPeriod(raw, request);
    case "sole_analytics_health":
      return readHealthPeriod(raw, request);
    case "sole_analytics_acquisition":
    case "sole_analytics_discovery":
      return readSources(raw, request, through !== null);
    case "sole_analytics_acquisition_series":
    case "sole_analytics_discovery_series":
      return readAcquisitionSeries(raw, request, activatedAt, through);
    default:
      throw new RangeError("Required reporting result could not be verified.");
  }
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
    warehouseObserved,
    behavior,
    compar,
    comparisonThrough,
    activeWindow,
    setAttribution,
  } = result;
  const unavailableWarehouse = () =>
    fail(
      "unavailable",
      "component-unavailable",
      "No warehouse data is verified for this period.",
    );
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
    if (result.liveOnly) queries.active = compileActiveQuery(request, dataset, now);
    else if (report === "overview" || report === "customers" || report === "health")
      include(compileVisitorQueries(request, dataset, now));
    const ranked = report === "overview" ? { ...request, page: 1, pageSize: 5 } : request;
    if (report === "overview" || report === "acquisition")
      include(
        compileAcquisitionQueries(
          { ...ranked, sort: report === "overview" ? "sessions" : request.sort },
          dataset,
          deps.mode,
        ),
      );
    if (report === "overview" || report === "products")
      include(
        compileProductQueries(
          { ...ranked, sort: report === "overview" ? "netMerchandise" : request.sort },
          dataset,
          deps.mode,
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
      "cohorts",
      "signals",
      "products",
      "customers",
      ...(report === "overview" ? ["purchaseSession"] : []),
    ]);
    const executionFailed = Symbol("executionFailed");
    const transientFailures = new Set<string>();
    const requiredFailures: Array<{ error: unknown }> = [];
    function unavailableSections(keys: string[], message: string) {
      const attempted = keys.filter((key) => Object.hasOwn(queries, key));
      if (
        !comparisonOnly &&
        attempted.length &&
        attempted.every((key) => transientFailures.has(key))
      )
        deps.onTransientUnavailable?.();
      return fail("unavailable", "component-unavailable", message);
    }
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
            if (!optionalSections.has(k)) {
              requiredFailures.push({ error });
              return [k, executionFailed] as const;
            }
            if (isTransientReportError(error)) transientFailures.add(k);
            coverage.push({
              code: "component-unavailable",
              metric: k,
              message: "This report section is temporarily unavailable.",
            });
            return [k, executionFailed] as const;
          }
        }),
      ),
    );
    if (requiredFailures.length) {
      const configuration = requiredFailures.find(
        ({ error }) =>
          error instanceof PostHogQueryError &&
          error.category === "configuration-failure",
      );
      const permanent =
        configuration ??
        requiredFailures.find(({ error }) => !isTransientReportError(error));
      if (permanent) throw permanent.error;
      for (const [key, q] of Object.entries(queries)) {
        if (!optionalSections.has(key) && values[key] !== executionFailed)
          validateRequiredSibling(
            q.endpoint,
            key,
            values[key],
            request,
            dataset.activatedAt,
            base.behaviorThrough,
          );
      }
      throw requiredFailures[0].error;
    }
    const financialResults = { ...values, request, activatedAt: dataset.activatedAt };
    function optional<Value>(key: string, parse: (raw: unknown) => Value): Value | null {
      if (!Object.hasOwn(values, key) || values[key] === executionFailed) return null;
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
    const sessions = optional("sessions", (raw) =>
      readSessions(raw, request, warehouseObserved),
    );
    const comparison = optional("comparisonSessions", (raw) =>
      readSessions(raw, request, warehouseObserved),
    );
    function reportTiming(metric: string, invalidEvents: number | undefined) {
      if (invalidEvents)
        coverage.push({
          code: "incomplete-coverage",
          metric,
          missingCount: invalidEvents,
          message: "Observations with invalid native session timing were excluded.",
        });
    }
    function parseProductTable(raw: unknown, tableRequest: ReportRequest) {
      const p = readProductRows(raw, tableRequest, behavior, warehouseObserved);
      reportTiming("productBehavior", p.invalidEvents);
      for (const [metric, missingCount] of [
        ["productOrders", p.unassignedOrders],
        ["productReturns", p.unassignedReturns],
      ] as const) {
        if (missingCount)
          coverage.push({
            code: "incomplete-coverage",
            metric,
            missingCount,
            message:
              "Purchase or return evidence could not be assigned to an original product line.",
          });
      }
      return p;
    }
    reportTiming("sessions", sessions?.invalidEvents);
    reportTiming("comparison.sessions", comparison?.invalidEvents);
    let data: ReportDataMap[ReportId];
    let empty = false;
    if (report === "payments") {
      const p = mapPaymentsResult(financialResults, warehouseObserved);
      if (!warehouseObserved && !p.methods.totalCount) return unavailableWarehouse();
      if (p.attribution) setAttribution(p.attribution);
      empty = p.paidOrders === 0 && p.methods.totalCount === 0;
      data = p;
    } else if (report === "health") {
      const p = mapHealthResult(financialResults, warehouseObserved);
      if (p.attribution) setAttribution(p.attribution);
      if (sessions) {
        p.funnel = sessions.funnel;
        p.checkoutCompletion = sessions.checkoutCompletion;
      }
      if (p.comparison && comparison) {
        p.comparison.funnel = comparison.funnel;
        p.comparison.checkoutCompletion = comparison.checkoutCompletion;
      }
      if (
        !warehouseObserved &&
        !sessions &&
        !comparison &&
        !hasOperationalEvidence(p) &&
        !hasOperationalEvidence(p.comparison)
      )
        return unavailableWarehouse();
      data = p;
      empty =
        p.attribution?.eligibleOrders === 0 &&
        !p.outcomes?.length &&
        sessions?.sessions === 0;
    } else if (report === "customers") {
      const buyers = optional("customers", (raw) => readBuyers(raw, warehouseObserved));
      const p =
        warehouseObserved || buyers?.buyers || buyers?.missingBuyerOrders ? buyers : null;
      const observedCohorts = optional("cohorts", (raw) => readCohorts(raw, now));
      const cohorts =
        warehouseObserved || observedCohorts?.length ? observedCohorts : null;
      if (p) setAttribution(p.attribution);
      const live = optional("active", (raw) => {
        const [row] = rows(raw, ["visitors", "invalid_events"], 1);
        const invalid = count(row?.invalid_events);
        reportTiming("activeFiveMinuteVisitors", invalid);
        return invalid ? null : count(row?.visitors);
      });
      if (result.liveOnly && live === null)
        return unavailableSections(["active"], "Recent activity could not be verified.");
      if (!p && !sessions && cohorts === null && live === null)
        return unavailableSections(
          ["customers", "sessions", "cohorts", "active"],
          "Customer report sections are unavailable.",
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
        cohorts,
        devices: sessions?.devices ?? null,
      };
      empty = c.buyers === 0 && c.missingBuyerOrders === 0 && c.sessions === 0;
      data = c;
    } else if (report === "acquisition") {
      const { invalidEvents: purchaseInvalid, ...purchaseSession } =
        readAcquisitionPeriod(
          values.purchaseSession,
          values.purchaseSeries,
          request,
          dataset.activatedAt,
          base.behaviorThrough,
          warehouseObserved,
        );
      const { invalidEvents: discoveryInvalid, ...discovery } = readAcquisitionPeriod(
        values.discovery,
        values.discoverySeries,
        request,
        dataset.activatedAt,
        base.behaviorThrough,
        warehouseObserved,
      );
      reportTiming("purchaseSession", purchaseInvalid);
      reportTiming("discovery", discoveryInvalid);
      if (purchaseSession.attribution) setAttribution(purchaseSession.attribution);
      if (
        !warehouseObserved &&
        !behavior &&
        !purchaseSession.sources.totalCount &&
        !discovery.sources.totalCount
      )
        return unavailableWarehouse();
      data = { purchaseSession, discovery, comparison: null };
      empty =
        behavior &&
        !purchaseInvalid &&
        !discoveryInvalid &&
        purchaseSession.sources.totalCount === 0 &&
        discovery.sources.totalCount === 0;
    } else if (report === "products") {
      const productRows = optional("products", (raw) => parseProductTable(raw, request));
      const p =
        warehouseObserved || productRows?.products.totalCount ? productRows : null;
      const demand = optional("signals", (raw) => readDemand(raw, request, behavior));
      const inventory =
        warehouseObserved || demand?.inventory.recordedVariants
          ? (demand?.inventory ?? null)
          : null;
      const unmetDemand =
        behavior || warehouseObserved ? (demand?.unmetDemand ?? null) : null;
      if (!p && !inventory && !unmetDemand)
        return unavailableSections(
          ["products", "signals"],
          "Product report sections are unavailable.",
        );
      if (p?.attribution) setAttribution(p.attribution);
      if (!p) reportTiming("productBehavior", demand?.invalidEvents);
      if (!comparisonOnly && demand?.inventory.availableUnits === null)
        coverage.push({
          code: "component-unavailable",
          metric: "inventory",
          message:
            "Current stock requires recorded inventory observations for matching variants.",
        });
      data = {
        attribution: p?.attribution ?? null,
        products: p?.products ?? null,
        variants: p?.variants ?? null,
        brands: p?.brands ?? null,
        categories: p?.categories ?? null,
        sizes: p?.sizes ?? null,
        inventory,
        unmetDemand,
        comparison: null,
      };
      empty =
        behavior &&
        p?.products.totalCount === 0 &&
        !p.invalidEvents &&
        !p.unassignedOrders &&
        !p.unassignedReturns &&
        demand?.unmetDemand.searches === 0 &&
        demand.unmetDemand.unavailableSizeSelections === 0;
    } else {
      const {
        summary,
        comparison: previous,
        ...series
      } = readSalesReport(financialResults, warehouseObserved);
      const sales = summary.available ? summary.data : null;
      const previousSales = previous?.available ? previous.data : null;
      if (sales && (warehouseObserved || sales.attribution.eligibleOrders))
        setAttribution(sales.attribution);
      empty =
        sales?.confirmedOrders === 0 &&
        sales.totalCollected.cents === 0 &&
        sales.unallocatedRefunds.cents === 0 &&
        sales.fees.cents === 0;
      if (report === "sales") {
        if (!sales) return unavailableWarehouse();
        data = { ...sales, ...series, comparison: previousSales };
      } else {
        if (!sales && !sessions && !previousSales && !comparison)
          return unavailableWarehouse();
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
          summary: overviewSummary(sales, sessions),
          comparison:
            previousSales || comparison
              ? overviewSummary(previousSales, comparison)
              : null,
          funnel,
          series:
            optional("visitorSeries", (raw) =>
              attachTraffic(
                series.series,
                raw,
                request,
                false,
                base.behaviorThrough,
                dataset.activatedAt,
              ),
            ) ?? series.series,
          comparisonSeries: series.comparisonSeries
            ? (optional("comparisonVisitorSeries", (raw) =>
                attachTraffic(
                  series.comparisonSeries!,
                  raw,
                  request,
                  true,
                  comparisonThrough,
                  dataset.activatedAt,
                ),
              ) ?? series.comparisonSeries)
            : null,
          components: Object.fromEntries(
            components.map((k) => [k, sales?.[k] ?? moneyValue(null)]),
          ) as OverviewData["components"],
          leadingSources:
            optional("purchaseSession", (raw) => {
              const source = readSources(raw, ranked, behavior, warehouseObserved);
              reportTiming("purchaseSession", source.invalidEvents);
              return source.sources.rows;
            }) ?? [],
          leadingProducts:
            optional("products", (raw) => parseProductTable(raw, ranked).products.rows) ??
            [],
        };
        if (!warehouseObserved) {
          for (const [metric, visible] of [
            ["purchaseSession", overview.leadingSources.length],
            ["products", overview.leadingProducts.length],
          ] as const)
            if (!visible)
              coverage.push({
                code: "component-unavailable",
                metric,
                message: "Warehouse coverage for this section is unverified.",
              });
        }
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
        !result.liveOnly && freshness.status !== "current"
          ? "stale"
          : empty
            ? "empty"
            : "ready",
    };
  } catch (error) {
    if (!comparisonOnly && isTransientReportError(error)) deps.onTransientUnavailable?.();
    return fail(
      error instanceof PostHogQueryError && error.category === "configuration-failure"
        ? "unconfigured"
        : "unavailable",
      "component-unavailable",
      "The reporting source could not return a verified result.",
    );
  }
}
