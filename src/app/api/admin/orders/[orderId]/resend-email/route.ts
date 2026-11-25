// app/api/admin/orders/[orderId]/resend-email/route.ts
// Resends a specific transactional email for an order.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { requireAdminApi } from "@/lib/auth/session";
import { OrderEmailService } from "@/services/order-email-service";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
import { RefundNotificationService } from "@/services/refund-notification-service";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";

const paramsSchema = z.object({ orderId: z.string().uuid() });

const bodySchema = z.object({
  emailType: z.enum([
    "order_confirmation",
    "pickup_instructions",
    "label_created",
    "in_transit",
    "delivered",
    "refund_notification",
  ]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const { orderId } = await params;

  try {
    await requireAdminApi();

    const paramsParsed = paramsSchema.safeParse({ orderId });
    if (!paramsParsed.success) {
      return NextResponse.json(
        { error: "Invalid order ID", requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { emailType } = parsed.data;

    const admin = createSupabaseAdminClient();
    const accessTokenService = new OrderAccessTokenService(admin);

    // Load order with items and shipping
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select(
        `
        *,
        profiles!user_id(email),
        items:order_items(
          product_name, brand, model, category, variant_sku, size_label,
          quantity, unit_price, line_total,
          product:products(name, category, images:product_images(url, is_primary, sort_order)),
          variant:product_variants(sku)
        ),
        shippingAddress:order_shipping(*)
        `,
      )
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      throw orderError;
    }
    if (!order) {
      return NextResponse.json(
        { error: "Order not found", requestId },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const recipientEmail = order.profiles?.email ?? order.guest_email ?? null;

    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No recipient email on file for this order", requestId },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    const tenantId = order.tenant_id ?? null;
    const emailService = new OrderEmailService(admin, tenantId);
    const refundNotifications = new RefundNotificationService(admin);

    const shippingRaw = order.shippingAddress;
    const shippingAddr = Array.isArray(shippingRaw) ? shippingRaw[0] : shippingRaw;
    let guestOrderUrl: string | null = null;

    if (!order.user_id && order.guest_email) {
      const { token } = await accessTokenService.createToken({ orderId: order.id });
      guestOrderUrl = `${env.NEXT_PUBLIC_SITE_URL}/order-status/${order.id}?token=${encodeURIComponent(token)}`;
    }

    switch (emailType) {
      case "order_confirmation": {
        await emailService.sendOrderConfirmationFromDetailed({
          to: recipientEmail,
          order: {
            orderId: order.id,
            createdAt: order.created_at ?? new Date().toISOString(),
            fulfillment: (order.fulfillment as "ship" | "pickup") ?? "ship",
            currency: "USD",
            subtotal: Number(order.subtotal ?? 0),
            tax: Number(order.tax_amount ?? 0),
            shipping: 0,
            total: Number(order.total ?? 0),
            shippingAddress: shippingAddr
              ? {
                  name: shippingAddr.name ?? null,
                  line1: shippingAddr.line1 ?? null,
                  line2: shippingAddr.line2 ?? null,
                  city: shippingAddr.city ?? null,
                  state: shippingAddr.state ?? null,
                  postalCode: shippingAddr.postal_code ?? null,
                  country: shippingAddr.country ?? null,
                }
              : null,
          },
          itemsDetailed: order.items ?? [],
        });
        break;
      }
      case "pickup_instructions": {
        await emailService.sendPickupInstructions({
          to: recipientEmail,
          orderId: order.id,
        });
        break;
      }
      case "label_created": {
        await emailService.sendOrderLabelCreated({
          to: recipientEmail,
          orderId: order.id,
          carrier: order.shipping_carrier ?? null,
          trackingNumber: order.tracking_number ?? null,
          orderUrl: guestOrderUrl,
        });
        break;
      }
      case "in_transit": {
        await emailService.sendOrderInTransit({
          to: recipientEmail,
          orderId: order.id,
          carrier: order.shipping_carrier ?? null,
          trackingNumber: order.tracking_number ?? null,
          orderUrl: guestOrderUrl,
        });
        break;
      }
      case "delivered": {
        await emailService.sendOrderDelivered({
          to: recipientEmail,
          orderId: order.id,
          carrier: order.shipping_carrier ?? null,
          trackingNumber: order.tracking_number ?? null,
          orderUrl: guestOrderUrl,
        });
        break;
      }
      case "refund_notification": {
        const latestRefund = await refundNotifications.getLatestRefundNotification(
          order.id,
        );
        const refundAmountCents =
          latestRefund?.refundAmountCents ??
          Math.max(0, Math.round(Number(order.refund_amount ?? 0)));

        if (refundAmountCents <= 0) {
          return NextResponse.json(
            {
              error: "This order does not have a refundable email amount to resend",
              requestId,
            },
            { status: 422, headers: { "Cache-Control": "no-store" } },
          );
        }

        await emailService.sendOrderRefunded({
          to: recipientEmail,
          orderId: order.id,
          refundAmount: refundAmountCents,
          orderUrl: guestOrderUrl,
        });
        break;
      }
    }

    return NextResponse.json(
      { success: true, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError(error, {
      layer: "api",
      requestId,
      route: `/api/admin/orders/${orderId}/resend-email`,
    });
    return NextResponse.json(
      { error: "Failed to resend email", requestId },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
