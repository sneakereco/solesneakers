// src/lib/email/orders/label-created.ts
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderLabelCreatedEmailInput } from "@/types/domain/email";
import {
  buildEmailFooterText,
  buildOrderStatusContentHtml,
  buildOrderUrl,
  buildTrackingPanelText,
  brandLine,
} from "@/lib/email/orders/utils";

export const buildOrderLabelCreatedEmail = (input: OrderLabelCreatedEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = buildOrderUrl(input.orderUrl);
  const buttonUrl = input.trackingUrl ?? orderUrl;
  const buttonLabel = input.trackingUrl ? "Track your package" : "View your order";
  const trackingNumber = input.trackingNumber ? ` (${input.trackingNumber})` : "";

  const contentHtml = buildOrderStatusContentHtml({
    order: input,
    orderShort,
    eyebrow: "Label created",
    heading: "Packed for the road",
    message: `Order #${orderShort} has a shipping label${trackingNumber}. Tracking starts after the carrier's first scan.`,
    buttonUrl,
    buttonLabel,
  });

  const html = renderEmailLayout({
    title: "Label Created",
    preheader: `Shipping label created for order #${orderShort}.`,
    contentHtml,
  });

  const lines = [
    brandLine(),
    `Order #${orderShort}`,
    "Your shipping label has been created.",
    "Tracking may take a bit to update until the carrier scans the package.",
    buildTrackingPanelText(input),
    "",
    `View your order: ${orderUrl}`,
    buildEmailFooterText(),
  ].filter(Boolean);

  return { html, text: lines.join("\n") };
};
