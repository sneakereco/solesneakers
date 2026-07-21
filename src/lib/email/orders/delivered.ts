// src/lib/email/orders/delivered.ts
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderDeliveredEmailInput } from "@/types/domain/email";
import {
  buildEmailFooterText,
  buildOrderUrl,
  buildTrackingPanelHtml,
  buildTrackingPanelText,
  brandLine,
} from "@/lib/email/orders/utils";

export const buildOrderDeliveredEmail = (input: OrderDeliveredEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = buildOrderUrl(input.orderUrl);
  const buttonUrl = input.trackingUrl ?? orderUrl;

  const contentHtml = `
    <tr>
      <td style="padding:0 24px 10px;text-align:center;">
        <div style="${emailStyles.eyebrow}">Delivered</div>
        <h1 style="${emailStyles.heading}">Order #${orderShort}</h1>
        <p style="margin:10px 0 0;${emailStyles.copy}">
          Marked as delivered.
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
        <a href="${buttonUrl}" style="${emailStyles.button}">View tracking</a>
      </td>
    </tr>
  `;

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
