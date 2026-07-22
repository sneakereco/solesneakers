// src/lib/email/orders/delivered.ts
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderDeliveredEmailInput } from "@/types/domain/email";
import {
  buildEmailFooterText,
  buildOrderStatusContentHtml,
  buildOrderUrl,
  buildTrackingPanelText,
  brandLine,
} from "@/lib/email/orders/utils";

export const buildOrderDeliveredEmail = (input: OrderDeliveredEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = buildOrderUrl(input.orderUrl);
  const buttonUrl = input.trackingUrl ?? orderUrl;

  const contentHtml = buildOrderStatusContentHtml({
    order: input,
    orderShort,
    eyebrow: "Delivered",
    heading: "Delivered",
    message: `Order #${orderShort} has arrived. We hope it looks even better in hand.`,
    buttonUrl,
    buttonLabel: "View tracking",
  });

  const html = renderEmailLayout({
    title: "Order Delivered",
    preheader: `Order #${orderShort} was delivered.`,
    contentHtml,
  });

  const lines = [
    brandLine(),
    `Order #${orderShort}`,
    "Your order was delivered.",
    buildTrackingPanelText(input),
    "",
    `View your order: ${orderUrl}`,
    buildEmailFooterText(),
  ].filter(Boolean);

  return { html, text: lines.join("\n") };
};
