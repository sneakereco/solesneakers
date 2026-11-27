export function MetricCard({
  label,
  value,
  comparison,
  definition,
  coverage,
  emphasis = false,
}: {
  label: string;
  value: string;
  comparison?: string | null;
  definition?: string;
  coverage?: string;
  emphasis?: boolean;
}) {
  return (
    <section
      className="analytics-metric"
      data-emphasis={emphasis || undefined}
      aria-label={label}
    >
      <h2>{label}</h2>
      <p className="analytics-metric-value">{value}</p>
      {comparison !== undefined && comparison !== null && (
        <p className="analytics-metric-comparison">Previous period · {comparison}</p>
      )}
      {definition && <p>{definition}</p>}
      {coverage && <p className="analytics-metric-comparison">{coverage}</p>}
    </section>
  );
}
