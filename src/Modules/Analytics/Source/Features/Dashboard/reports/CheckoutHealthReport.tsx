import Link from "next/link";
import type {
  FunnelStep,
  HealthData,
  HealthPeriod,
  Rate,
  ReportEnvelope,
  ReportRequest,
} from "../../ReportContract/types";
import { FunnelChart } from "../charts/FunnelChart";
import { StackedShares } from "../charts/ComparisonCharts";
import { AttributionCoverage, PreviousAttributionCoverage } from "../DataCoverage";
import {
  formatCount,
  formatPercent,
  formatPreviousPeriod,
  formatStoreInterval,
  formatStoreTime,
  rateFromCounts,
  UNAVAILABLE,
} from "../format";
import { ReportPanel } from "../ReportPanel";
import { ReportSort } from "../ReportRankingControls";
import { ReportTable } from "../ReportTable";
import { filterLabel, type DashboardChange } from "../request-state";

const sortChoices = { count: "Recorded count", state: "Recorded state" };
const preferences = [
  ["ship", "Shipping"],
  ["pickup", "Pickup"],
  ["unknown", "Unknown preference"],
] as const;
const stateGroups: Record<string, string> = {
  pending: "Open",
  processing: "Open",
  unfulfilled: "Open",
  ready: "Open",
  ready_for_pickup: "Open",
  shipped: "Fulfillment recorded",
  delivered: "Fulfillment recorded",
  picked_up: "Fulfillment recorded",
  fulfilled: "Fulfillment recorded",
  canceled: "Canceled",
  unknown: "Status unknown",
};

function SessionFunnel({ steps }: { steps: FunnelStep[] }) {
  return steps.some(({ sessions }) => sessions !== null) ? (
    <FunnelChart steps={steps} />
  ) : (
    <p className="analytics-muted">Same-session funnel unavailable for this period.</p>
  );
}

function CheckoutCompletion({ completion }: { completion: Rate }) {
  const { numerator, denominator, value } = completion;
  if (numerator === null || denominator === null)
    return (
      <p className="analytics-muted">
        Checkout completion unavailable for this period.
        {denominator !== null &&
          ` ${formatCount(denominator)} sessions reached usable checkout.`}
      </p>
    );
  return (
    <p className="analytics-muted">
      <strong>Checkout completion</strong>{" "}
      {denominator === 0
        ? "· 0 sessions reached usable checkout"
        : `· ${formatPercent(value)} (${formatCount(numerator)} / ${formatCount(denominator)}) sessions purchased after reaching usable checkout`}
    </p>
  );
}

function OutcomeTable({
  label,
  outcomes,
}: {
  label: string;
  outcomes: HealthPeriod["outcomes"];
}) {
  if (outcomes === null)
    return <p className="analytics-muted">Operational outcomes unavailable.</p>;
  return outcomes.length ? (
    <ReportTable label={label} columns={["Stage", "Outcome", "Reason", "Recorded count"]}>
      {outcomes.map(({ stage, outcome, reason, count }) => (
        <tr key={`${stage}/${outcome}/${reason}`}>
          <th scope="row">{filterLabel(stage)}</th>
          <td>{filterLabel(outcome)}</td>
          <td>{filterLabel(reason)}</td>
          <td>{formatCount(count)}</td>
        </tr>
      ))}
    </ReportTable>
  ) : (
    <p className="analytics-muted">No operational outcomes recorded for this period.</p>
  );
}

