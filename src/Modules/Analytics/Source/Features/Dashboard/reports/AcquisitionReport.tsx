import type {
  AcquisitionData,
  AttributionBreakdown,
  PaginatedRows,
  ReportEnvelope,
  ReportRequest,
  ReportScope,
  SourceRow,
} from "../../ReportContract/types";
import { RankedBars } from "../charts/ComparisonCharts";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import { AttributionCoverage } from "../DataCoverage";
import { formatCount, formatMoney, formatPercent, moneyCoverage } from "../format";
import { ReportPanel } from "../ReportPanel";
import { ReportPager, ReportSort } from "../ReportRankingControls";
import { ReportTable } from "../ReportTable";
import {
  acquisitionLabel,
  type DashboardChange,
  type DashboardLocation,
} from "../request-state";

const axes = [
  ["sources", "Reported sources", "Source"],
  ["channels", "Reported channels", "Channel"],
  ["campaigns", "Reported campaigns", "Campaign"],
  ["placements", "Reported placements", "Placement"],
] as const;

const sortChoices = {
  sessions: "Tracked sessions",
  purchasingSessions: "Purchasing sessions",
  confirmedOrders: "Confirmed orders",
  revenue: "Net product sales",
};
type AcquisitionSort = keyof typeof sortChoices;

function AcquisitionTable({
  rows,
  label,
  dimension,
}: {
  rows: PaginatedRows<SourceRow>;
  label: string;
  dimension: string;
}) {
  return (
    <>
      <p className="analytics-muted">
        {formatCount(rows.totalCount)} matching{" "}
        {rows.totalCount === 1 ? "group" : "groups"}
      </p>
      {rows.rows.length ? (
        <ReportTable
          label={label}
          columns={[
            dimension,
            "Tracked sessions",
            "Purchasing sessions",
            "Session purchase rate",
            "Confirmed orders",
            "Net product sales",
          ]}
        >
          {rows.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{acquisitionLabel(row.label)}</th>
              <td>{formatCount(row.sessions)}</td>
              <td>{formatCount(row.purchasingSessions)}</td>
              <td>
                {formatPercent(
                  row.sessions && row.purchasingSessions !== null
                    ? row.purchasingSessions / row.sessions
                    : null,
                )}
              </td>
              <td>{formatCount(row.confirmedOrders)}</td>
              <td>
                {formatMoney(row.revenue)}
                <small>{moneyCoverage(row.revenue)}</small>
              </td>
            </tr>
          ))}
        </ReportTable>
      ) : (
        <p className="analytics-muted">
          {rows.totalCount
            ? "No rows on this page."
            : "No matching groups in this period."}
        </p>
      )}
    </>
  );
}

function viewCoverage(
  view: AttributionBreakdown,
  orderScope: ReportScope["attribution"]["orderScope"],
) {
  const { eligibleOrders, attributedOrders } = view.attribution;
  return {
    orderScope,
    eligibleOrders,
    attributedOrders,
    unattributedOrders: eligibleOrders - attributedOrders,
  };
}

export function AcquisitionReport({
  report,
  request,
  attribution,
  onRequestChange,
}: {
  report: ReportEnvelope<AcquisitionData>;
  request: ReportRequest;
  attribution: DashboardLocation["attribution"];
  onRequestChange: (change: DashboardChange) => void;
}) {
  const data = report.data;
  if (!data) return null;
  const view = attribution === "discovery" ? "discovery" : "purchaseSession";
  const selected = data[view];
  const previous = data.comparison?.[view];
  const { orderScope } = report.scope.attribution;
  const sort = request.sort as AcquisitionSort;
  const resultCount = Math.max(
    ...axes.flatMap(([key]) => [
      selected[key].totalCount,
      previous?.[key].totalCount ?? 0,
    ]),
  );
  return (
    <>
      <ReportPanel
        title="Acquisition"
        description={
          attribution === "discovery"
            ? "First discovery uses the recorded discovery context carried by tracked sessions and linked orders."
            : "Purchase session uses the recorded session context on confirmed linked orders. Tracked traffic uses its session context."
        }
      >
        <div className="analytics-filter-row">
          <label>
            Attribution view
            <select
              value={attribution}
              onChange={({ target }) =>
                onRequestChange({
                  attribution: target.value as DashboardLocation["attribution"],
                })
              }
            >
              <option value="purchase-session">Purchase session</option>
              <option value="discovery">First discovery</option>
            </select>
          </label>
          <ReportSort
            request={request}
            onRequestChange={onRequestChange}
            choices={sortChoices}
          />
        </div>
        <AttributionCoverage attribution={viewCoverage(selected, orderScope)} />
        {request.compare && (
          <div>
            <p className="analytics-muted">Previous period</p>
            {previous ? (
              <AttributionCoverage attribution={viewCoverage(previous, orderScope)} />
            ) : (
              <p className="analytics-muted">
                Previous period acquisition is unavailable.
              </p>
            )}
          </div>
        )}
      </ReportPanel>
      <div className="analytics-columns">
        <ReportPanel title="Traffic over time">
          <TimeSeriesChart
            buckets={selected.series}
            comparison={previous?.series}
            unit="sessions"
          />
        </ReportPanel>
        <ReportPanel title="Net product sales over time">
          <TimeSeriesChart
            buckets={selected.series}
            comparison={previous?.series}
            unit="netMerchandise"
          />
        </ReportPanel>
      </div>
      <div className="analytics-columns">
        {axes.map(([key, label, dimension]) => (
          <ReportPanel key={key} title={label}>
            {key === "sources" && selected.sources.rows.length > 0 && (
              <RankedBars
                label={`First five sources on this page by ${sortChoices[sort].toLowerCase()}`}
                unit={sort === "revenue" ? "usd" : "count"}
                valueLabel={sortChoices[sort]}
                rows={selected.sources.rows.slice(0, 5).map((row) => ({
                  key: row.key,
                  label: acquisitionLabel(row.label),
                  value: row[sort],
                }))}
              />
            )}
            <AcquisitionTable rows={selected[key]} label={label} dimension={dimension} />
            {previous && (
              <details className="analytics-chart-data">
                <summary>Previous period {dimension.toLowerCase()} groups</summary>
                <AcquisitionTable
                  rows={previous[key]}
                  label={`Previous period ${label.toLowerCase()}`}
                  dimension={dimension}
                />
              </details>
            )}
          </ReportPanel>
        ))}
      </div>
      <ReportPager
        request={request}
        onRequestChange={onRequestChange}
        resultCount={resultCount}
      />
    </>
  );
}
