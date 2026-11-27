import "server-only";

import { AuthError, requireAdminApi } from "@/lib/auth/session";
import { MAX_REPORT_PAGE_SIZE, parseReportRequest } from "../ReportContract/filters";
import { REPORT_IDS, type ReportRequest } from "../ReportContract/types";
import { exportAnalyticsCsv, ExportScopeError } from "./csv-export";
import { loadServerReport } from "./report-runtime";
import { CSV_AXIS_LIMIT, CSV_EXECUTION } from "./query-contract";

const privateHeaders = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ report: string }> };
const errorResponse = (error: string, status: number) =>
  Response.json({ error }, { status, headers: privateHeaders });

export async function serveReport(req: Request, ctx: Context, format: "json" | "csv") {
  try {
    await requireAdminApi();
    const deadline = performance.now() + 20000;
    const { report } = await ctx.params;
    if (!REPORT_IDS.some((id) => id === report))
      return errorResponse("Unknown analytics report.", 404);
    let request: ReportRequest;
    try {
      const params = new URL(req.url).searchParams;
      if (params.has("report") && params.get("report") !== report)
        return errorResponse("Conflicting analytics report.", 400);
      if (!params.has("report")) params.set("report", report);
      request = parseReportRequest(params, new Date());
    } catch (error) {
      // The parser supplies fixed range/bucket guidance. Never echo URL values.
      return errorResponse(
        error instanceof RangeError ? error.message : "Invalid report parameters.",
        400,
      );
    }
    if (format === "csv")
      request = {
        ...request,
        page: 1,
        pageSize:
          request.report === "products" || request.report === "acquisition"
            ? CSV_AXIS_LIMIT
            : MAX_REPORT_PAGE_SIZE,
      };
    const envelope = await loadServerReport(request, {
      deadline,
      mode: format === "csv" ? CSV_EXECUTION : undefined,
    });
    if (format === "json") return Response.json(envelope, { headers: privateHeaders });
    if (!envelope.data)
      return Response.json(envelope, { headers: privateHeaders, status: 503 });
    const { body, filename } = exportAnalyticsCsv(envelope, request);
    return new Response(body, {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthError)
      return errorResponse(
        error.status === 403 ? "Forbidden" : "Unauthorized",
        error.status === 403 ? 403 : 401,
      );
    if (error instanceof ExportScopeError) return errorResponse(error.message, 422);
    return errorResponse("Analytics reporting is temporarily unavailable.", 503);
  }
}
