"use client";

import { Download } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  REPORT_IDS,
  type AcquisitionData,
  type CustomersData,
  type HealthData,
  type OverviewData,
  type PaymentsData,
  type ProductsData,
  type ReportEnvelope,
  type SalesData,
} from "../ReportContract/types";
import { DataCoverage } from "./DataCoverage";
import {
  DashboardRequestError,
  requestCsv,
  requestReport,
  type DashboardReport,
} from "./report-client";
import { ReportFilters } from "./ReportFilters";
import { ReportSkeleton } from "./ReportSkeleton";
import { AcquisitionReport } from "./reports/AcquisitionReport";
import { CheckoutHealthReport } from "./reports/CheckoutHealthReport";
import { CustomersReport } from "./reports/CustomersReport";
import { OverviewReport } from "./reports/OverviewReport";
import { PaymentsReport } from "./reports/PaymentsReport";
import { ProductsReport } from "./reports/ProductsReport";
import { SalesReport } from "./reports/SalesReport";
import { acquisitionOptions, productOptions } from "./report-options";
import {
  changeDashboardLocation,
  createRequestGuard,
  readDashboardLocation,
  reportNames,
  reportParams,
  type DashboardChange,
  type DashboardLocation,
} from "./request-state";

const invalidLocation =
  "These analytics filters are invalid. Reset the filters to continue.";
const reportFailure = "Analytics reporting is temporarily unavailable.";

type ReportViewState =
  | { status: "result"; report: DashboardReport }
  | { status: "updating" }
  | { status: "error"; message: string };

function ReportContent({
  location,
  report,
  onRequestChange,
}: {
  location: DashboardLocation;
  report: DashboardReport;
  onRequestChange: (change: DashboardChange) => void;
}) {
  if (!report.data) return null;
  const { request, attribution } = location;
  const id = request.report;
  switch (id) {
    case "overview":
      return <OverviewReport report={report as ReportEnvelope<OverviewData>} />;
    case "sales":
      return (
        <SalesReport
          report={report as ReportEnvelope<SalesData>}
          onRequestChange={onRequestChange}
        />
      );
    case "customers":
      return (
        <CustomersReport
          report={report as ReportEnvelope<CustomersData>}
          request={request}
          onRequestChange={onRequestChange}
        />
      );
    case "acquisition":
      return (
        <AcquisitionReport
          report={report as ReportEnvelope<AcquisitionData>}
          request={request}
          attribution={attribution}
          onRequestChange={onRequestChange}
        />
      );
    case "products":
      return (
        <ProductsReport
          report={report as ReportEnvelope<ProductsData>}
          request={request}
          onRequestChange={onRequestChange}
        />
      );
    case "payments":
      return (
        <PaymentsReport
          report={report as ReportEnvelope<PaymentsData>}
          request={request}
          onRequestChange={onRequestChange}
        />
      );
    case "health":
      return (
        <CheckoutHealthReport
          report={report as ReportEnvelope<HealthData>}
          request={request}
          onRequestChange={onRequestChange}
        />
      );
  }
}

