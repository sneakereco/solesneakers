import { z } from "zod";

import { env } from "@/config/env";
import type {
  CheckoutNotification,
  CheckoutNotificationWorkerDependencies,
} from "@/lib/checkout/checkout-notification-worker";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { OrderEventsRepository } from "@/repositories/order-events-repo";
import { OrderAccessTokenService } from "@/services/order-access-token-service";
import { OrderEmailService } from "@/services/order-email-service";
import { RefundNotificationService } from "@/services/refund-notification-service";
import type { Json } from "@/types/db/database.types";

const notificationsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    kind: z.enum(["order_confirmation", "refund_confirmation"]),
    payload: z.unknown(),
  }),
);

const refundPayloadSchema = z.object({
  refundAmountCents: z.number().int().positive(),
});

async function loadDetailedOrder(admin: AdminSupabaseClient, orderId: string) {
  // The nested relation is intentionally kept in one query so the email is a
  // snapshot of the same persisted order that the webhook authorized.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
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
      shipping:order_shipping(*)
      `,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("checkout_notification_order_not_found");
  }
  return data;
}

async function sendOrderConfirmation(
  admin: AdminSupabaseClient,
  notification: CheckoutNotification,
): Promise<void> {
  const order = await loadDetailedOrder(admin, notification.orderId);
  const recipient = order.profiles?.email ?? order.guest_email ?? null;
  if (!recipient) {
    throw new Error("checkout_notification_recipient_missing");
  }

  let orderUrl: string | null = null;
  if (!order.user_id && order.guest_email) {
    const { token } = await new OrderAccessTokenService(admin).createToken({
      orderId: order.id,
    });
    orderUrl = `${env.NEXT_PUBLIC_SITE_URL}/order-status/${order.id}?token=${encodeURIComponent(token)}`;
  }

  const shippingRaw = order.shipping;
  const shipping = Array.isArray(shippingRaw) ? shippingRaw[0] : shippingRaw;
  await new OrderEmailService(admin, order.tenant_id).sendOrderConfirmationFromDetailed({
    to: recipient,
    order: {
      orderId: order.id,
      createdAt: order.created_at ?? new Date().toISOString(),
      fulfillment: order.fulfillment === "pickup" ? "pickup" : "ship",
      currency: order.currency ?? "USD",
      subtotal: Number(order.subtotal ?? 0),
      tax: Number(order.tax_amount ?? 0),
      shipping: Number(order.shipping ?? 0),
      total: Number(order.total ?? 0),
      shippingAddress: shipping
        ? {
            name: shipping.name ?? null,
            line1: shipping.line1 ?? null,
            line2: shipping.line2 ?? null,
            city: shipping.city ?? null,
            state: shipping.state ?? null,
            postalCode: shipping.postal_code ?? null,
            country: shipping.country ?? null,
          }
        : null,
      orderUrl,
    },
    itemsDetailed: order.items ?? [],
  });

  await new OrderEventsRepository(admin).insertEvent({
    orderId: order.id,
    type: "order_confirmation_sent",
    message: "Square order confirmation sent",
  });
}

async function sendRefundConfirmation(
  admin: AdminSupabaseClient,
  notification: CheckoutNotification,
): Promise<void> {
  const payload = refundPayloadSchema.parse(notification.payload);
  const order = await loadDetailedOrder(admin, notification.orderId);
  await new RefundNotificationService(admin).sendRefundNotification({
    order,
    refundAmountCents: payload.refundAmountCents,
    cumulativeRefundCents: Math.max(0, Math.round(Number(order.refund_amount ?? 0))),
    skipIfAlreadySent: true,
  });
}

export function createCheckoutNotificationDependencies(
  admin: AdminSupabaseClient,
): CheckoutNotificationWorkerDependencies {
  return {
    claim: async (limit) => {
      const { data, error } = await admin.rpc("claim_checkout_notifications", {
        p_limit: limit,
      });
      if (error) {
        throw error;
      }
      return notificationsSchema.parse(data).map((notification) => ({
        ...notification,
        payload: notification.payload as Json,
      }));
    },
    send: (notification) =>
      notification.kind === "order_confirmation"
        ? sendOrderConfirmation(admin, notification)
        : sendRefundConfirmation(admin, notification),
    markSent: async (id) => {
      const { data, error } = await admin.rpc("finish_checkout_notification", {
        p_notification_id: id,
        p_succeeded: true,
      });
      if (error || !data) {
        throw error ?? new Error("checkout_notification_finish_failed");
      }
    },
    markFailed: async (id) => {
      const { data, error } = await admin.rpc("finish_checkout_notification", {
        p_notification_id: id,
        p_succeeded: false,
      });
      if (error || !data) {
        throw error ?? new Error("checkout_notification_retry_failed");
      }
    },
  };
}
