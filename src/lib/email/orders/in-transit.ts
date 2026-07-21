// src/lib/email/orders/in-transit.ts
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderInTransitEmailInput } from "@/types/domain/email";
import {
  buildEmailFooterText,
  buildOrderUrl,
  buildTrackingPanelHtml,
  buildTrackingPanelText,
  brandLine,
} from "@/lib/email/orders/utils";

export const buildOrderInTransitEmail = (input: OrderInTransitEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = buildOrderUrl(input.orderUrl);
  const buttonUrl = input.trackingUrl ?? orderUrl;
  const buttonLabel = input.trackingUrl ? "Track your package" : "View your order";

  const contentHtml = `
    <tr>
      <td style="padding:0 24px 10px;text-align:center;">
        <div style="${emailStyles.eyebrow}">On the way</div>
        <h1 style="${emailStyles.heading}">Order #${orderShort}</h1>
        <p style="margin:10px 0 0;${emailStyles.copy}">
          Your package is in transit.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
          <tr>
            <td style="padding:12px;">
              <div style="${emailStyles.label}">Order</div>
              <div style="font-size:16px;color:${EMAIL_COLORS.text};font-weight:700;margin-top:4px;">
                #${orderShort}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 16px;">
        ${buildTrackingPanelHtml(input)}
      </td>
    </tr>
    <tr>
      <td style="padding:20px 24px;text-align:left;">
        <a href="${buttonUrl}" style="${emailStyles.button}">${buttonLabel}</a>
      </td>
    </tr>
  `;

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
