import { AuthError, requireAdminApi } from "@/lib/auth/session";
import { parseReportRequest } from "@/Modules/Analytics/Source/Features/ReportContract/filters";
import { loadServerReport } from "@/Modules/Analytics/Source/Features/Reporting/report-runtime";

const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    await requireAdminApi();
    const request = parseReportRequest(
      new URLSearchParams({ report: "sales", compare: "false" }),
      new Date(),
    );
    const report = await loadServerReport(request, {
      deadline: performance.now() + 20000,
    });
    const sales =
      report.data && "netMerchandise" in report.data && "confirmedOrders" in report.data
        ? report.data
        : null;
    return Response.json(
      {
        state: report.state,
        ingestionAsOf: report.ingestionAsOf,
        netMerchandise: sales?.netMerchandise ?? null,
        confirmedOrders: sales?.confirmedOrders ?? null,
      },
      { headers },
    );
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    return Response.json({ error: "Dashboard summary unavailable" }, { status, headers });
  }
}