export function AnalyticsPageClient({
  initialRequest,
  initialReport,
}: {
  initialRequest: DashboardLocation | null;
  initialReport: DashboardReport | null;
}) {
  const [location, setLocation] = useState(initialRequest);
  const latestLocation = useRef(initialRequest);
  const [view, setView] = useState<ReportViewState>(() =>
    initialReport
      ? { status: "result", report: initialReport }
      : { status: "error", message: initialRequest ? reportFailure : invalidLocation },
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reportGuard] = useState(createRequestGuard);
  const [exportGuard] = useState(createRequestGuard);

  function selectLocation(next: DashboardLocation | null, force = false) {
    const previous = latestLocation.current;
    latestLocation.current = next;
    setLocation(next);
    setValidationError(null);
    if (
      !force &&
      next &&
      previous &&
      reportParams(previous).toString() === reportParams(next).toString()
    )
      return;

    exportGuard.cancel();
    setExportError(null);
    setExporting(false);
    if (!next) {
      reportGuard.cancel();
      setView({ status: "error", message: invalidLocation });
      return;
    }

    setView({ status: "updating" });
    const { signal, isCurrent } = reportGuard.start();
    void requestReport(next, signal).then(
      (report) => {
        if (isCurrent()) setView({ status: "result", report });
      },
      (error: unknown) => {
        if (isCurrent())
          setView({
            status: "error",
            message:
              error instanceof DashboardRequestError ? error.message : reportFailure,
          });
      },
    );
  }

  const restoreLocation = useEffectEvent(() => {
    if (window.location.pathname !== "/admin/analytics") return;
    try {
      selectLocation(
        readDashboardLocation(new URLSearchParams(window.location.search), new Date()),
      );
    } catch {
      selectLocation(null);
    }
  });
  useEffect(() => {
    const restore = () => restoreLocation();
    if (initialRequest && window.location.pathname === "/admin/analytics") {
      const normalized = `?${reportParams(initialRequest, true)}`;
      if (window.location.search !== normalized)
        window.history.replaceState(null, "", normalized);
    }
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      reportGuard.cancel();
      exportGuard.cancel();
    };
  }, [initialRequest, reportGuard, exportGuard]);

  function changeRequest(change: DashboardChange) {
    const current = latestLocation.current;
    if (!current) return;
    try {
      const next = changeDashboardLocation(current, change, new Date());
      const params = reportParams(next, true).toString();
      if (params !== reportParams(current, true).toString())
        window.history.pushState(null, "", `?${params}`);
      selectLocation(next);
    } catch (error) {
      setValidationError(error instanceof RangeError ? error.message : invalidLocation);
    }
  }

  function retry() {
    if (latestLocation.current) selectLocation(latestLocation.current, true);
    else {
      const defaults = readDashboardLocation(new URLSearchParams(), new Date());
      window.history.pushState(null, "", "/admin/analytics");
      selectLocation(defaults, true);
    }
  }

  async function downloadCsv() {
    const current = latestLocation.current;
    if (!current) return;
    setExportError(null);
    setExporting(true);
    const { signal, isCurrent } = exportGuard.start();
    try {
      const { blob, filename } = await requestCsv(current, signal);
      if (!isCurrent()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (isCurrent())
        setExportError(
          error instanceof DashboardRequestError
            ? error.message
            : "This report could not be exported.",
        );
    } finally {
      if (isCurrent()) setExporting(false);
    }
  }

  const request = location?.request;
  const report = view.status === "result" ? view.report : null;
  const sources =
    report?.data && "leadingSources" in report.data
      ? report.data.leadingSources
      : undefined;
  const data = report?.data;
  const reportedOptions =
    data && "discovery" in data
      ? acquisitionOptions(
          location?.attribution === "discovery" ? data.discovery : data.purchaseSession,
        )
      : data && "inventory" in data
        ? productOptions(data)
        : undefined;
  const alternateAcquisitionView =
    location?.attribution === "discovery" ? "purchaseSession" : "discovery";
  const coverage =
    request?.report === "acquisition" && report?.data
      ? report?.coverage.filter(
          ({ metric }) =>
            metric !== alternateAcquisitionView &&
            metric !== `comparison.${alternateAcquisitionView}`,
        )
      : report?.coverage;

  return (
    <div data-admin-page className="analytics-page">
      <div data-admin-page-header className="analytics-page-heading">
        <h1>Analytics</h1>
        <button
          type="button"
          className="admin-button-secondary"
          disabled={exporting || !report?.data}
          onClick={() => {
            void downloadCsv();
          }}
        >
          <Download size={15} aria-hidden="true" />{" "}
          {exporting ? "Exporting CSV" : "Export CSV"}
        </button>
      </div>
      {request && (
        <>
          <ReportFilters
            request={request}
            onChange={changeRequest}
            sources={sources}
            reportedOptions={reportedOptions}
          />
          <nav
            data-admin-tabs
            className="analytics-report-nav"
            aria-label="Analytics reports"
          >
            {REPORT_IDS.map((id) => (
              <button
                type="button"
                key={id}
                aria-pressed={request.report === id}
                onClick={() => {
                  if (request.report !== id) changeRequest({ report: id });
                }}
              >
                {reportNames[id]}
              </button>
            ))}
          </nav>
        </>
      )}
      {(validationError || exportError) && (
        <p className="analytics-alert" role="alert">
          {validationError ?? exportError}
        </p>
      )}
      {view.status === "updating" && <ReportSkeleton updating />}
      {view.status === "error" && (
        <div className="analytics-alert" role="alert">
          <p>{view.message}</p>
          <button type="button" className="admin-button-secondary" onClick={retry}>
            {request ? "Retry report" : "Reset filters"}
          </button>
        </div>
      )}
      {report && (
        <>
          <DataCoverage
            coverage={coverage ?? []}
            state={report.state}
            asOf={report.asOf}
            ingestionAsOf={report.ingestionAsOf}
            behaviorThrough={report.behaviorThrough}
            datasetStartedAt={report.datasetStartedAt}
            partial={report.range.partial}
            emptyMessage={
              request?.report === "payments"
                ? "No payment method activity recorded for the selected period."
                : undefined
            }
          />
          {location && (
            <ReportContent
              location={location}
              report={report}
              onRequestChange={changeRequest}
            />
          )}
          {report.state === "unavailable" && (
            <button type="button" className="admin-button-secondary" onClick={retry}>
              Retry report
            </button>
          )}
        </>
      )}
    </div>
  );
}
