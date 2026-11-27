import type { ReactNode } from "react";

export function ReportTable({
  label,
  columns,
  children,
}: {
  label: string;
  columns: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="analytics-table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="analytics-table analytics-report-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
