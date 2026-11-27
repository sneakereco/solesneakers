import type {
  MoneyValue,
  PaymentMethod,
  PaymentRow,
  PaymentsData,
  PaymentsPeriod,
  Rate,
  ReportEnvelope,
  ReportRequest,
} from "../../ReportContract/types";
import { RankedBars } from "../charts/ComparisonCharts";
import { AttributionCoverage, PreviousAttributionCoverage } from "../DataCoverage";
import {
  formatCount,
  formatMoney,
  formatPercent,
  moneyCoverage,
  rateFromCounts,
} from "../format";
import { MetricCard } from "../MetricCard";
import { ReportPanel } from "../ReportPanel";
import { ReportPager, ReportSort } from "../ReportRankingControls";
import { ReportTable } from "../ReportTable";
import { filterLabel, type DashboardChange } from "../request-state";

const totals = [
  [
    "paidOrders",
    "Paid orders with a positive balance",
    "Order population for method popularity.",
  ],
  [
    "resolvedAttempts",
    "Resolved payment attempts",
    "Includes successful and unsuccessful terminal outcomes.",
  ],
  [
    "pendingAttempts",
    "Pending or unresolved attempts",
    "Includes unknown outcomes awaiting confirmation.",
  ],
] as const;

const sortChoices = {
  paidOrders: "Paid orders",
  revenue: "Net product sales",
  successRate: "Attempt success rate",
  fees: "Recorded processing fees",
};

function methodLabel(method: PaymentMethod) {
  return method === "unknown" ? "Unknown method" : filterLabel(method);
}

function rateLabel({ value, numerator, denominator }: Rate) {
  const share = formatPercent(value);
  return numerator !== null && denominator !== null
    ? `${share} (${formatCount(numerator)} / ${formatCount(denominator)})`
    : share;
}

function paymentRateRows(rows: PaymentRow[], key: "paidOrderShare" | "successRate") {
  return rows.map(({ method, [key]: share }) => ({
    key: method,
    label: methodLabel(method),
    value: share.value,
    formattedValue: rateLabel(share),
  }));
}

function MoneyCell({ value }: { value: MoneyValue }) {
  const coverage = moneyCoverage(value);
  return (
    <td>
      {formatMoney(value)}
      {coverage && <small>{coverage}</small>}
    </td>
  );
}

function PaymentTable({
  label,
  period,
  kind,
}: {
  label: string;
  period: PaymentsPeriod;
  kind: "attempts" | "amounts";
}) {
  if (!period.methods.rows.length)
    return (
      <p className="analytics-muted">
        {period.methods.totalCount === 0
          ? "No payment method groups for this period."
          : "No payment method groups on this page."}
      </p>
    );

  if (kind === "amounts")
    return (
      <ReportTable
        label={label}
        columns={[
          "Method",
          "Net product sales",
          "Average order value",
          "Processing fees",
        ]}
      >
        {period.methods.rows.map((row) => (
          <tr key={row.method}>
            <th scope="row">{methodLabel(row.method)}</th>
            <MoneyCell value={row.revenue} />
            <MoneyCell value={row.averageOrderValue} />
            <MoneyCell value={row.fees} />
          </tr>
        ))}
      </ReportTable>
    );

  return (
    <ReportTable
      label={label}
      columns={[
        "Method",
        "Paid-order share",
        "Successful",
        "Unsuccessful",
        "Pending or unresolved",
      ]}
    >
      {period.methods.rows.map((row) => {
        const { resolvedAttempts, pendingAttempts } = row;
        const observed =
          resolvedAttempts === null || pendingAttempts === null
            ? null
            : resolvedAttempts + pendingAttempts;
        return (
          <tr key={row.method}>
            <th scope="row">{methodLabel(row.method)}</th>
            <td>{rateLabel(row.paidOrderShare)}</td>
            <td>{rateLabel(row.successRate)}</td>
            <td>{rateLabel(rateFromCounts(row.failedAttempts, resolvedAttempts))}</td>
            <td>{rateLabel(rateFromCounts(pendingAttempts, observed))}</td>
          </tr>
        );
      })}
    </ReportTable>
  );
}

