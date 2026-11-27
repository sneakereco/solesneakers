import { recordWorkerHeartbeat } from "@/Modules/Checkout/Source/Features/Operations/health-snapshot";
import { scheduleAnalyticsDrain } from "@/Modules/Analytics/Source/Features/EventDelivery/delivery-runtime";
import type { NextRequest } from "next/server";

import {
  runCheckoutRecovery,
  recoverySettings,
} from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import { createCheckoutRecoveryDependencies } from "@/lib/checkout/expire-checkout-reservations";
import { getCronSecret, isAuthorizedCronRequest } from "@/lib/http/cron-auth";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { logError } from "@/lib/utils/log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    if (!isAuthorizedCronRequest(request, getCronSecret())) {
      return Response.json(
        { error: "Unauthorized", requestId },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const db = createSupabaseAdminClient();
    const result = await runCheckoutRecovery(
      recoverySettings,
      createCheckoutRecoveryDependencies(db),
    );
    if (result.done > 0) scheduleAnalyticsDrain();
    await recordWorkerHeartbeat(db, "recovery");
    return Response.json(
      { ...result, requestId },
      {
        status: result.retry > 0 || result.review > 0 ? 500 : 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: "/api/cron/expire-checkouts",
      event: "checkout_expiration_job_failed",
    });
    return Response.json(
      { error: "Checkout expiration failed", requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
