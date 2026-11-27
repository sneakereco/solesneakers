import type {
  PaginatedRows,
  ProductBreakdownRow,
  ProductPeriod,
  ProductRow,
  ProductsData,
} from "../../ReportContract/types";
import {
  formatCount,
  formatMoney,
  formatPercent,
  formatStoreTime,
  moneyCoverage,
} from "../format";
import { ReportPanel } from "../ReportPanel";
import { ReportTable } from "../ReportTable";
import { canOpenProduct } from "../report-options";

const salesColumns = ["Confirmed orders", "Units sold", "Net units", "Net product sales"];
const demand = [
  ["stockoutSignals", "Product views with all known sizes out of stock"],
  ["unavailableSizeSelections", "Unavailable size selections"],
  ["variantSelections", "Variant selections"],
  ["searches", "Observed searches"],
  ["searchesWithNoResults", "Searches with no results"],
] as const;

function TableTotal({ results }: { results: PaginatedRows<unknown> | null }) {
  return (
    <p className="analytics-muted">
      {results === null
        ? "This section is unavailable."
        : results.totalCount === 0
          ? "No matching groups in this period."
          : `${formatCount(results.totalCount)} matching ${results.totalCount === 1 ? "group" : "groups"}${results.rows.length ? "" : " · No rows on this page"}`}
    </p>
  );
}

function SalesCells({ row }: { row: ProductRow | ProductBreakdownRow }) {
  return (
    <>
      <td>{formatCount(row.confirmedOrders)}</td>
      <td>{formatCount(row.units)}</td>
      <td>{formatCount(row.netUnits)}</td>
      <td>
        {formatMoney(row.netMerchandise)}
        <small>{moneyCoverage(row.netMerchandise)}</small>
      </td>
    </>
  );
}

export function ProductRows({
  results,
  label,
  variant = false,
  current = false,
  onOpen,
}: {
  results: ProductPeriod["products"];
  label: string;
  variant?: boolean;
  current?: boolean;
  onOpen?: (row: ProductRow, trigger: HTMLButtonElement) => void;
}) {
  return (
    <>
      <TableTotal results={results} />
      {!!results?.rows.length && (
        <ReportTable
          label={label}
          columns={[
            variant ? "Variant" : "Product",
            "Recorded brand",
            "Recorded category",
            ...(variant ? ["Recorded size"] : []),
            ...salesColumns,
            ...(variant
              ? current
                ? ["Current units available"]
                : []
              : ["Tracked views", "View to purchase rate"]),
          ]}
        >
          {results.rows.map((row) => {
            const name = row.size ? `${row.name}, ${row.size.label}` : row.name;
            return (
              <tr key={row.variantId ?? row.productId}>
                <th scope="row">
                  {onOpen && canOpenProduct(row) ? (
                    <button
                      type="button"
                      className="analytics-product-link"
                      aria-haspopup="dialog"
                      aria-label={`View ${name} details`}
                      onClick={(event) => onOpen(row, event.currentTarget)}
                    >
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                </th>
                <td>{row.brand?.label ?? "Unknown"}</td>
                <td>{row.category?.label ?? "Unknown"}</td>
                {variant && <td>{row.size?.label ?? "Unknown"}</td>}
                <SalesCells row={row} />
                {variant ? (
                  current && <td>{formatCount(row.availableUnits)}</td>
                ) : (
                  <>
                    <td>{formatCount(row.views)}</td>
                    <td>{formatPercent(row.viewToPurchase.value)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </ReportTable>
      )}
    </>
  );
}

export function ProductTaxonomyRows({
  results,
  label,
  dimension,
}: {
  results: PaginatedRows<ProductBreakdownRow> | null;
  label: string;
  dimension: string;
}) {
  return (
    <>
      <TableTotal results={results} />
      {!!results?.rows.length && (
        <ReportTable label={label} columns={[dimension, ...salesColumns]}>
          {results.rows.map((row) => (
            <tr key={row.id ?? row.label}>
              <th scope="row">{row.label}</th>
              <SalesCells row={row} />
            </tr>
          ))}
        </ReportTable>
      )}
    </>
  );
}

export function ProductInventory({
  inventory,
}: {
  inventory: ProductsData["inventory"];
}) {
  const instant = inventory?.asOf;
  const stockTime =
    instant &&
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(instant) &&
    Number.isFinite(Date.parse(instant))
      ? instant
      : null;
  return (
    <ReportPanel
      title="Current recorded inventory"
      description="Latest stock observations for matching recorded variants. Stock is independent of the calendar, comparison, and shopper or order filters."
    >
      {inventory ? (
        <>
          <dl className="analytics-breakdown">
            <div>
              <dt>Recorded variants</dt>
              <dd>{formatCount(inventory.recordedVariants)}</dd>
            </div>
            <div>
              <dt>Variants with unknown stock</dt>
              <dd>{formatCount(inventory.missingStockVariants)}</dd>
            </div>
            <div>
              <dt>Catalog-wide variant count</dt>
              <dd>{formatCount(inventory.catalogVariants)}</dd>
            </div>
            <div>
              <dt>Units available across recorded variants</dt>
              <dd>{formatCount(inventory.availableUnits)}</dd>
            </div>
            <div>
              <dt>Recorded variants in stock</dt>
              <dd>{formatCount(inventory.inStockVariants)}</dd>
            </div>
            <div>
              <dt>Recorded variants out of stock</dt>
              <dd>{formatCount(inventory.outOfStockVariants)}</dd>
            </div>
          </dl>
          {instant && (
            <p className="analytics-muted">
              Latest stock observation{" "}
              {stockTime ? (
                <time dateTime={stockTime}>{formatStoreTime(stockTime)}</time>
              ) : (
                "time unavailable"
              )}
            </p>
          )}
        </>
      ) : (
        <p className="analytics-muted">Current recorded inventory is unavailable.</p>
      )}
    </ReportPanel>
  );
}

export function ProductDemand({
  selected,
  previous,
  row,
}: {
  selected: ProductPeriod["unmetDemand"];
  previous?: ProductPeriod["unmetDemand"];
  row?: ProductRow;
}) {
  const demandLabels = row
    ? [
        ...demand
          .slice(0, 3)
          .map(([key, label]) => [label, selected?.[key] ?? null, undefined] as const),
        ["Persisted cart additions", row.successfulAdditions, undefined] as const,
      ]
    : demand.map(
        ([key, label]) =>
          [
            label,
            selected?.[key] ?? null,
            previous === undefined ? undefined : (previous?.[key] ?? null),
          ] as const,
      );
  return (
    <ReportPanel
      title="Observed demand signals"
      description="Counts of recorded shopping activity, including recognized searches and stock availability signals."
    >
      {selected || row ? (
        <dl className="analytics-breakdown">
          {demandLabels.map(([label, value, prior]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {formatCount(value)}
                {prior !== undefined && (
                  <small>Previous period · {formatCount(prior)}</small>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="analytics-muted">Demand signals are unavailable.</p>
      )}
      {!selected && previous && (
        <dl className="analytics-breakdown">
          {demand.map(([key, label]) => (
            <div key={key}>
              <dt>Previous period · {label}</dt>
              <dd>{formatCount(previous[key])}</dd>
            </div>
          ))}
        </dl>
      )}
    </ReportPanel>
  );
}
