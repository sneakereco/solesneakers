import { REPORT_TIMEZONE, type TimeBucket } from "../../ReportContract/types";
import {
  chartNumber,
  formatChartValue,
  formatStoreInterval,
  moneyCoverage,
} from "../format";
import { ChartDataTable } from "./ChartDataTable";

const units = {
  netMerchandise: {
    label: "Net product sales",
    heading: "Net product sales (USD)",
    format: "usd",
  },
  confirmedOrders: {
    label: "Confirmed orders",
    heading: "Confirmed orders",
    format: "count",
  },
  sessions: { label: "Tracked sessions", heading: "Tracked sessions", format: "count" },
  visitors: { label: "Tracked visitors", heading: "Tracked visitors", format: "count" },
} as const;

export type TimeSeriesUnit = keyof typeof units;

const axisDate = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIMEZONE,
  month: "short",
  day: "numeric",
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function TimeSeriesChart({
  buckets,
  unit,
  comparison = null,
}: {
  buckets: TimeBucket[];
  unit: TimeSeriesUnit;
  comparison?: TimeBucket[] | null;
}) {
  const metric = units[unit];
  const all = [...buckets, ...(comparison ?? [])].map((bucket) =>
    chartNumber(bucket[unit]),
  );
  const known = all.filter((value): value is number => value !== null);
  if (!all.length)
    return <p className="analytics-muted">No time buckets in the selected period.</p>;

  const low = Math.min(0, ...known);
  const high = Math.max(0, ...known) || (low === 0 ? 1 : 0);
  const positions = Math.max(buckets.length, comparison?.length ?? 0);
  const x = (index: number) =>
    positions > 1 ? 6 + (index * 588) / (positions - 1) : 300;
  const y = (value: number) => 7 + ((high - value) * 166) / (high - low);
  const tick = (value: number) =>
    unit === "netMerchandise"
      ? Math.abs(value) < 10_000
        ? formatChartValue(value, "usd")
        : (value < 0 ? "-" : "") + "$" + compact.format(Math.abs(value) / 100)
      : compact.format(value);
  const middle = Math.round((low + high) / 2);
  const ticks = [...new Set([high, middle, low])];

  function plot(series: TimeBucket[], label: string, dashed?: boolean) {
    let penDown = false;
    const points = series.flatMap((bucket, index) => {
      const value = chartNumber(bucket[unit]);
      if (value === null) {
        penDown = false;
        return [];
      }
      const command = penDown ? "L" : "M";
      penDown = true;
      return [
        {
          path: `${command}${x(index)},${y(value)}`,
          x: x(index),
          y: y(value),
          bucket,
          index,
        },
      ];
    });
    return (
      <g className={dashed ? "analytics-series-prior" : "analytics-series-current"}>
        <path
          d={points.map((point) => point.path).join(" ")}
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point, index) => {
          const isolated =
            point.path.startsWith("M") && !points[index + 1]?.path.startsWith("L");
          return (
            (series.length <= 60 || isolated) && (
              <circle
                key={point.index}
                cx={point.x}
                cy={point.y}
                r={3}
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {label}:{" "}
                  {formatStoreInterval(
                    point.bucket.startInclusive,
                    point.bucket.endExclusive,
                  )}{" "}
                  · {formatChartValue(point.bucket[unit], metric.format)}
                </title>
              </circle>
            )
          );
        })}
      </g>
    );
  }

  const labelSeries = buckets.length ? buckets : (comparison ?? []);
  const labelIndices = [
    ...new Set([0, Math.floor((labelSeries.length - 1) / 2), labelSeries.length - 1]),
  ];
  const rows = [
    { label: "Selected period", series: buckets },
    ...(comparison ? [{ label: "Previous period", series: comparison }] : []),
  ].flatMap(({ label, series }) =>
    series.map((bucket) => ({
      key: `${label}-${bucket.startInclusive}`,
      label: formatStoreInterval(bucket.startInclusive, bucket.endExclusive),
      values: [
        label,
        formatChartValue(bucket[unit], metric.format),
        moneyCoverage(unit === "netMerchandise" ? bucket.netMerchandise : null) ?? "—",
      ],
    })),
  );

  return (
    <section className="analytics-series" aria-label={`${metric.label} trend`}>
      {known.length ? (
        <>
          <div className="analytics-series-plot" aria-hidden="true">
            <div className="analytics-series-axis">
              {ticks.map((value) => (
                <span key={value} style={{ top: `${(y(value) * 100) / 180}%` }}>
                  {tick(value)}
                </span>
              ))}
            </div>
            <svg viewBox="0 0 600 180" preserveAspectRatio="none">
              {ticks.map((value) => (
                <line
                  key={value}
                  x1="0"
                  x2="600"
                  y1={y(value)}
                  y2={y(value)}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {comparison && plot(comparison, "Previous period", true)}
              {plot(buckets, "Selected period")}
            </svg>
            <div className="analytics-series-dates">
              {labelIndices.map((index) => (
                <span key={index}>
                  {axisDate.format(new Date(labelSeries[index].startInclusive))}
                </span>
              ))}
            </div>
          </div>
          <div className="analytics-chart-legend">
            <span>
              <i aria-hidden="true" />
              Selected period
            </span>
            {comparison && (
              <span>
                <i className="analytics-chart-dashed" aria-hidden="true" />
                Previous period, aligned by bucket order
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="analytics-muted">
          {metric.label} is unavailable for these time buckets.
        </p>
      )}
      <ChartDataTable
        caption={`${metric.label} by reporting interval`}
        columns={["Date range (ET)", "Period", metric.heading, "Coverage"]}
        rows={rows}
      />
    </section>
  );
}
