import type { FunnelStep, Rate } from "../../ReportContract/types";
import { formatCount, formatPercent } from "../format";
import { ChartDataTable } from "./ChartDataTable";

const stepsLabels = {
  session: "Tracked sessions",
  "product-view": "Viewed product",
  "cart-addition": "Added to cart",
  checkout: "Started checkout",
  purchase: "Purchased",
} satisfies Record<FunnelStep["step"], string>;

function formatRate(rate: Rate) {
  return rate.value === null
    ? "Unavailable"
    : `${formatPercent(rate.value)} (${formatCount(rate.numerator)} / ${formatCount(rate.denominator)})`;
}

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  if (!steps.length) return <p className="analytics-muted">No funnel steps available.</p>;
  return (
    <section aria-label="Shopping funnel">
      <ol className="analytics-bars" aria-hidden="true">
        {steps.map(({ step, sessions, fromStart }) => (
          <li key={step}>
            <span>{stepsLabels[step]}</span>
            <span className="analytics-bar-track">
              {fromStart.value !== null && (
                <i style={{ width: `${fromStart.value * 100}%` }} />
              )}
            </span>
            <strong>{formatCount(sessions)}</strong>
          </li>
        ))}
      </ol>
      <ChartDataTable
        caption="Same-session funnel counts and rates"
        columns={[
          "Step",
          "Sessions",
          "Share of starting sessions",
          "Share of previous step",
        ]}
        rows={steps.map(({ step, sessions, fromStart, fromPrevious }) => ({
          key: step,
          label: stepsLabels[step],
          values: [
            formatCount(sessions),
            formatRate(fromStart),
            formatRate(fromPrevious),
          ],
        }))}
      />
    </section>
  );
}
