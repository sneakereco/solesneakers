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
    kind: z.enum([
      "order_confirmation",
      "pickup_instructions",
      "refund_confirmation",
      "shipping_update",
      "delivery_confirmation",
    ]),
    payload: z.unknown(),
  }),
);

const refundPayloadSchema = z.object({
  refundAmountCents: z.number().int().positive(),
});

const shippingPayloadSchema = z.object({
  trackingNumber: z.string().min(1),
  carrier: z.string().nullable(),
  trackingUrl: z.string().nullable(),
});

async function wasNotificationSent(
  admin: AdminSupabaseClient,
  notification: CheckoutNotification,
): Promise<boolean> {
  // A previous attempt may have sent successfully but failed to finish the queue row.
  const { data: sent, error } = await admin
    .from("email_audit_log")
    .select("id")
    .eq("notification_id", notification.id)
    .eq("delivery_status", "sent")
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return Boolean(sent);
}

async function sendShippingUpdate(
  admin: AdminSupabaseClient,
  notification: CheckoutNotification,
) {
  const payload = shippingPayloadSchema.parse(notification.payload);
  const order = await loadDetailedOrder(admin, notification.orderId);
  const recipient = order.profiles?.email ?? order.guest_email ?? null;
  if (!recipient) {
    throw new Error("shipping_notification_recipient_missing");
  }
  let orderUrl: string | null = null;
  if (!order.user_id && order.guest_email) {
    const { token } = await new OrderAccessTokenService(admin).createToken({
      orderId: order.id,
    });
    orderUrl = `${env.NEXT_PUBLIC_SITE_URL}/order-status/${order.id}?token=${encodeURIComponent(token)}`;
  }
  const email = new OrderEmailService(admin, order.tenant_id, notification.id);
  const input = { ...payload, to: recipient, orderId: order.id, orderUrl };
  if (notification.kind === "shipping_update") {
    await email.sendOrderInTransit(input);
  } else {
    await email.sendOrderDelivered(input);
  }
}

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
      shippingAddress:order_shipping(*)
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

  const shippingRaw = order.shippingAddress;
  const shippingAddress = Array.isArray(shippingRaw) ? shippingRaw[0] : shippingRaw;
  await new OrderEmailService(
    admin,
    order.tenant_id,
    notification.id,
  ).sendOrderConfirmationFromDetailed({
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
      shippingAddress: shippingAddress
        ? {
            name: shippingAddress.name ?? null,
            line1: shippingAddress.line1 ?? null,
            line2: shippingAddress.line2 ?? null,
            city: shippingAddress.city ?? null,
            state: shippingAddress.state ?? null,
            postalCode: shippingAddress.postal_code ?? null,
            country: shippingAddress.country ?? null,
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

async function sendPickupInstructions(
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

  await new OrderEmailService(
    admin,
    order.tenant_id,
    notification.id,
  ).sendPickupInstructions({
    to: recipient,
    orderId: order.id,
    orderUrl,
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
  orderId?: string,
): CheckoutNotificationWorkerDependencies {
  return {
    claim: async (limit) => {
      const { data, error } = orderId
        ? await admin.rpc("claim_checkout_notifications_for_order", {
            p_limit: limit,
            p_order_id: orderId,
          })
        : await admin.rpc("claim_checkout_notifications", { p_limit: limit });
      if (error) {
        throw error;
      }
      return notificationsSchema.parse(data).map((notification) => ({
        ...notification,
        payload: notification.payload as Json,
      }));
    },
    send: async (notification) => {
      if (await wasNotificationSent(admin, notification)) {
        return;
      }
      switch (notification.kind) {
        case "order_confirmation":
          return sendOrderConfirmation(admin, notification);
        case "pickup_instructions":
          return sendPickupInstructions(admin, notification);
        case "refund_confirmation":
          return sendRefundConfirmation(admin, notification);
        case "shipping_update":
        case "delivery_confirmation":
          return sendShippingUpdate(admin, notification);
      }
    },
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
