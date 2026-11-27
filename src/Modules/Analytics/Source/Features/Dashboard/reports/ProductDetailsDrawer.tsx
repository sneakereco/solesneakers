import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  ProductRow,
  ProductsData,
  ReportEnvelope,
} from "../../ReportContract/types";
import { AttributionCoverage, DataCoverage } from "../DataCoverage";
import { formatCalendarRange, formatCount, formatMoney, moneyCoverage } from "../format";
import { DashboardRequestError, requestReport } from "../report-client";
import { ReportPanel } from "../ReportPanel";
import { ReportPager } from "../ReportRankingControls";
import {
  changeDashboardLocation,
  createRequestGuard,
  type DashboardLocation,
} from "../request-state";
import { ProductDemand, ProductInventory, ProductRows } from "./ProductReportSections";

type DrawerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      report: ReportEnvelope<ProductsData>;
    };

const failure = "Product details are temporarily unavailable.";

function ScopedCoverage({ report }: { report: ReportEnvelope<ProductsData> }) {
  return (
    <>
      <DataCoverage {...report} partial={report.range.partial} />
      <AttributionCoverage attribution={report.scope.attribution} />
    </>
  );
}

export function ProductDetailsDrawer({
  target,
  location,
  onClose,
}: {
  target: ProductRow;
  location: DashboardLocation;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pager = useRef<HTMLElement>(null);
  const [guard] = useState(createRequestGuard);
  const [activeLocation, setActiveLocation] = useState(location);
  const [firstPage, setFirstPage] = useState<ReportEnvelope<ProductsData> | null>(null);
  const [variantTotal, setVariantTotal] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<DrawerState>({ status: "loading" });

  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    close.current?.focus();
  }, []);

  useEffect(() => {
    const { signal, isCurrent } = guard.start();
    async function load() {
      try {
        const report = await requestReport(activeLocation, signal);
        if (!isCurrent()) return;
        const { productId, variantId, page, pageSize } = activeLocation.request;
        if (
          report.scope.filters.productId !== productId ||
          report.scope.filters.variantId !== variantId ||
          (report.data && !("inventory" in report.data))
        )
          throw new DashboardRequestError(failure);
        const scopedReport = report as ReportEnvelope<ProductsData>;
        const variants = scopedReport.data?.variants;
        if (variants && (variants.page !== page || variants.pageSize !== pageSize))
          throw new DashboardRequestError(failure);
        if (variants) setVariantTotal(variants.totalCount);
        if (!target.variantId && page === 1) setFirstPage(scopedReport);
        setState({ status: "ready", report: scopedReport });
      } catch (error) {
        if (isCurrent())
          setState({
            status: "error",
            message: error instanceof DashboardRequestError ? error.message : failure,
          });
      }
    }
    void load();
    return guard.cancel;
  }, [activeLocation, guard, retry, target.variantId]);

  const report = state.status === "ready" ? state.report : null;
  const summaryReport = target.variantId ? report : firstPage;
  const data = summaryReport?.data;
  const range = (summaryReport ?? report)?.range ?? activeLocation.request.range;
  const row = target.variantId
    ? data?.variants?.rows.find((candidate) => candidate.variantId === target.variantId)
    : data?.products?.rows.find((candidate) => candidate.productId === target.productId);
  const title = target.size ? `${target.name} · ${target.size.label}` : target.name;
  const canRetry = state.status === "error" || report?.state === "unavailable";

  function selectVariantPage(page: number | undefined) {
    if (page === undefined) return;
    const next = changeDashboardLocation(activeLocation, { page }, new Date());
    guard.cancel();
    pager.current?.focus();
    setState({ status: "loading" });
    setActiveLocation(next);
  }

  return (
    <dialog
      ref={dialog}
      className="analytics-product-drawer"
      aria-labelledby={id}
      onClose={() => {
        guard.cancel();
        onClose();
      }}
    >
      <div className="analytics-calendar-heading">
        <div>
          <h2 id={id}>{title}</h2>
          <p>{formatCalendarRange(range.from, range.to)} · Eastern Time</p>
        </div>
        <button
          ref={close}
          type="button"
          className="analytics-close"
          aria-label="Close product details"
          onClick={() => dialog.current?.close()}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      {state.status === "loading" && <p role="status">Loading product details…</p>}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      {summaryReport && (
        <div className="analytics-drawer-coverage">
          {summaryReport !== report && (
            <p className="analytics-muted">Product summary from the first scoped page</p>
          )}
          <ScopedCoverage report={summaryReport} />
          <p className="analytics-muted">
            Financial results cover matching original product lines
            {summaryReport.scope.attribution.orderScope === "filtered-orders"
              ? " from orders attributable to the selected device or acquisition segment."
              : "."}
          </p>
        </div>
      )}
      {canRetry && (
        <button
          type="button"
          className="admin-button-secondary"
          onClick={() => {
            setState({ status: "loading" });
            setRetry(retry + 1);
            close.current?.focus();
          }}
        >
          Retry product details
        </button>
      )}
      {data && (
        <ReportPanel
          title={
            target.variantId ? "Variant purchase snapshot" : "Product purchase snapshot"
          }
        >
          {row ? (
            <dl className="analytics-breakdown">
              <div>
                <dt>Recorded brand</dt>
                <dd>{row.brand?.label ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Recorded category</dt>
                <dd>{row.category?.label ?? "Unknown"}</dd>
              </div>
              {target.variantId && (
                <div>
                  <dt>Recorded size</dt>
                  <dd>{row.size?.label ?? "Unknown"}</dd>
                </div>
              )}
              <div>
                <dt>Units sold</dt>
                <dd>{formatCount(row.units)}</dd>
              </div>
              <div>
                <dt>Net units</dt>
                <dd>{formatCount(row.netUnits)}</dd>
              </div>
              <div>
                <dt>Net product sales</dt>
                <dd>
                  {formatMoney(row.netMerchandise)}
                  <small>{moneyCoverage(row.netMerchandise)}</small>
                </dd>
              </div>
              {target.variantId && (
                <div>
                  <dt>Current units available</dt>
                  <dd>{formatCount(row.availableUnits)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="analytics-muted">Purchase snapshot details are unavailable.</p>
          )}
        </ReportPanel>
      )}
      {!target.variantId && (Boolean(data) || variantTotal > 0) && (
        <ReportPanel
          title="Variant purchase snapshots"
          description="Sales use the original brand, category, and size recorded on each matching line."
        >
          {report && report !== summaryReport && (
            <div className="analytics-drawer-coverage">
              <p className="analytics-muted">Variant page coverage</p>
              <ScopedCoverage report={report} />
            </div>
          )}
          {report?.data && (
            <ProductRows
              results={report.data.variants}
              label="Scoped variant sales and current stock"
              variant
              current
            />
          )}
          <ReportPager
            label="Scoped variant pages"
            focusRef={pager}
            request={activeLocation.request}
            resultCount={variantTotal}
            onRequestChange={({ page }) => selectVariantPage(page)}
          />
        </ReportPanel>
      )}
      {data && (
        <>
          <ProductInventory inventory={data.inventory} />
          <ProductDemand selected={data.unmetDemand} row={row} />
        </>
      )}
    </dialog>
  );
}
