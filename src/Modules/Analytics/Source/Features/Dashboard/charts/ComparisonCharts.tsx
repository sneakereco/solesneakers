import type { Rate, SalesComponents, SalesPeriod } from "../../ReportContract/types";
import {
  chartNumber,
  formatChartValue,
  formatCount,
  formatMoney,
  formatPercent,
  moneyCoverage,
  type ChartUnit,
  type ChartValue,
} from "../format";
import { ChartDataTable } from "./ChartDataTable";

export type RankedBarRow = { key: string; label: string; value: ChartValue };
const headings: Record<ChartUnit, string> = {
  usd: "Amount (USD)",
  count: "Count",
  percent: "Share",
};

export function RankedBars({
  rows,
  unit,
  label,
  valueLabel = headings[unit],
}: {
  rows: RankedBarRow[];
  unit: ChartUnit;
  label: string;
  valueLabel?: string;
}) {
  if (!rows.length)
    return <p className="analytics-muted">No rows for the selected period.</p>;
  const known = rows.map((row) => chartNumber(row.value) ?? 0);
  const low = Math.min(0, ...known);
  const high = Math.max(0, ...known);
  const span = high - low || 1;
  const origin = (-low * 100) / span;

  return (
    <section aria-label={label}>
      <ol className="analytics-bars" aria-hidden="true">
        {rows.map(({ key, label: name, value }) => {
          const amount = chartNumber(value);
          return (
            <li key={key}>
              <span>{name}</span>
              <span className="analytics-bar-track">
                {amount !== null && (
                  <i
                    style={{
                      left: `${amount < 0 ? origin + (amount * 100) / span : origin}%`,
                      width: `${(Math.abs(amount) * 100) / span}%`,
                    }}
                  />
                )}
              </span>
              <strong>{formatChartValue(value, unit)}</strong>
            </li>
          );
        })}
      </ol>
      <ChartDataTable
        caption={label}
        columns={["Name", valueLabel, "Coverage"]}
        rows={rows.map(({ key, label: name, value }) => ({
          key,
          label: name,
          values: [
            formatChartValue(value, unit),
            moneyCoverage(typeof value === "object" ? value : null) ?? "—",
          ],
        }))}
      />
    </section>
  );
}

export function Histogram({ bins }: { bins: SalesPeriod["orderValueBins"] }) {
  return (
    <RankedBars
      label="Order value distribution"
      valueLabel="Confirmed orders"
      unit="count"
      rows={bins.map(({ minimumCents, maximumCentsExclusive, confirmedOrders }) => {
        const minimum = formatChartValue(minimumCents, "usd");
        return {
          key: String(minimumCents),
          value: confirmedOrders,
          label:
            maximumCentsExclusive === null
              ? `${minimum} and up`
              : `${minimum} to under ${formatChartValue(maximumCentsExclusive, "usd")}`,
        };
      })}
    />
  );
}

const waterfallSteps = [
  ["grossMerchandise", "Gross product sales", 1],
  ["discounts", "Discounts", -1],
  ["merchandiseRefunds", "Product refunds", -1],
  ["shippingCollected", "Shipping collected", 1],
  ["shippingRefunds", "Shipping refunds", -1],
  ["taxCollected", "Tax collected", 1],
  ["taxRefunds", "Tax refunds", -1],
  ["unallocatedRefunds", "Unallocated refunds", -1],
  ["totalCollected", "Total collected, net", 1],
] as const;

export function Waterfall({ components }: { components: SalesComponents }) {
  let running = 0n;
  const steps = [];
  for (const [key, label, sign] of waterfallSteps) {
    const value = components[key];
    const cents = value.cents === null ? null : value.cents * sign;
    const start = key === "totalCollected" ? 0n : running;
    const end = start + BigInt(cents ?? 0);
    if (key !== "totalCollected") running = end;
    steps.push({
      key,
      label,
      value: { ...value, cents },
      cents,
      start: Number(start),
      end: Number(end),
    });
  }
  const complete = steps.every(({ value }) => value.cents !== null && value.complete);
  const showGeometry = complete && running === BigInt(components.totalCollected.cents!);
  const low = Math.min(0, ...steps.map(({ end }) => end));
  const high = Math.max(0, ...steps.map(({ end }) => end));
  const span = high - low || 1;

  return (
    <section aria-label="Collected revenue waterfall">
      {showGeometry ? (
        <ol className="analytics-bars" aria-hidden="true">
          {steps.map(({ key, label, value, cents, start, end }) => (
            <li key={key}>
              <span>{label}</span>
              <span className="analytics-bar-track">
                <i
                  className={
                    cents !== null && cents < 0 ? "analytics-bar-deduction" : undefined
                  }
                  style={{
                    left: `${((Math.min(start, end) - low) * 100) / span}%`,
                    width: `${(Math.abs(end - start) * 100) / span}%`,
                  }}
                />
              </span>
              <strong>{formatMoney(value)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="analytics-muted">
          {complete
            ? "The components and recorded collected total differ. View recorded amounts below."
            : "Coverage is incomplete for the full waterfall. View recorded amounts below."}
        </p>
      )}
      <ChartDataTable
        caption="Collected revenue components"
        columns={["Component", "Amount (USD)", "Coverage"]}
        rows={steps.map(({ key, label, value }) => ({
          key,
          label,
          values: [formatMoney(value), moneyCoverage(value) ?? "—"],
        }))}
      />
    </section>
  );
}

export type ShareRow = { key: string; label: string; share: Rate };
const shades = ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8"];

export function StackedShares({
  rows,
  label = "Share breakdown",
}: {
  rows: ShareRow[];
  label?: string;
}) {
  if (!rows.length)
    return <p className="analytics-muted">No shares for the selected period.</p>;
  const known = rows.filter(({ share }) => share.value !== null);
  const available =
    known.length > 0 &&
    known.every(({ share }) => share.denominator === known[0].share.denominator) &&
    known.reduce((sum, { share }) => sum + (share.value ?? 0), 0) <= 1 + Number.EPSILON;

  return (
    <section aria-label={label}>
      {available && (
        <div className="analytics-stacked-shares" aria-hidden="true">
          {rows.map(
            ({ key, share }, index) =>
              share.value !== null && (
                <i
                  key={key}
                  style={{
                    width: `${share.value * 100}%`,
                    background: shades[index % shades.length],
                  }}
                />
              ),
          )}
        </div>
      )}
      <ul className="analytics-chart-legend" aria-hidden="true">
        {rows.map(({ key, label: name, share }, index) => (
          <li key={key}>
            {available && share.value !== null && (
              <i style={{ background: shades[index % shades.length] }} />
            )}
            {name} {formatPercent(share.value)}
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption={label}
        columns={["Name", "Share", "Numerator", "Denominator"]}
        rows={rows.map(({ key, label: name, share }) => ({
          key,
          label: name,
          values: [
            formatPercent(share.value),
            formatCount(share.numerator),
            formatCount(share.denominator),
          ],
        }))}
      />
    </section>
  );
}
