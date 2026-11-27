import type {
  MoneyValue,
  Rate,
  ReportEnvelope,
  SalesData,
  SalesPeriod,
} from "../../ReportContract/types";
import { AttributionCoverage } from "../DataCoverage";
import { MetricCard } from "../MetricCard";
import { ReportPanel } from "../ReportPanel";
import { Histogram, Waterfall } from "../charts/ComparisonCharts";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import {
  formatChartValue,
  formatCount,
  formatMoney,
  formatPercent,
  moneyCoverage,
} from "../format";
import type { DashboardChange } from "../request-state";

const costMeasures = [
  ["revenue", "Product revenue", "usd"],
  ["orders", "Confirmed orders", "count"],
  ["lines", "Original product lines", "count"],
] as const;

function CostCoverageCell({
  rate,
  unit,
}: {
  rate: Rate | undefined;
  unit: "usd" | "count";
}) {
  return (
    <td>
      {formatPercent(rate?.value ?? null)}
      {rate && (
        <small>
          {formatChartValue(rate.numerator, unit)} /{" "}
          {formatChartValue(rate.denominator, unit)}
        </small>
      )}
    </td>
  );
}

function CostCoverage({
  current,
  previous,
}: {
  current: SalesPeriod["costCoverage"];
  previous: SalesPeriod["costCoverage"] | null | undefined;
}) {
  return (
    <div
      className="analytics-table-scroll"
      role="region"
      aria-label="Product cost coverage"
      tabIndex={0}
    >
      <table className="analytics-table">
        <caption className="sr-only">
          Product cost coverage, recorded over eligible amounts
        </caption>
        <thead>
          <tr>
            <th scope="col">Cost coverage</th>
            <th scope="col">Selected period</th>
            {previous !== undefined && <th scope="col">Previous period</th>}
          </tr>
        </thead>
        <tbody>
          {costMeasures.map(([key, label, unit]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <CostCoverageCell rate={current[key]} unit={unit} />
              {previous !== undefined && (
                <CostCoverageCell rate={previous?.[key]} unit={unit} />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detail({
  label,
  value,
  coverage,
  previous,
  previousCoverage,
}: {
  label: string;
  value: string;
  coverage?: string;
  previous?: string;
  previousCoverage?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {coverage && <small>{coverage}</small>}
        {previous !== undefined && (
          <small>
            {["Previous period", previous, previousCoverage].filter(Boolean).join(" · ")}
          </small>
        )}
      </dd>
    </div>
  );
}

function MoneyDetail({
  label,
  value,
  previous,
}: {
  label: string;
  value: MoneyValue;
  previous: MoneyValue | null | undefined;
}) {
  return (
    <Detail
      label={label}
      value={formatMoney(value)}
      coverage={moneyCoverage(value)}
      previous={previous === undefined ? undefined : formatMoney(previous)}
      previousCoverage={moneyCoverage(previous ?? null)}
    />
  );
}

const moneyKpis = [
  ["netMerchandise", "Net product sales", "After discounts and product refunds"],
  ["totalCollected", "Total collected, net", "Recorded captures less completed refunds"],
  [
    "averageOrderValue",
    "Average order value",
    "Products after discounts, before refunds",
  ],
] as const;

function formatComparisonCount(value: number | null | undefined) {
  return value === undefined ? undefined : formatCount(value);
}

export function SalesReport({
  report,
  onRequestChange,
}: {
  report: ReportEnvelope<SalesData>;
  onRequestChange: (change: DashboardChange) => void;
}) {
  if (!report.data) return null;
  const data = report.data;
  const comparison = data.comparisonSeries === null ? undefined : data.comparison;
  const { productId, variantId, brandId, categoryId, sizeId } = report.scope.filters;
  const hasProductScope = Boolean(
    productId || variantId || brandId || categoryId || sizeId,
  );
  const refundTiming =
    report.scope.dateBasis === "order-cohort"
      ? "Orders confirmed in the selected dates include subsequent completed refunds observed so far."
      : "Completed refunds are shown on their completion dates, including refunds for orders confirmed outside the selected dates.";

  return (
    <div className="grid min-w-0 gap-4">
      {hasProductScope && (
        <div className="analytics-alert">
          <p>Sales includes whole orders containing a matching original product line.</p>
          <button
            type="button"
            className="admin-button-secondary"
            onClick={() => onRequestChange({ report: "products" })}
          >
            View matching product lines
          </button>
        </div>
      )}
      <div className="analytics-metrics">
        {moneyKpis.map(([key, label, definition]) => (
          <MetricCard
            key={key}
            label={label}
            value={formatMoney(data[key])}
            comparison={
              comparison === undefined
                ? undefined
                : formatMoney(comparison?.[key] ?? null)
            }
            comparisonCoverage={moneyCoverage(comparison?.[key] ?? null)}
            definition={definition}
            coverage={moneyCoverage(data[key])}
            emphasis={key === "netMerchandise"}
          />
        ))}
        <MetricCard
          label="Confirmed orders"
          value={formatCount(data.confirmedOrders)}
          comparison={formatComparisonCount(comparison && comparison.confirmedOrders)}
        />
      </div>

      <div className="analytics-columns analytics-columns-trend">
        <ReportPanel title="Net product sales over time">
          <TimeSeriesChart
            buckets={data.series}
            unit="netMerchandise"
            comparison={data.comparisonSeries}
          />
          <div className="analytics-panel-footer">
            <AttributionCoverage attribution={report.scope.attribution} />
          </div>
        </ReportPanel>
        <ReportPanel
          title="Order values"
          description="Original product value after discounts, before refunds, shipping, and tax."
        >
          <Histogram bins={data.orderValueBins} />
          <dl className="analytics-breakdown">
            <MoneyDetail
              label="Median order value"
              value={data.medianOrderValue}
              previous={comparison && comparison.medianOrderValue}
            />
            <Detail
              label="Orders with unavailable values"
              value={formatCount(data.missingOrderValues)}
              previous={formatComparisonCount(
                comparison && comparison.missingOrderValues,
              )}
            />
          </dl>
        </ReportPanel>
      </div>

      <div className="analytics-columns">
        <ReportPanel title="Collected revenue and refunds" description={refundTiming}>
          <Waterfall components={data} />
          <dl className="analytics-breakdown">
            <MoneyDetail
              label="Net shipping"
              value={data.netShipping}
              previous={comparison && comparison.netShipping}
            />
            <MoneyDetail
              label="Net tax"
              value={data.netTax}
              previous={comparison && comparison.netTax}
            />
            <Detail
              label="Original units"
              value={formatCount(data.units)}
              previous={formatComparisonCount(comparison && comparison.units)}
            />
            <Detail
              label="Net units after returns"
              value={formatCount(data.netUnits)}
              previous={formatComparisonCount(comparison && comparison.netUnits)}
            />
            <Detail
              label="Refunds or return lines with missing quantities"
              value={formatCount(data.missingReturnQuantities)}
              previous={formatComparisonCount(
                comparison && comparison.missingReturnQuantities,
              )}
            />
          </dl>
        </ReportPanel>
        <ReportPanel
          title="Product costs and profit"
          description="Gross product profit reflects covered lines after product refunds and recorded product costs. Excludes shipping, taxes, payment fees, and operating expenses."
        >
          <dl className="analytics-breakdown">
            <MoneyDetail
              label="Recorded product cost"
              value={data.recordedCogs}
              previous={comparison && comparison.recordedCogs}
            />
            <MoneyDetail
              label="Gross product profit"
              value={data.recordedProfit}
              previous={comparison && comparison.recordedProfit}
            />
          </dl>
          <p className="analytics-muted">
            Coverage shows recorded over eligible amounts. Product revenue uses original
            value after discounts. Orders are covered when their original product lines
            reconcile and have recorded costs.
          </p>
          <CostCoverage
            current={data.costCoverage}
            previous={comparison && comparison.costCoverage}
          />
        </ReportPanel>
      </div>

      <ReportPanel
        title="Shipping contribution and payment fees"
        description="Shipping contribution is net shipping collected less recorded shipping label costs. Recorded credits reduce the related charges."
      >
        <dl className="analytics-breakdown">
          <MoneyDetail
            label="Recorded shipping contribution"
            value={data.shippingContribution}
            previous={comparison && comparison.shippingContribution}
          />
          <MoneyDetail
            label="Recorded payment fees"
            value={data.fees}
            previous={comparison && comparison.fees}
          />
        </dl>
      </ReportPanel>
    </div>
  );
}
