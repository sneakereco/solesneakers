import type { ReactNode } from "react";

export function ReportPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="analytics-panel" data-admin-section-card>
      <div className="analytics-panel-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}
