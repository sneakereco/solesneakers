import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  ProductRow,
  ProductsData,
  ReportEnvelope,
} from "../../ReportContract/types";
import { DataCoverage } from "../DataCoverage";
import { formatCount, formatMoney, moneyCoverage } from "../format";
import { DashboardRequestError, requestReport } from "../report-client";
import { ReportPanel } from "../ReportPanel";
import { createRequestGuard, type DashboardLocation } from "../request-state";
import { ProductDemand, ProductInventory, ProductRows } from "./ProductReportSections";

type DrawerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      report: ReportEnvelope<ProductsData>;
    };

const failure = "Product details are temporarily unavailable.";

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
  const [guard] = useState(createRequestGuard);
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
        const report = await requestReport(location, signal);
        if (!isCurrent()) return;
        const { productId, variantId } = location.request;
        if (
          report.scope.filters.productId !== productId ||
          report.scope.filters.variantId !== variantId ||
          (report.data && !("inventory" in report.data))
        )
          throw new DashboardRequestError(failure);
        setState({ status: "ready", report: report as ReportEnvelope<ProductsData> });
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
  }, [guard, location, retry]);

  const report = state.status === "ready" ? state.report : null;
  const data = report?.data;
  const row = target.variantId
    ? data?.variants?.rows.find((candidate) => candidate.variantId === target.variantId)
    : data?.products?.rows.find((candidate) => candidate.productId === target.productId);
  const title = target.size ? `${target.name} · ${target.size.label}` : target.name;
  const canRetry = state.status === "error" || report?.state === "unavailable";

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
          <p>Product details for the selected dates</p>
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
      {report && <DataCoverage {...report} />}
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
        <>
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
              <p className="analytics-muted">
                Purchase snapshot details are unavailable.
              </p>
            )}
          </ReportPanel>
          {!target.variantId && (
            <ReportPanel
              title="Variant purchase snapshots"
              description="Sales use the original brand, category, and size recorded on each matching line."
            >
              <ProductRows
                results={data.variants}
                label="Scoped variant sales and current stock"
                variant
                current
              />
            </ReportPanel>
          )}
          <ProductInventory inventory={data.inventory} />
          <ProductDemand selected={data.unmetDemand} row={row} />
        </>
      )}
    </dialog>
  );
}
