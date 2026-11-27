import { recordWorkerHeartbeat } from "@/Modules/Checkout/Source/Features/Operations/health-snapshot";
import type { NextRequest } from "next/server";

import { createCheckoutMailDrainDependencies } from "@/lib/checkout/checkout-notification-dependencies";
import { recoverySettings } from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import { drainNotifications } from "@/Modules/Checkout/Source/Features/Recovery/notification-drain";
import { getCronSecret, isAuthorizedCronRequest } from "@/lib/http/cron-auth";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);
  if (!isAuthorizedCronRequest(request, getCronSecret())) {
    return Response.json(
      { error: "Unauthorized", requestId },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const db = createSupabaseAdminClient();
    const result = await drainNotifications(
      recoverySettings,
      createCheckoutMailDrainDependencies(db),
    );
    await recordWorkerHeartbeat(db, "mail");
    return Response.json(
      { ...result, requestId },
      {
        status: result.failed > 0 ? 500 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/cron/checkout-notifications",
      event: "checkout_notification_job_failed",
    });
    return Response.json(
      { error: "Checkout notifications failed", requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
