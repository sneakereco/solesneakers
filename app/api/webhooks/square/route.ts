import { NextResponse } from "next/server";

import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { getSquareConfig } from "@/lib/square/config";
import { SquarePaymentEventProcessor } from "@/lib/square/payment-event";
import {
  createSquareShippingSyncDependencies,
  synchronizeSquareShippingAddress,
} from "@/lib/square/shipping-address-sync";
import { verifySquareWebhookSignature } from "@/lib/square/webhook";
import { log, logError } from "@/lib/utils/log";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-square-hmacsha256-signature") ?? "";
    const config = getSquareConfig();
    const signatureValid = await verifySquareWebhookSignature({
      rawBody,
      signature,
      signatureKey: config.webhookSignatureKey,
      notificationUrl: config.webhookNotificationUrl,
    });

    if (!signatureValid) {
      log({
        level: "warn",
        layer: "api",
        route: "/api/webhooks/square",
        requestId,
        event: "square_webhook_invalid_signature",
        message: "square_webhook_invalid_signature",
        status: 401,
      });
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const supabase = createSupabaseAdminClient();
    const processor = new SquarePaymentEventProcessor(supabase, config.locationId);
    const result = await processor.process(rawBody);
    await synchronizeSquareShippingAddress(
      result,
      createSquareShippingSyncDependencies(supabase),
    );

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    logError(error, {
      layer: "api",
      route: "/api/webhooks/square",
      requestId,
      event: "square_webhook_processing_failed",
    });

    const invalidEvent =
      error instanceof Error && error.message === "square_webhook_invalid_event";
    return NextResponse.json(
      { error: invalidEvent ? "Invalid webhook event" : "Webhook processing failed" },
      { status: invalidEvent ? 400 : 500, headers: NO_STORE_HEADERS },
    );
  }
}
