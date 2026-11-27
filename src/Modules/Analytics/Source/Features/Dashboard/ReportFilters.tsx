import { X } from "lucide-react";
import { useId } from "react";
import {
  REPORT_FILTER_VALUES,
  type ReportFilters as ReportFilterValues,
  type ReportRequest,
  type SourceRow,
} from "../ReportContract/types";
import { CalendarRangeFilter } from "./CalendarRangeFilter";
import { formatPreviousPeriod } from "./format";
import { filterLabel, filterNames, type DashboardChange } from "./request-state";

const salesSelects = [
  ["paymentMethod", "All payment methods"],
  ["fulfillment", "All fulfillment types"],
] as const;

export function ReportFilters({
  request,
  onChange,
  sources,
}: {
  request: ReportRequest;
  onChange: (change: DashboardChange) => void;
  sources?: SourceRow[];
}) {
  const id = useId();
  const reportedSources = new Map(sources?.map(({ key, label }) => [key, label]));
  if (request.source && !reportedSources.has(request.source))
    reportedSources.set(request.source, filterLabel(request.source));
  const showSources = request.report === "overview" && reportedSources.size > 0;
  const showSalesFilters = request.report === "sales";
  const otherFilters = (
    Object.keys(filterNames) as Array<keyof ReportFilterValues>
  ).filter(
    (key) =>
      key !== "device" &&
      !(key === "source" && showSources) &&
      !(showSalesFilters && salesSelects.some(([filter]) => key === filter)) &&
      request[key] !== undefined,
  );

  return (
    <div className="analytics-filters">
      <div className="analytics-filter-row" role="group" aria-label="Report filters">
        <CalendarRangeFilter
          value={request.range}
          onApply={(range) => onChange({ range })}
        />
        <div className="analytics-filter-field">
          <label htmlFor={`${id}-device`}>Device</label>
          <select
            id={`${id}-device`}
            value={request.device ?? ""}
            onChange={(event) =>
              onChange({
                device: (event.target.value || undefined) as ReportRequest["device"],
              })
            }
          >
            <option value="">All devices</option>
            {REPORT_FILTER_VALUES.device.map((device) => (
              <option key={device} value={device}>
                {filterLabel(device)}
              </option>
            ))}
          </select>
        </div>
        {showSources && (
          <div className="analytics-filter-field">
            <label htmlFor={`${id}-source`}>Source</label>
            <select
              id={`${id}-source`}
              value={request.source ?? ""}
              onChange={(event) => onChange({ source: event.target.value || undefined })}
            >
              <option value="">All sources</option>
              <optgroup label="Reported sources">
                {[...reportedSources].map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        )}
        {showSalesFilters &&
          salesSelects.map(([filter, all]) => (
            <div className="analytics-filter-field" key={filter}>
              <label htmlFor={id + "-" + filter}>{filterNames[filter]}</label>
              <select
                id={id + "-" + filter}
                value={request[filter] ?? ""}
                onChange={(event) =>
                  onChange({
                    [filter]: (event.target.value ||
                      undefined) as ReportRequest[typeof filter],
                  })
                }
              >
                <option value="">{all}</option>
                {REPORT_FILTER_VALUES[filter].map((value) => (
                  <option key={value} value={value}>
                    {filterLabel(value)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        <div className="analytics-filter-field">
          <label htmlFor={`${id}-group`}>Group by</label>
          <select
            id={`${id}-group`}
            value={request.bucket}
            onChange={(event) =>
              onChange({ bucket: event.target.value as ReportRequest["bucket"] })
            }
          >
            {REPORT_FILTER_VALUES.bucket.map((unit) => (
              <option key={unit} value={unit}>
                {filterLabel(unit)}
              </option>
            ))}
          </select>
        </div>
        <div className="analytics-filter-field">
          <label htmlFor={`${id}-basis`}>Date basis</label>
          <select
            id={`${id}-basis`}
            value={request.dateBasis}
            onChange={(event) =>
              onChange({ dateBasis: event.target.value as ReportRequest["dateBasis"] })
            }
          >
            {REPORT_FILTER_VALUES.dateBasis.map((basis) => (
              <option key={basis} value={basis}>
                {filterLabel(basis)}
              </option>
            ))}
          </select>
        </div>
        <label className="analytics-compare">
          <input
            type="checkbox"
            checked={request.compare}
            onChange={(event) => onChange({ compare: event.target.checked })}
          />
          Compare previous period
        </label>
      </div>
      <div className="analytics-filter-scope">
        <span>
          {request.range.calendarDays} {request.range.calendarDays === 1 ? "day" : "days"}{" "}
          · Eastern Time
        </span>
        {request.compare && (
          <span>
            Previous period · {formatPreviousPeriod(request.range)} ·{" "}
            {request.range.calendarDays}{" "}
            {request.range.calendarDays === 1 ? "day" : "days"}
          </span>
        )}
      </div>
      {otherFilters.length > 0 && (
        <div
          className="analytics-scope-pills"
          role="group"
          aria-label="Other applied filters"
        >
          {otherFilters.map((key) => {
            const name = filterNames[key];
            const value = key.endsWith("Id")
              ? `Selected ${name.toLowerCase()}`
              : `${name}: ${filterLabel(request[key]!)}`;
            return (
              <button
                type="button"
                key={key}
                aria-label={`Clear ${name.toLowerCase()} filter`}
                onClick={() => onChange({ [key]: undefined })}
              >
                {value}
                <X size={13} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
