import { observeCheckoutRequest } from "@/Modules/Checkout/Source/Features/Operations/request-metrics";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { NextResponse } from "next/server";
import {
  normalizeSquareReceipt,
  readSquareWebhookBody,
  SquareReceiptError,
  SquareWebhookInbox,
} from "@/Modules/Checkout/Source/Features/Payments/webhook-inbox";
import { getSquareConfig, getSquareMerchantId } from "@/lib/square/config";
import { promptSquareReceipt } from "@/lib/square/financial-inquiry-dependencies";
import { verifySquareWebhookSignature } from "@/lib/square/webhook";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
const headers = { "Cache-Control": "no-store" };
export function POST(request: Request) {
  return observeCheckoutRequest(
    "/api/webhooks/square",
    "POST",
    getRequestIdFromHeaders(request.headers),
    () => receive(request),
  );
}
async function receive(request: Request) {
  try {
    const rawBody = await readSquareWebhookBody(request);
    const config = getSquareConfig();
    if (
      !(await verifySquareWebhookSignature({
        rawBody,
        signature: request.headers.get("x-square-hmacsha256-signature") ?? "",
        signatureKey: config.webhookSignatureKey,
        notificationUrl: config.webhookNotificationUrl,
      }))
    )
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401, headers },
      );
    const receipt = normalizeSquareReceipt(
      rawBody,
      getSquareMerchantId(),
      config.locationId,
    );
    if (receipt) {
      const db = createSupabaseAdminClient();
      const stored = await new SquareWebhookInbox(db).receiveSquareEvent(receipt);
      if (stored === "stored") promptSquareReceipt(db, receipt.eventId);
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    const status = error instanceof SquareReceiptError ? error.status : 503;
    return NextResponse.json(
      { error: status === 503 ? "Webhook receipt unavailable" : "Invalid webhook event" },
      { status, headers },
    );
  }
}
