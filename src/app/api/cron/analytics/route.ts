import { getCronSecret, isAuthorizedCronRequest } from "@/lib/http/cron-auth";
import { runAnalyticsDrain } from "@/Modules/Analytics/Source/Features/EventDelivery/delivery-runtime";
import { logError } from "@/lib/utils/log";

export const runtime = "nodejs";
export const maxDuration = 15;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedCronRequest(request, getCronSecret()))
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    const result = await runAnalyticsDrain();
    return Response.json(result, {
      status: result.failed || result.deferred ? 503 : 200,
      headers,
    });
  } catch (error) {
    logError(error, {
      layer: "job",
      route: "/api/cron/analytics",
      phase: "analytics_drain",
    });
    return Response.json(
      { error: "Analytics delivery unavailable" },
      { status: 503, headers },
    );
  }
}
