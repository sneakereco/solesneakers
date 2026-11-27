import { AnalyticsPageClient } from "@/Modules/Analytics/Source/Features/Dashboard/AnalyticsPageClient";
import {
  readDashboardLocation,
  reportParams,
} from "@/Modules/Analytics/Source/Features/Dashboard/request-state";
import type { ReportRequest } from "@/Modules/Analytics/Source/Features/ReportContract/types";
import { loadServerReport } from "@/Modules/Analytics/Source/Features/Reporting/report-runtime";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function loadInitialReport(request: ReportRequest) {
  return loadServerReport(request, { deadline: performance.now() + 20_000 });
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      params.append(key, item);
  }
  let initialRequest;
  try {
    initialRequest = readDashboardLocation(params, new Date());
  } catch {
    return <AnalyticsPageClient initialRequest={null} initialReport={null} />;
  }
  const initialReport = await loadInitialReport(initialRequest.request);
  return (
    <AnalyticsPageClient
      key={reportParams(initialRequest, true).toString()}
      initialRequest={initialRequest}
      initialReport={initialReport}
    />
  );
}
