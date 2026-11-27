import type { ReactNode } from "react";

export type ChartTableRow = { key: string; label: ReactNode; values: ReactNode[] };

export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: ChartTableRow[];
}) {
  return (
    <details className="analytics-chart-data">
      <summary>View chart data</summary>
      <div
        className="analytics-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        <table className="analytics-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, values }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {values.map((value, index) => (
                  <td key={index}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
