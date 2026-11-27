import { serveReport } from "@/Modules/Analytics/Source/Features/Reporting/report-http";

export async function GET(
  request: Request,
  context: { params: Promise<{ report: string }> },
) {
  return serveReport(request, context, "csv");
}
