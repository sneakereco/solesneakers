import type {
  CustomerPeriod,
  CustomersData,
  ReportEnvelope,
  ReportRequest,
} from "../../ReportContract/types";
import { CohortHeatmap } from "../charts/CohortHeatmap";
import { RankedBars, StackedShares } from "../charts/ComparisonCharts";
import { AttributionCoverage, PreviousAttributionCoverage } from "../DataCoverage";
import {
  formatCount,
  formatMoney,
  formatPercent,
  formatStoreTime,
  moneyCoverage,
  UNAVAILABLE,
} from "../format";
import { MetricCard } from "../MetricCard";
import { ReportPanel } from "../ReportPanel";
import { ReportTable } from "../ReportTable";
import { ReportPager } from "../ReportRankingControls";
import { filterLabel, type DashboardChange } from "../request-state";

const counts = [
  [
    "buyers",
    "Recorded buyers",
    "Distinct recorded buyer keys on confirmed orders in the selected period.",
  ],
  [
    "newBuyers",
    "New buyers",
    "Buyers whose first recorded confirmed purchase was in this period.",
  ],
  [
    "returningBuyers",
    "Returning buyers",
    "Buyers whose first recorded confirmed purchase was before this period.",
  ],
  [
    "missingBuyerOrders",
    "Orders without a recorded buyer",
    "Confirmed orders without a verified buyer key.",
  ],
  [
    "visitors",
    "Tracked visitors",
    "Distinct visitors in observed sessions. Buyer history uses confirmed purchases.",
  ],
  [
    "sessions",
    "Tracked sessions",
    "Observed sessions that began in the selected period.",
  ],
] as const;

const spend = [
  [
    "selectedPeriodSpend",
    "Selected-period spend",
    "Net merchandise for the selected purchasing cohort within the selected financial scope.",
  ],
  [
    "observedLifetimeSpend",
    "Observed lifetime spend",
    "Recorded net merchandise for the selected purchasing cohort, including purchases and completed refunds outside the selected dates.",
  ],
] as const;

function Devices({ period, label }: { period: CustomerPeriod; label: string }) {
  const { devices, sessions } = period;
  if (!devices) return <p className="analytics-muted">Device activity is unavailable.</p>;
  if (!devices.rows.length)
    return (
      <p className="analytics-muted">
        {devices.totalCount === 0
          ? "No tracked devices in this period."
          : "No device rows on this page."}
      </p>
    );
  return (
    <ReportTable
      label={label}
      columns={[
        "Device",
        "Tracked visitors",
        "Tracked sessions",
        "Share of tracked sessions",
      ]}
    >
      {devices.rows.map((row) => (
        <tr key={row.device}>
          <th scope="row">{filterLabel(row.device)}</th>
          <td>{formatCount(row.visitors)}</td>
          <td>{formatCount(row.sessions)}</td>
          <td>{formatPercent(sessions ? row.sessions / sessions : null)}</td>
        </tr>
      ))}
    </ReportTable>
  );
}

function BuyerShares({ period, label }: { period: CustomerPeriod; label: string }) {
  const { buyers } = period;
  return (
    <div>
      <p className="analytics-muted">{label}</p>
      <StackedShares
        label={label}
        rows={(
          [
            ["newBuyers", "New buyers"],
            ["returningBuyers", "Returning buyers"],
          ] as const
        ).map(([key, name]) => ({
          key,
          label: name,
          share: {
            numerator: period[key],
            denominator: buyers,
            value: buyers && period[key] !== null ? period[key] / buyers : null,
          },
        }))}
      />
    </div>
  );
}

