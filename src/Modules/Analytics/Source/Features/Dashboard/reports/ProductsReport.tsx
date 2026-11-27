import { useState } from "react";
import type {
  ProductRow,
  ProductsData,
  ReportEnvelope,
  ReportRequest,
} from "../../ReportContract/types";
import { RankedBars } from "../charts/ComparisonCharts";
import { AttributionCoverage } from "../DataCoverage";
import { ReportPanel } from "../ReportPanel";
import { ReportPager, ReportSort } from "../ReportRankingControls";
import {
  changeDashboardLocation,
  type DashboardChange,
  type DashboardLocation,
} from "../request-state";
import { ProductDetailsDrawer } from "./ProductDetailsDrawer";
import {
  ProductDemand,
  ProductInventory,
  ProductRows,
  ProductTaxonomyRows,
} from "./ProductReportSections";

const sortChoices = {
  netMerchandise: "Net product sales",
  units: "Units sold",
  netUnits: "Net units",
  views: "Tracked product views",
  confirmedOrders: "Confirmed orders",
};

const breakdowns = [
  ["categories", "Category"],
  ["brands", "Brand"],
  ["sizes", "Size"],
] as const;
const rankedSections = ["products", "variants", "categories", "brands", "sizes"] as const;

export function ProductsReport({
  report,
  request,
  onRequestChange,
}: {
  report: ReportEnvelope<ProductsData>;
  request: ReportRequest;
  onRequestChange: (change: DashboardChange) => void;
}) {
  const [drawer, setDrawer] = useState<{
    target: ProductRow;
    trigger: HTMLButtonElement;
    location: DashboardLocation;
  } | null>(null);
  const [drawerError, setDrawerError] = useState(false);
  const data = report.data;
  if (!data) return null;
  const { comparison } = data;
  const resultCount = Math.max(
    ...rankedSections.flatMap((key) => [
      data[key]?.totalCount ?? 0,
      comparison?.[key]?.totalCount ?? 0,
    ]),
  );

  function openProduct(target: ProductRow, trigger: HTMLButtonElement) {
    try {
      const location = changeDashboardLocation(
        { request, attribution: "purchase-session" },
        {
          productId: target.productId,
          variantId: target.variantId ?? request.variantId,
          compare: false,
        },
        new Date(),
      );
      setDrawer({ target, trigger, location });
      setDrawerError(false);
    } catch {
      setDrawerError(true);
    }
  }

  return (
    <>
      <ReportPanel
        title="Product sales"
        description="Financial results cover matching original product lines. Product names and taxonomy come from recorded purchase snapshots, including sales of products since removed from the catalog."
      >
        <AttributionCoverage attribution={report.scope.attribution} />
        <ReportSort
          request={request}
          onRequestChange={onRequestChange}
          choices={sortChoices}
        />
        {drawerError && (
          <p className="analytics-alert" role="alert">
            This row has no valid product reference for details.
          </p>
        )}
        <ProductRows
          results={data.products}
          label="Selected product sales"
          onOpen={openProduct}
        />
        {request.compare &&
          (comparison ? (
            <details className="analytics-chart-data">
              <summary>Previous period product sales</summary>
              <ProductRows
                results={comparison.products}
                label="Previous period product sales table"
              />
            </details>
          ) : (
            <p className="analytics-muted">
              Previous period product sales are unavailable.
            </p>
          ))}
      </ReportPanel>
      <ReportPanel
        title="Variant sales"
        description="Sold and net units use matching original variants. Available units reflect current recorded stock."
      >
        <ProductRows
          results={data.variants}
          label="Selected variant sales and current stock"
          variant
          current
          onOpen={openProduct}
        />
        {comparison && (
          <details className="analytics-chart-data">
            <summary>Previous period variant sales</summary>
            <ProductRows
              results={comparison.variants}
              label="Previous period variant sales table"
              variant
            />
          </details>
        )}
      </ReportPanel>
      <div className="analytics-columns">
        {breakdowns.map(([key, dimension]) => (
          <ReportPanel key={key} title={`${dimension} sales`}>
            {data[key]?.rows.length ? (
              <RankedBars
                label={`Net product sales for the first five ${key} on this page`}
                valueLabel="Net product sales (USD)"
                unit="usd"
                rows={data[key].rows.slice(0, 5).map((row) => ({
                  key: row.id ?? row.label,
                  label: row.label,
                  value: row.netMerchandise,
                }))}
              />
            ) : null}
            <ProductTaxonomyRows
              results={data[key]}
              label={`Selected ${dimension.toLowerCase()} sales`}
              dimension={dimension}
            />
            {comparison && (
              <details className="analytics-chart-data">
                <summary>Previous period {dimension.toLowerCase()} sales</summary>
                <ProductTaxonomyRows
                  results={comparison[key]}
                  label={`Previous period ${dimension.toLowerCase()} sales table`}
                  dimension={dimension}
                />
              </details>
            )}
          </ReportPanel>
        ))}
      </div>
      <ReportPager
        request={request}
        onRequestChange={onRequestChange}
        resultCount={resultCount}
      />
      <div className="analytics-columns">
        <ProductInventory inventory={data.inventory} />
        <ProductDemand
          selected={data.unmetDemand}
          previous={request.compare ? (comparison?.unmetDemand ?? null) : undefined}
        />
      </div>
      {drawer && (
        <ProductDetailsDrawer
          target={drawer.target}
          location={drawer.location}
          onClose={() => {
            setDrawer(null);
            drawer.trigger.focus();
          }}
        />
      )}
    </>
  );
}
