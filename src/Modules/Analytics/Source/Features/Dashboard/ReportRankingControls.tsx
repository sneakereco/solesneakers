import { MAX_REPORT_OFFSET } from "../ReportContract/filters";
import type { ReportRequest } from "../ReportContract/types";
import { formatCount } from "./format";
import type { DashboardChange } from "./request-state";

type RequestControls = {
  request: ReportRequest;
  onRequestChange: (change: DashboardChange) => void;
};

export function ReportSort({
  request,
  onRequestChange,
  choices,
}: RequestControls & {
  choices: Record<string, string>;
}) {
  return (
    <div className="analytics-filter-row">
      <label>
        Rank by
        <select
          value={request.sort}
          onChange={({ target }) => onRequestChange({ sort: target.value })}
        >
          {Object.entries(choices).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function ReportPager({
  request,
  onRequestChange,
  resultCount,
}: RequestControls & {
  resultCount: number;
}) {
  const { page, pageSize } = request;
  const pageCount = Math.min(
    Math.ceil(resultCount / pageSize),
    Math.floor(MAX_REPORT_OFFSET / pageSize) + 1,
  );
  if (pageCount <= 1 && page <= 1) return null;
  return (
    <nav className="analytics-filter-row" aria-label="Report pages">
      <button
        type="button"
        className="admin-button-secondary"
        disabled={page <= 1}
        onClick={() => onRequestChange({ page: page - 1 })}
      >
        Previous page
      </button>
      <span className="analytics-muted">Page {formatCount(page)}</span>
      <button
        type="button"
        className="admin-button-secondary"
        disabled={page >= pageCount}
        onClick={() => onRequestChange({ page: page + 1 })}
      >
        Next page
      </button>
      {page > 2 && (
        <button
          type="button"
          className="admin-button-secondary"
          onClick={() => onRequestChange({ page: 1 })}
        >
          First page
        </button>
      )}
    </nav>
  );
}
