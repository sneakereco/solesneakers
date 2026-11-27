import type { ReportDataMap, ReportEnvelope, ReportId } from "../ReportContract/types";
import { reportParams, type DashboardLocation } from "./request-state";

export type DashboardReport = ReportEnvelope<ReportDataMap[ReportId]>;

export class DashboardRequestError extends Error {}

const reportFailure = "Analytics reporting is temporarily unavailable.";
const exportFailure = "This report could not be exported.";
const reportStates = new Set(["ready", "empty", "stale", "unavailable", "unconfigured"]);

async function request(location: DashboardLocation, signal: AbortSignal, csv = false) {
  const endpoint = `/api/admin/analytics/${location.request.report}${csv ? "/export" : ""}`;
  const response = await fetch(`${endpoint}?${reportParams(location)}`, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
    redirect: "manual",
  });
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (
    response.redirected ||
    response.type === "opaqueredirect" ||
    [401, 403].includes(response.status) ||
    (response.ok && type === "text/html")
  ) {
    throw new DashboardRequestError(
      `Admin access is required to ${csv ? "export" : "view"} this report.`,
    );
  }
  if (csv && response.status === 422 && type === "application/json") {
    const result: { error?: unknown } = await response.json();
    if (typeof result?.error === "string") throw new DashboardRequestError(result.error);
  }
  if (!response.ok || type !== (csv ? "text/csv" : "application/json")) {
    throw new DashboardRequestError(csv ? exportFailure : reportFailure);
  }
  return response;
}

export async function requestReport(
  location: DashboardLocation,
  signal: AbortSignal,
): Promise<DashboardReport> {
  const response = await request(location, signal);
  const result: DashboardReport = await response.json();
  const range = location.request.range;
  if (
    !result ||
    !reportStates.has(result.state) ||
    !Array.isArray(result.coverage) ||
    result.range?.from !== range.from ||
    result.range.to !== range.to ||
    result.range.timezone !== range.timezone ||
    (result.state === "unavailable" || result.state === "unconfigured"
      ? result.data !== null
      : !result.data)
  ) {
    throw new DashboardRequestError(reportFailure);
  }
  return result;
}

export async function requestCsv(location: DashboardLocation, signal: AbortSignal) {
  const response = await request(location, signal, true);
  const { range, report } = location.request;
  return {
    blob: await response.blob(),
    filename: `sole-${report}-${range.from}-${range.to}.csv`,
  };
}
