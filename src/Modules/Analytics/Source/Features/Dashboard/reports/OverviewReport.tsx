import type {
  OverviewData,
  ReportEnvelope,
  SalesComponents,
} from "../../ReportContract/types";
import { AttributionCoverage, componentUnavailable } from "../DataCoverage";
import { MetricCard } from "../MetricCard";
import { ReportPanel } from "../ReportPanel";
import { RankedBars } from "../charts/ComparisonCharts";
import { FunnelChart } from "../charts/FunnelChart";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import { formatCount, formatMoney, formatPercent, moneyCoverage } from "../format";

const collectedBreakdown: [keyof SalesComponents, string][] = [
  ["grossMerchandise", "Gross product sales"],
  ["discounts", "Discounts"],
  ["merchandiseRefunds", "Product refunds"],
  ["netMerchandise", "Net product sales"],
  ["netShipping", "Net shipping"],
  ["netTax", "Net tax"],
  ["unallocatedRefunds", "Unallocated refunds"],
  ["totalCollected", "Total collected, net"],
];

export function OverviewReport({ report }: { report: ReportEnvelope<OverviewData> }) {
  if (!report.data) return null;
  const {
    summary,
    comparison,
    series,
    comparisonSeries,
    funnel,
    leadingSources,
    leadingProducts,
    components,
  } = report.data;
  const conversion = summary.conversion;

  return (
    <div className="analytics-overview">
      <div className="analytics-metrics">
        <MetricCard
          label="Net product sales"
          value={formatMoney(summary.netMerchandise)}
          emphasis
          comparison={comparison && formatMoney(comparison.netMerchandise)}
          definition="After discounts and product refunds"
          coverage={moneyCoverage(summary.netMerchandise)}
        />
        <MetricCard
          label="Confirmed orders"
          value={formatCount(summary.confirmedOrders)}
          comparison={comparison && formatCount(comparison.confirmedOrders)}
          definition="Confirmed purchases in scope"
        />
        <MetricCard
          label="Average order value"
          value={formatMoney(summary.averageOrderValue)}
          comparison={comparison && formatMoney(comparison.averageOrderValue)}
          definition="Products after discounts, before refunds"
          coverage={moneyCoverage(summary.averageOrderValue)}
        />
        <MetricCard
          label="Store conversion"
          value={formatPercent(conversion.value)}
          comparison={comparison && formatPercent(comparison.conversion.value)}
          definition={
            conversion.value === null
              ? "Purchasing sessions ÷ tracked sessions"
              : `${formatCount(conversion.numerator)} purchasing sessions ÷ ${formatCount(conversion.denominator)} tracked sessions`
          }
        />
      </div>

      <div className="analytics-columns analytics-columns-trend">
        <ReportPanel
          title="Net product sales"
          description="Performance over the selected period"
        >
          <TimeSeriesChart
            buckets={series}
            unit="netMerchandise"
            comparison={comparisonSeries}
          />
        </ReportPanel>
        <ReportPanel
          title="Shopping funnel"
          description="Tracked sessions completing steps in order"
        >
          <FunnelChart steps={funnel} />
        </ReportPanel>
      </div>

      <div className="analytics-columns">
        <ReportPanel
          title="Leading purchase-session sources"
          description="Top five sources in scope"
        >
          {leadingSources.length ? (
            <RankedBars
              label="Purchase-session sources"
              unit="usd"
              valueLabel="Net product sales (USD)"
              rows={leadingSources.map((source) => ({
                key: source.key,
                label: source.label,
                value: source.revenue,
              }))}
            />
          ) : (
            <p className="analytics-muted">
              {componentUnavailable(report.coverage, "purchaseSession")
                ? "Purchase-session sources are unavailable."
                : "No purchase-session sources in the selected period."}
            </p>
          )}
          <div className="analytics-panel-footer">
            <AttributionCoverage attribution={report.scope.attribution} />
          </div>
        </ReportPanel>
        <ReportPanel title="Leading products" description="Top five products in scope">
          {leadingProducts.length ? (
            <div
              className="analytics-table-scroll"
              role="region"
              aria-label="Leading products table"
              tabIndex={0}
            >
              <table className="analytics-table">
                <caption className="sr-only">
                  Leading products in the selected period
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Units</th>
                    <th scope="col">Net product sales (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {leadingProducts.map((product) => (
                    <tr key={product.productId}>
                      <th scope="row">{product.name}</th>
                      <td>{formatCount(product.units)}</td>
                      <td>
                        {formatMoney(product.netMerchandise)}
                        {moneyCoverage(product.netMerchandise) && (
                          <small>{moneyCoverage(product.netMerchandise)}</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="analytics-muted">
              {componentUnavailable(report.coverage, "products")
                ? "Leading products are unavailable."
                : "No products in the selected period."}
            </p>
          )}
        </ReportPanel>
      </div>

      <div className="analytics-columns">
        <ReportPanel title="Collected revenue" description="Recorded amounts in USD">
          <dl className="analytics-breakdown">
            {collectedBreakdown.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {formatMoney(components[key])}
                  {moneyCoverage(components[key]) && (
                    <small>{moneyCoverage(components[key])}</small>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </ReportPanel>
        <ReportPanel
          title="Customer activity"
          description="Visitors and sessions are based on tracked activity"
        >
          <dl className="analytics-breakdown">
            <div>
              <dt>Unique tracked visitors</dt>
              <dd>{formatCount(summary.visitors)}</dd>
            </div>
            <div>
              <dt>Tracked sessions</dt>
              <dd>{formatCount(summary.sessions)}</dd>
            </div>
            <div>
              <dt>Purchasing customers</dt>
              <dd>{formatCount(summary.buyers)}</dd>
            </div>
          </dl>
        </ReportPanel>
      </div>
    </div>
  );
}
