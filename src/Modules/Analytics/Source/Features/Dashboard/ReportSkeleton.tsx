export function ReportSkeleton({ updating = false }: { updating?: boolean }) {
  return (
    <div role="status" className="analytics-skeleton">
      <p>{updating ? "Updating report" : "Loading analytics report"}</p>
      <div className="analytics-metrics" aria-hidden="true">
        <div />
        <div />
        <div />
        <div />
      </div>
      <div className="analytics-columns analytics-columns-trend" aria-hidden="true">
        <div />
        <div />
      </div>
    </div>
  );
}
