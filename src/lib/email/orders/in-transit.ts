// src/lib/email/orders/in-transit.ts
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderInTransitEmailInput } from "@/types/domain/email";
import {
  buildEmailFooterText,
  buildOrderStatusContentHtml,
  buildOrderUrl,
  buildTrackingPanelText,
  brandLine,
} from "@/lib/email/orders/utils";

export const buildOrderInTransitEmail = (input: OrderInTransitEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = buildOrderUrl(input.orderUrl);
  const buttonUrl = input.trackingUrl ?? orderUrl;
  const buttonLabel = input.trackingUrl ? "Track your package" : "View your order";

  const contentHtml = buildOrderStatusContentHtml({
    order: input,
    orderShort,
    eyebrow: "On the way",
    heading: "Your pair is moving",
    message: `Order #${orderShort} is in transit and headed your way.`,
    buttonUrl,
    buttonLabel,
  });

  const html = renderEmailLayout({
    title: "Order In Transit",
    preheader: `Order #${orderShort} is on the way.`,
    contentHtml,
  });

  const lines = [
    brandLine(),
    `Order #${orderShort}`,
    "Your order is in transit.",
    buildTrackingPanelText(input),
    "",
    `View your order: ${orderUrl}`,
    buildEmailFooterText(),
  ].filter(Boolean);

  return { html, text: lines.join("\n") };
};
