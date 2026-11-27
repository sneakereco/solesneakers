import { env } from "@/config/env";
import { renderEmailLayout } from "@/lib/email/template";
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import { brandLine, buildEmailFooterText, formatMoney } from "./utils";
import type { AdminOrderPlacedEmailInput } from "@/types/domain/email";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

export function buildResellerOrderPlacedEmail(input: AdminOrderPlacedEmailInput) {
  const shortId = input.orderId.slice(0, 8).toUpperCase();
  const orderUrl = new URL(
    `/admin/transactions/${encodeURIComponent(input.orderId)}`,
    env.NEXT_PUBLIC_SITE_URL,
  ).href;
  const fulfillment = input.fulfillment === "pickup" ? "Local pickup" : "Shipping";
  const customer = input.customerEmail || "Email unavailable";
  const items = input.items.map((item) => {
    const size = item.sizeLabel ? ` (${item.sizeLabel})` : "";
    return {
      label: `${item.title}${size} x${item.quantity}`,
      total: formatMoney(item.lineTotal),
    };
  });
  const totals: [string, number][] = [
    ["Subtotal", input.subtotal],
    ["Shipping", input.shipping],
    ["Tax", input.tax],
    ["Total", input.total],
  ];
  const html = renderEmailLayout({
    title: "New paid order",
    preheader: `Order #${escapeHtml(shortId)} is paid and ready for fulfillment.`,
    contentHtml: `
      <tr><td class="email-hero" style="${emailStyles.heroCell}">
        <div style="${emailStyles.eyebrow}">New paid order</div>
        <h1 class="email-heading" style="${emailStyles.heading}">Order #${escapeHtml(shortId)}</h1>
        <p style="margin-top:16px;${emailStyles.copy}">Payment is confirmed. Review the order to arrange fulfillment.</p>
      </td></tr>
      <tr><td class="email-pad" style="padding:0 40px 24px;">
        <div style="${emailStyles.copy}">${escapeHtml(fulfillment)} · Items: ${input.itemCount}</div>
        <div style="margin:8px 0 20px;${emailStyles.copy}">Customer: ${escapeHtml(customer)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${items.map((item) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.panelBorder};${emailStyles.copy}">${escapeHtml(item.label)}</td><td align="right" style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.panelBorder};${emailStyles.copy}">$${item.total}</td></tr>`).join("")}
          ${totals.map(([label, value]) => `<tr><td style="padding-top:12px;${emailStyles.copy}">${label}</td><td align="right" style="padding-top:12px;${emailStyles.copy}">$${formatMoney(value)}</td></tr>`).join("")}
        </table>
      </td></tr>
      <tr><td class="email-pad" style="padding:8px 40px 40px;">
        <a class="email-button" href="${escapeHtml(orderUrl)}" style="${emailStyles.button}">View order in admin</a>
      </td></tr>`,
  });
  const text = [
    brandLine(),
    "New paid order",
    `Order #${shortId}`,
    fulfillment,
    `Customer: ${customer}`,
    `Items: ${input.itemCount}`,
    "",
    ...items.map((item) => `- ${item.label} - $${item.total}`),
    "",
    ...totals.map(([label, value]) => `${label}: $${formatMoney(value)}`),
    "",
    `View order in admin: ${orderUrl}`,
    buildEmailFooterText(),
  ].join("\n");
  return { html, text };
}
