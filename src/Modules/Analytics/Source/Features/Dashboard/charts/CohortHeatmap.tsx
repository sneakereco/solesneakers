import type { CustomerCohort } from "../../ReportContract/types";
import { formatCount, formatPercent } from "../format";

export function CohortHeatmap({ cohorts }: { cohorts: CustomerCohort[] | null }) {
  if (cohorts === null)
    return <p className="analytics-muted">Cohort activity is unavailable.</p>;
  if (!cohorts.length)
    return <p className="analytics-muted">No buyer cohorts in the selected period.</p>;
  const months = [
    ...new Set(
      cohorts.flatMap((cohort) =>
        cohort.repeatPurchases.map((repeat) => repeat.monthsSinceFirstPurchase),
      ),
    ),
  ].sort((a, b) => a - b);

  return (
    <div
      className="analytics-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Buyer cohort heatmap"
    >
      <table className="analytics-table analytics-cohorts">
        <caption className="sr-only">
          Repeat purchase rate by months since first purchase
        </caption>
        <thead>
          <tr>
            <th scope="col">First purchase month</th>
            <th scope="col">Buyers</th>
            {months.map((month) => (
              <th scope="col" key={month}>
                Month {month}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => {
            const byMonth = new Map(
              cohort.repeatPurchases.map(
                ({ monthsSinceFirstPurchase, repeatPurchaseRate }) => [
                  monthsSinceFirstPurchase,
                  repeatPurchaseRate,
                ],
              ),
            );
            return (
              <tr key={cohort.month}>
                <th scope="row">{cohort.month}</th>
                <td>{formatCount(cohort.buyers)}</td>
                {months.map((month) => {
                  const rate = byMonth.get(month);
                  const alpha =
                    rate && rate.value !== null ? 0.04 + rate.value * 0.22 : 0;
                  return (
                    <td
                      key={month}
                      style={{ backgroundColor: `rgba(9, 9, 11, ${alpha})` }}
                    >
                      {rate ? (
                        rate.value === null ? (
                          "Unavailable"
                        ) : (
                          `${formatPercent(rate.value)} (${formatCount(rate.numerator)} / ${formatCount(rate.denominator)})`
                        )
                      ) : (
                        <span aria-label="Not elapsed">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