export function PaymentsReport({
  report,
  request,
  onRequestChange,
}: {
  report: ReportEnvelope<PaymentsData>;
  request: ReportRequest;
  onRequestChange: (change: DashboardChange) => void;
}) {
  const { data, scope } = report;
  if (!data) return null;

  const { comparison, methods } = data;
  const visiblePopularity = [...methods.rows].sort(
    (a, b) =>
      (b.paidOrders ?? -1) - (a.paidOrders ?? -1) || a.method.localeCompare(b.method),
  );

  return (
    <>
      <div className="analytics-metrics analytics-metrics-payments">
        {totals.map(([key, label, definition]) => (
          <MetricCard
            key={key}
            label={label}
            value={formatCount(data[key])}
            comparison={request.compare ? formatCount(comparison?.[key] ?? null) : null}
            definition={definition}
            emphasis={key === "paidOrders"}
          />
        ))}
      </div>
      <ReportPanel
        title="Paid-order popularity"
        description="Methods on this page ranked by their share of all positive-balance paid orders in scope. Zero-balance completions are excluded from the method breakdown."
      >
        <ReportSort
          request={request}
          onRequestChange={onRequestChange}
          choices={sortChoices}
        />
        <p className="analytics-muted">
          {formatCount(methods.totalCount)} method groups in scope
          {comparison &&
            ` · Previous period: ${formatCount(comparison.methods.totalCount)}`}
        </p>
        <AttributionCoverage attribution={scope.attribution} />
        {request.compare && (
          <PreviousAttributionCoverage
            attribution={comparison?.attribution ?? null}
            orderScope={scope.attribution.orderScope}
          />
        )}
        {visiblePopularity.length > 0 && (
          <RankedBars
            label="Paid-order popularity on this page"
            unit="percent"
            valueLabel="Share of positive-balance paid orders"
            rows={paymentRateRows(visiblePopularity, "paidOrderShare")}
          />
        )}
      </ReportPanel>
      <ReportPanel
        title="Payment attempts"
        description="Server-recorded payment-stage attempts. Successful and unsuccessful rates use resolved attempts for each method. The pending or unresolved rate uses all recorded attempts for that method."
      >
        <p className="analytics-muted">
          {scope.dateBasis === "activity"
            ? "Resolved attempts use the resolution date. Pending or unresolved attempts use the start date."
            : "Attempts are grouped by the original confirmation date of their linked order."}
        </p>
        {methods.rows.length > 0 && (
          <div className="grid min-w-0 grid-cols-1 gap-2">
            <h3 className="text-sm font-semibold">Success rate by method</h3>
            <RankedBars
              label="Attempt success rates on this page"
              unit="percent"
              valueLabel="Share of resolved attempts"
              rows={paymentRateRows(methods.rows, "successRate")}
            />
          </div>
        )}
        <PaymentTable label="Payment attempts" period={data} kind="attempts" />
        {comparison && (
          <details className="analytics-chart-data">
            <summary>Previous period payment attempts</summary>
            <PaymentTable
              label="Previous period payment attempts"
              period={comparison}
              kind="attempts"
            />
          </details>
        )}
        {request.compare && !comparison && (
          <p className="analytics-muted">Previous period payment data is unavailable.</p>
        )}
      </ReportPanel>
      <ReportPanel
        title="Payment amounts"
        description="Net product sales include recorded product refunds. Average order value uses original product sales after discounts and before refunds. Both exclude shipping and tax. Processing fees reflect recorded charges and credits."
      >
        <PaymentTable label="Payment amounts" period={data} kind="amounts" />
        {comparison && (
          <details className="analytics-chart-data">
            <summary>Previous period payment amounts</summary>
            <PaymentTable
              label="Previous period payment amounts"
              period={comparison}
              kind="amounts"
            />
          </details>
        )}
      </ReportPanel>
      <ReportPager
        request={request}
        onRequestChange={onRequestChange}
        label="Payment method pages"
        resultCount={Math.max(methods.totalCount, comparison?.methods.totalCount ?? 0)}
      />
    </>
  );
}