function durationLabel(seconds: number | null) {
  if (seconds === null) return UNAVAILABLE;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [
    hours ? `${formatCount(hours)}h` : "",
    minutes ? `${formatCount(minutes)}m` : "",
    remainder || !seconds ? `${formatCount(remainder)}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function FulfillmentTables({
  period,
  confirmedInterval,
  previous = false,
}: {
  period: HealthPeriod;
  confirmedInterval: string;
  previous?: boolean;
}) {
  const {
    fulfillmentPreference,
    missingFulfillmentStates,
    missingFulfillmentDurations,
    backlog,
    paymentToFulfillment,
  } = period;
  const preferenceTotal = fulfillmentPreference
    ? fulfillmentPreference.ship +
      fulfillmentPreference.pickup +
      fulfillmentPreference.unknown
    : null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <p className="analytics-muted">
        Originally confirmed {confirmedInterval} · Eastern Time
      </p>
      <h3 className="text-sm font-semibold">Fulfillment preference</h3>
      {fulfillmentPreference ? (
        <>
          <p className="analytics-muted">
            Share of confirmed orders in scope, including unknown preference.
          </p>
          <StackedShares
            label={
              previous
                ? "Previous period fulfillment preference shares"
                : "Fulfillment preference shares"
            }
            rows={preferences.map(([key, label]) => ({
              key,
              label,
              share: rateFromCounts(fulfillmentPreference[key], preferenceTotal),
            }))}
          />
        </>
      ) : (
        <p className="analytics-muted">Fulfillment preference unavailable.</p>
      )}
      <h3 className="text-sm font-semibold">Latest recorded fulfillment states</h3>
      {backlog?.length ? (
        <ReportTable
          label={
            previous
              ? "Previous period latest recorded fulfillment states"
              : "Latest recorded fulfillment states"
          }
          columns={["Fulfillment", "Latest recorded state", "Backlog status", "Orders"]}
        >
          {backlog.map(({ fulfillment, state, count }) => (
            <tr key={`${fulfillment}/${state}`}>
              <th scope="row">{filterLabel(fulfillment)}</th>
              <td>{filterLabel(state)}</td>
              <td>{stateGroups[state] ?? "Status unknown"}</td>
              <td>{formatCount(count)}</td>
            </tr>
          ))}
        </ReportTable>
      ) : (
        <p className="analytics-muted">
          {backlog === null
            ? "Fulfillment states unavailable."
            : "No fulfillment states recorded for these orders."}
        </p>
      )}
      {missingFulfillmentStates !== null && (
        <p className="analytics-muted">
          {formatCount(missingFulfillmentStates)}{" "}
          {missingFulfillmentStates === 1 ? "order" : "orders"} without a recorded
          fulfillment state
        </p>
      )}
      <h3 className="text-sm font-semibold">Payment to fulfillment</h3>
      {paymentToFulfillment?.length ? (
        <ReportTable
          label={
            previous
              ? "Previous period payment-to-fulfillment durations"
              : "Payment-to-fulfillment durations"
          }
          columns={[
            "Fulfillment",
            "Orders with durations",
            "Median elapsed time",
            "90th percentile",
          ]}
        >
          {paymentToFulfillment.map(
            ({ fulfillment, fulfilledOrders, medianSeconds, p90Seconds }) => (
              <tr key={fulfillment}>
                <th scope="row">{filterLabel(fulfillment)}</th>
                <td>{formatCount(fulfilledOrders)}</td>
                <td>{durationLabel(medianSeconds)}</td>
                <td>{durationLabel(p90Seconds)}</td>
              </tr>
            ),
          )}
        </ReportTable>
      ) : (
        <p className="analytics-muted">
          {paymentToFulfillment === null
            ? "Payment-to-fulfillment durations unavailable."
            : "No recorded payment-to-fulfillment durations for these orders."}
        </p>
      )}
      {missingFulfillmentDurations !== null && (
        <p className="analytics-muted">
          {formatCount(missingFulfillmentDurations)} fulfilled{" "}
          {missingFulfillmentDurations === 1 ? "order" : "orders"} without usable duration
          evidence
        </p>
      )}
    </div>
  );
}

export function CheckoutHealthReport({
  report,
  request,
  onRequestChange,
}: {
  report: ReportEnvelope<HealthData>;
  request: ReportRequest;
  onRequestChange: (change: DashboardChange) => void;
}) {
  const { data, ingestionAsOf, range, scope } = report;
  if (!data) return null;

  const { comparison } = data;
  return (
    <>
      <div className="analytics-columns">
        <ReportPanel
          title="Same-session checkout funnel"
          description="Tracks ordered steps within sessions with analytics consent. A purchase requires a confirmed order linked to that session."
        >
          <SessionFunnel steps={data.funnel} />
          <CheckoutCompletion completion={data.checkoutCompletion} />
          {comparison && (
            <details className="analytics-chart-data">
              <summary>Previous period checkout funnel</summary>
              <SessionFunnel steps={comparison.funnel} />
              <CheckoutCompletion completion={comparison.checkoutCompletion} />
            </details>
          )}
        </ReportPanel>
        <ReportPanel
          title="Operational checkout outcomes"
          description="Counts can overlap across stages and reasons. Server-recorded reservation expirations are tracked separately from session progression."
        >
          <ReportSort
            request={request}
            onRequestChange={onRequestChange}
            choices={sortChoices}
          />
          <p className="analytics-muted">
            {scope.dateBasis === "activity"
              ? "Resolved outcomes use the resolution date. Pending and unknown outcomes use the start date."
              : "Outcomes are grouped by the original confirmation date of their linked order."}
          </p>
          <OutcomeTable label="Recorded operational outcomes" outcomes={data.outcomes} />
          {comparison && (
            <details className="analytics-chart-data">
              <summary>Previous period operational outcomes</summary>
              <OutcomeTable
                label="Previous period recorded operational outcomes"
                outcomes={comparison.outcomes}
              />
            </details>
          )}
        </ReportPanel>
      </div>
      <ReportPanel
        title="Fulfillment and backlog"
        description="States and elapsed fulfillment times follow the original order confirmation range. Later fulfillment updates can appear in either period."
      >
        <div className="analytics-filter-row">
          <Link className="admin-button-secondary" href="/admin/shipping">
            Open Shipping
          </Link>
          <Link className="admin-button-secondary" href="/admin/pickups">
            Open Pickups
          </Link>
        </div>
        <AttributionCoverage attribution={scope.attribution} />
        {request.compare && (
          <PreviousAttributionCoverage
            attribution={comparison?.attribution ?? null}
            orderScope={scope.attribution.orderScope}
          />
        )}
        <p className="analytics-muted">
          Warehouse observed through{" "}
          {ingestionAsOf ? (
            <time dateTime={ingestionAsOf}>{formatStoreTime(ingestionAsOf)}</time>
          ) : (
            "unverified"
          )}
          {" · "}Backlog age unavailable
        </p>
        <FulfillmentTables
          period={data}
          confirmedInterval={formatStoreInterval(
            range.startInclusive,
            range.endExclusive,
          )}
        />
        {comparison && (
          <details className="analytics-chart-data">
            <summary>Previous period fulfillment</summary>
            <FulfillmentTables
              period={comparison}
              confirmedInterval={formatPreviousPeriod(range)}
              previous
            />
          </details>
        )}
        {request.compare && !comparison && (
          <p className="analytics-muted">
            Previous period checkout and fulfillment data is unavailable.
          </p>
        )}
      </ReportPanel>
    </>
  );
}
