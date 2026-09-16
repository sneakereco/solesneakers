// app/api/webhooks/shippo/route.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "@/config/env";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { extractShippoTrackingUpdate } from "@/lib/shippo/webhook";
import { log, logError } from "@/lib/utils/log";
import { SHIPPO_TRACKING_STATUS_MAP } from "@/config/constants/shipping";
import {
  shippoWebhookEventSchema,
  shippoWebhookQuerySchema,
} from "@/lib/validation/webhooks";
import type { Database } from "@/types/db/database.types";

type RecordTrackingUpdateArgs = Omit<
  Database["public"]["Functions"]["record_shippo_tracking_update"]["Args"],
  "p_carrier" | "p_tracking_url"
> & {
  p_carrier: string | null;
  p_tracking_url: string | null;
};

export async function POST(req: NextRequest) {
  const requestId = getRequestIdFromHeaders(req.headers);

  try {
    // Verify webhook token
    const url = new URL(req.url);
    const queryParsed = shippoWebhookQuerySchema.safeParse({
      token: url.searchParams.get("token") ?? undefined,
    });

    if (!queryParsed.success) {
      log({
        level: "warn",
        layer: "api",
        message: "shippo_webhook_invalid_token",
        requestId,
        route: "/api/webhooks/shippo",
        status: 401,
        tokenPresent: false,
      });
      return NextResponse.json({ error: "invalid token" }, { status: 401 });
    }

    const { token } = queryParsed.data;

    if (env.SHIPPO_WEBHOOK_TOKEN) {
      if (!token || token !== env.SHIPPO_WEBHOOK_TOKEN) {
        log({
          level: "warn",
          layer: "api",
          message: "shippo_webhook_invalid_token",
          requestId,
          route: "/api/webhooks/shippo",
          status: 401,
          tokenPresent: Boolean(token),
        });
        return NextResponse.json({ error: "invalid token" }, { status: 401 });
      }
    }

    const payload = await req.json().catch(() => null);
    const parsedEvent = shippoWebhookEventSchema.safeParse(payload);
    if (!parsedEvent.success) {
      logError(new Error("Webhook received invalid JSON"), {
        layer: "api",
        requestId,
        route: "/api/webhooks/shippo",
      });
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const eventType = parsedEvent.data.event;
    const shippoApiVersion = req.headers.get("Shippo-API-Version");

    // Only handle tracking-related Shippo webhooks.
    if (eventType === "transaction_created") {
      log({
        level: "info",
        layer: "api",
        message: "shippo_webhook_transaction_created_ignored",
        requestId,
        route: "/api/webhooks/shippo",
        shippoApiVersion,
        eventType,
        note: "label_created_notifications_are_sent_during_admin_label_purchase",
      });
      return NextResponse.json({ ok: true });
    }

    if (eventType !== "track_updated" && eventType !== "transaction_updated") {
      log({
        level: "info",
        layer: "api",
        message: "shippo_webhook_event_ignored",
        requestId,
        route: "/api/webhooks/shippo",
        shippoApiVersion,
        eventType,
      });
      return NextResponse.json({ ok: true });
    }

    const trackingUpdate = extractShippoTrackingUpdate(parsedEvent.data);
    if (!trackingUpdate) {
      log({
        level: "info",
        layer: "api",
        message: "shippo_webhook_missing_tracking_data",
        requestId,
        route: "/api/webhooks/shippo",
        shippoApiVersion,
        eventType,
        payloadKeys:
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? Object.keys(payload as Record<string, unknown>)
            : [],
      });
      return NextResponse.json({ ok: true });
    }

    const { trackingNumber, statusRaw } = trackingUpdate;

    const status = String(statusRaw).toUpperCase();
    const newFulfillmentStatus = SHIPPO_TRACKING_STATUS_MAP[status];

    // Ignore statuses we don't track
    if (newFulfillmentStatus === null || newFulfillmentStatus === undefined) {
      log({
        level: "info",
        layer: "api",
        message: "shippo_webhook_status_ignored",
        requestId,
        route: "/api/webhooks/shippo",
        shippoApiVersion,
        eventType,
        trackingNumber,
        trackingStatus: status,
      });
      return NextResponse.json({ ok: true });
    }

    // Persist status and a deduplicated notification in one database transaction.
    // Email delivery is handled by the existing retry worker, outside this request.
    const trackingUpdateArgs = {
      p_tracking_number: trackingNumber,
      p_status: newFulfillmentStatus,
      p_carrier: trackingUpdate.carrier,
      p_tracking_url: trackingUpdate.trackingUrl,
    } satisfies RecordTrackingUpdateArgs;
    const { data, error } = await createSupabaseAdminClient().rpc(
      "record_shippo_tracking_update",
      trackingUpdateArgs as never,
    );
    if (error) {
      throw error;
    }
    log({
      level: "info",
      layer: "api",
      message: "shippo_webhook_processed",
      requestId,
      route: "/api/webhooks/shippo",
      eventType,
      trackingStatus: status,
      result: data,
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    logError(e, { layer: "api", requestId, route: "/api/webhooks/shippo" });
    return NextResponse.json({ error: "webhook processing failed" }, { status: 500 });
  }
}
