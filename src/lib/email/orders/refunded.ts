// src/lib/email/orders/refunded.ts
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderRefundedEmailInput } from "@/types/domain/email";
import {
  buildEmailFooterText,
  buildOrderUrl,
  brandLine,
  formatMoney,
} from "@/lib/email/orders/utils";

export const buildOrderRefundedEmail = (input: OrderRefundedEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = buildOrderUrl(input.orderUrl);

  const contentHtml = `
    <tr>
      <td class="email-hero" style="${emailStyles.heroCell}">
        <div style="${emailStyles.eyebrow}">Refund processed</div>
        <h1 class="email-heading" style="${emailStyles.heading}">Your refund is on the way</h1>
        <p style="margin:16px auto 0;max-width:440px;${emailStyles.copy}">
          We've issued the refund for order #${orderShort}. Bank posting times may vary.
        </p>
      </td>
    </tr>
    <tr>
      <td class="email-pad" style="padding:0 40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
          <tr>
            <td style="padding:18px 20px;">
              <div style="${emailStyles.label}">Order</div>
              <div style="font-size:16px;color:${EMAIL_COLORS.text};font-weight:700;margin-top:4px;">
                #${orderShort}
              </div>
            </td>
            <td style="padding:18px 20px;text-align:right;">
              <div style="${emailStyles.label}">Refund Amount</div>
              <div style="font-size:16px;color:${EMAIL_COLORS.text};font-weight:700;margin-top:4px;">
                $${formatMoney(input.refundAmount / 100)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td class="email-pad" style="padding:10px 40px 42px;text-align:center;">
        <a class="email-button" href="${orderUrl}" style="${emailStyles.button}">View your order</a>
      </td>
    </tr>
  `;

  const html = renderEmailLayout({
    title: "Refund Processed",
    preheader: `Refund processed for order #${orderShort}.`,
    contentHtml,
  });

  const lines = [
    brandLine(),
    `Order #${orderShort}`,
    `Refund amount: $${formatMoney(input.refundAmount / 100)}`,
    "Your refund has been processed.",
    "The refund should appear in your account within 5-10 business days.",
    "",
    `View your order: ${orderUrl}`,
    buildEmailFooterText(),
  ];

  return { html, text: lines.join("\n") };
};