export function CustomersReport({
  report,
  request,
  onRequestChange,
}: {
  report: ReportEnvelope<CustomersData>;
  request: ReportRequest;
  onRequestChange: (change: DashboardChange) => void;
}) {
  const data = report.data;
  if (!data) return null;
  const { comparison, activeWindow, activeFiveMinuteVisitors } = data;
  return (
    <>
      <ReportPanel
        title="Buyer and visitor activity"
        description="Purchases and tracked sessions measure different populations. Recorded purchase history begins at analytics activation."
      >
        <AttributionCoverage attribution={report.scope.attribution} />
        {request.compare && (
          <PreviousAttributionCoverage
            attribution={comparison?.attribution ?? null}
            orderScope={report.scope.attribution.orderScope}
          />
        )}
        <div className="analytics-metrics analytics-metrics-customers">
          {counts.map(([key, label, definition]) => (
            <MetricCard
              key={key}
              label={label}
              value={formatCount(data[key])}
              comparison={request.compare ? formatCount(comparison?.[key] ?? null) : null}
              definition={definition}
            />
          ))}
        </div>
        <div className={comparison ? "analytics-columns" : undefined}>
          <BuyerShares period={data} label="Share of selected-period recorded buyers" />
          {comparison && (
            <BuyerShares
              period={comparison}
              label="Share of previous-period recorded buyers"
            />
          )}
        </div>
      </ReportPanel>
      <div className="analytics-columns">
        <ReportPanel
          title="Purchasing cohort spend"
          description={`Each period includes recorded buyers with a confirmed purchase in that period. Observed lifetime spend for both groups is evaluated as of ${formatStoreTime(report.asOf)}.`}
        >
          <div className="analytics-metrics analytics-metrics-compact">
            {spend.map(([key, label, definition]) => (
              <MetricCard
                key={key}
                label={label}
                value={formatMoney(data[key])}
                coverage={moneyCoverage(data[key])}
                comparison={
                  request.compare ? formatMoney(comparison?.[key] ?? null) : null
                }
                comparisonCoverage={moneyCoverage(comparison?.[key] ?? null)}
                definition={definition}
              />
            ))}
          </div>
        </ReportPanel>
        <ReportPanel
          title="Recent tracked activity"
          description="This observed window is independent of the calendar and previous-period comparison."
        >
          <MetricCard
            label="Active visitors in five observed minutes"
            value={activeWindow ? formatCount(activeFiveMinuteVisitors) : UNAVAILABLE}
            definition={
              activeWindow
                ? `${formatStoreTime(activeWindow.start)} to ${formatStoreTime(activeWindow.end)}`
                : "No verified recent five-minute window is available."
            }
          />
        </ReportPanel>
      </div>
      <ReportPanel
        title="Devices"
        description="Session shares use the full tracked session total. A visitor can use more than one device."
      >
        {data.devices?.rows.length ? (
          <RankedBars
            label="Tracked sessions by device"
            unit="count"
            valueLabel="Tracked sessions"
            rows={data.devices.rows.map(({ device, sessions }) => ({
              key: device,
              label: filterLabel(device),
              value: sessions,
            }))}
          />
        ) : null}
        <Devices period={data} label="Selected period devices" />
        {request.compare &&
          (comparison ? (
            <details className="analytics-chart-data">
              <summary>Previous period devices</summary>
              <Devices period={comparison} label="Previous period device table" />
            </details>
          ) : (
            <p className="analytics-muted">Previous period devices are unavailable.</p>
          ))}
        <ReportPager
          request={request}
          onRequestChange={onRequestChange}
          resultCount={Math.max(
            data.devices?.totalCount ?? 0,
            comparison?.devices?.totalCount ?? 0,
          )}
        />
      </ReportPanel>
      <ReportPanel
        title="Repeat purchase cohorts"
        description="Buyers whose first recorded purchase fell in the period are grouped by first purchase month. A dash marks a month that has yet to elapse."
      >
        <CohortHeatmap cohorts={data.cohorts} />
        {request.compare && (
          <details className="analytics-chart-data">
            <summary>Previous period cohorts</summary>
            <CohortHeatmap
              cohorts={comparison?.cohorts ?? null}
              label="Previous period buyer cohort heatmap"
            />
          </details>
        )}
      </ReportPanel>
    </>
  );
}
