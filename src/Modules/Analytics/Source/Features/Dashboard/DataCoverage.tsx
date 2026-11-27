import type {
  CoverageIssue,
  ReportEnvelope,
  ReportScope,
  SalesPeriod,
} from "../ReportContract/types";
import { formatCount, formatStoreTime } from "./format";

const stateLabels = {
  ready: "",
  empty: "No activity during the selected period.",
  stale: "Showing the most recent available report.",
  unconfigured: "Analytics setup is incomplete.",
  unavailable: "This report is unavailable.",
} satisfies Record<ReportEnvelope<unknown>["state"], string>;

export function DataCoverage({
  coverage,
  state,
  asOf,
  ingestionAsOf,
  behaviorThrough,
  datasetStartedAt,
  partial,
}: {
  coverage: CoverageIssue[];
  state: ReportEnvelope<unknown>["state"];
  asOf: string;
  ingestionAsOf?: string | null;
  behaviorThrough?: string | null;
  datasetStartedAt?: string | null;
  partial?: boolean;
}) {
  const warnings = [...new Set(coverage.map(({ message }) => message))];
  const message = stateLabels[state];
  return (
    <div className="analytics-coverage" data-state={state}>
      {(message || partial) && (
        <div role="status">
          {message && <p className="analytics-coverage-state">{message}</p>}
          {partial && <p>Today is included as a partial day.</p>}
        </div>
      )}
      <div className="analytics-coverage-times">
        <span>
          Report as of <time dateTime={asOf}>{formatStoreTime(asOf)}</time>
        </span>
        {ingestionAsOf !== undefined && (
          <span>
            Warehouse observed through{" "}
            {ingestionAsOf ? (
              <time dateTime={ingestionAsOf}>{formatStoreTime(ingestionAsOf)}</time>
            ) : (
              "unverified"
            )}
          </span>
        )}
        {behaviorThrough && (
          <span>
            Tracked activity through{" "}
            <time dateTime={behaviorThrough}>{formatStoreTime(behaviorThrough)}</time>
          </span>
        )}
        {datasetStartedAt && (
          <span>
            Analytics since{" "}
            <time dateTime={datasetStartedAt}>{formatStoreTime(datasetStartedAt)}</time>
          </span>
        )}
      </div>
      {warnings.length > 0 && (
        <ul className="analytics-coverage-warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function componentUnavailable(coverage: CoverageIssue[], metric: string) {
  return coverage.some(
    (issue) => issue.code === "component-unavailable" && issue.metric === metric,
  );
}

export function AttributionCoverage({
  attribution,
}: {
  attribution: ReportScope["attribution"];
}) {
  const { attributedOrders, eligibleOrders, unattributedOrders, orderScope } =
    attribution;
  const scope =
    orderScope === "all-orders"
      ? "Eligible orders in the current business scope"
      : "Eligible orders before the device or acquisition segment";
  return (
    <p className="analytics-muted">
      {attributedOrders === null ||
      eligibleOrders === null ||
      unattributedOrders === null ? (
        <>
          Attribution coverage unavailable · {scope}
          {eligibleOrders !== null && ` · ${formatCount(eligibleOrders)} eligible`}
        </>
      ) : (
        <>
          {scope} · {formatCount(attributedOrders)} of {formatCount(eligibleOrders)}{" "}
          attributed · {formatCount(unattributedOrders)} unattributed
        </>
      )}
    </p>
  );
}

export function PreviousAttributionCoverage({
  attribution,
  orderScope,
}: {
  attribution: SalesPeriod["attribution"] | null;
  orderScope: ReportScope["attribution"]["orderScope"];
}) {
  return (
    <div>
      <p className="analytics-muted">Previous period attribution</p>
      <AttributionCoverage
        attribution={{
          orderScope,
          eligibleOrders: attribution?.eligibleOrders ?? null,
          attributedOrders: attribution?.attributedOrders ?? null,
          unattributedOrders: attribution
            ? attribution.eligibleOrders - attribution.attributedOrders
            : null,
        }}
      />
    </div>
  );
}
