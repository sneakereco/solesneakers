// src/lib/email/orders/confirmation.ts (UPDATED with images + details)
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import { renderEmailLayout } from "@/lib/email/template";
import type { OrderConfirmationEmailInput } from "@/types/domain/email";
import {
  calculateCheckoutDisplayTotals,
  PROCESSING_FEE_LABEL,
} from "@/lib/checkout/display-pricing";
import {
  buildAddressLines,
  buildEmailFooterText,
  buildOrderUrl,
  brandLine,
  formatMoney,
} from "@/lib/email/orders/utils";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const safeText = (value?: string | null) => (value ? escapeHtml(value.trim()) : "");

const safeHttpsUrl = (value?: string | null) => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const buildOrderConfirmationEmail = (input: OrderConfirmationEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderDate = new Date(input.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const addressLines = buildAddressLines(input.shippingAddress);
  const orderUrl = buildOrderUrl(input.orderUrl);
  const orderUrlSafe = safeHttpsUrl(orderUrl) ?? orderUrl;
  const { processingFee, displayTotal } = calculateCheckoutDisplayTotals({
    subtotal: input.subtotal,
    shipping: input.shipping,
    tax: input.tax,
    fulfillment: input.fulfillment,
  });

  const itemsHtml = input.items
    .map((item) => {
      const title = safeText(item.title) || "Item";
      const size = item.sizeLabel ? ` (${safeText(item.sizeLabel)})` : "";
      const imageUrl = safeHttpsUrl(item.imageUrl);

      const detailParts = [
        safeText(item.brand),
        safeText(item.model),
        safeText(item.category),
        safeText(item.sku),
      ].filter(Boolean);

      const detailsLine = detailParts.length
        ? `<div style="font-size:12px;color:${EMAIL_COLORS.muted};margin-top:4px;">${detailParts.join(
            " • ",
          )}</div>`
        : "";

      const thumb = imageUrl
        ? `<img
            src="${imageUrl}"
            width="76"
            height="76"
            alt="${title}"
            style="display:block;width:76px;height:76px;object-fit:contain;border:1px solid ${EMAIL_COLORS.panelBorder};background:${EMAIL_COLORS.storefront};"
          />`
        : `<div style="width:76px;height:76px;border:1px solid ${EMAIL_COLORS.panelBorder};background:${EMAIL_COLORS.storefront};"></div>`;

      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.panelBorder};">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td width="90" valign="top" style="padding-right:14px;">
                  ${thumb}
                </td>
                <td valign="top" style="padding:0;">
                  <div style="font-size:14px;color:${EMAIL_COLORS.text};font-weight:600;">
                    ${title}${size}
                  </div>
                  ${detailsLine}
                  <div style="font-size:12px;color:${EMAIL_COLORS.muted};margin-top:6px;">Qty ${
                    item.quantity
                  }</div>
                </td>
              </tr>
            </table>
          </td>
          <td align="right" style="padding:12px 0;border-bottom:1px solid ${EMAIL_COLORS.panelBorder};font-size:14px;color:${EMAIL_COLORS.text};vertical-align:top;">
            $${formatMoney(item.lineTotal)}
          </td>
        </tr>
      `;
    })
    .join("");

  const shippingBlock =
    input.fulfillment === "ship" && addressLines.length > 0
      ? `
        <tr>
          <td style="padding:16px 0 0;">
            <div style="${emailStyles.labelAccent}">Shipping Address</div>
            <div style="margin-top:8px;font-size:13px;line-height:1.6;color:${EMAIL_COLORS.muted};">
              ${addressLines.map((line) => `<div>${safeText(line)}</div>`).join("")}
            </div>
          </td>
        </tr>
      `
      : `
        <tr>
          <td style="padding:16px 0 0;">
            <div style="${emailStyles.labelAccent}">Fulfillment</div>
            <div style="margin-top:8px;font-size:13px;line-height:1.6;color:${EMAIL_COLORS.muted};">
              ${input.fulfillment === "pickup" ? "Local pickup" : "Shipping details pending"}
            </div>
          </td>
        </tr>
      `;

  const contentHtml = `
      <tr>
        <td class="email-hero" style="${emailStyles.heroCell}">
          <div style="${emailStyles.eyebrow}">Order confirmed</div>
          <h1 class="email-heading" style="${emailStyles.heading}">The heat is yours</h1>
          <p style="margin:16px auto 0;max-width:440px;${emailStyles.copy}">
            Order #${safeText(orderShort)} is confirmed and being prepared now.
          </p>
        </td>
      </tr>
      <tr>
        <td class="email-pad" style="padding:0 40px 22px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
            <tr>
              <td style="padding:18px 20px;">
                <div style="${emailStyles.label}">Order</div>
                <div style="font-size:16px;color:${EMAIL_COLORS.text};font-weight:700;margin-top:4px;">
                  #${safeText(orderShort)}
                </div>
              </td>
              <td style="padding:18px 20px;text-align:right;">
                <div style="${emailStyles.label}">Placed</div>
                <div style="font-size:14px;color:${EMAIL_COLORS.text};margin-top:4px;">
                  ${safeText(orderDate)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="email-pad" style="padding:0 40px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td colspan="2" style="padding:4px 0 12px;">
                <div style="${emailStyles.labelAccent}">Receipt</div>
              </td>
            </tr>
            ${itemsHtml}
            <tr>
              <td style="padding:12px 0 4px;font-size:13px;color:${EMAIL_COLORS.muted};">Subtotal</td>
              <td align="right" style="padding:12px 0 4px;font-size:13px;color:${EMAIL_COLORS.text};">
                $${formatMoney(input.subtotal)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 4px;font-size:13px;color:${EMAIL_COLORS.muted};">Shipping</td>
              <td align="right" style="padding:0 0 4px;font-size:13px;color:${EMAIL_COLORS.text};">
                $${formatMoney(input.shipping)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 4px;font-size:13px;color:${EMAIL_COLORS.muted};">Tax</td>
              <td align="right" style="padding:0 0 4px;font-size:13px;color:${EMAIL_COLORS.text};">
                $${formatMoney(input.tax)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 4px;font-size:13px;color:${EMAIL_COLORS.muted};">Processing fee (${PROCESSING_FEE_LABEL})</td>
              <td align="right" style="padding:0 0 4px;font-size:13px;color:${EMAIL_COLORS.text};">
                $${formatMoney(processingFee)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px;font-size:14px;color:${EMAIL_COLORS.text};font-weight:700;border-bottom:1px solid ${EMAIL_COLORS.panelBorder};">
                Total
              </td>
              <td align="right" style="padding:0 0 12px;font-size:16px;color:${EMAIL_COLORS.text};font-weight:700;border-bottom:1px solid ${EMAIL_COLORS.panelBorder};">
                $${formatMoney(displayTotal)}
              </td>
            </tr>
            ${shippingBlock}
          </table>
        </td>
      </tr>
      <tr>
        <td class="email-pad" style="padding:28px 40px 42px;text-align:center;">
          <a class="email-button" href="${orderUrlSafe}" style="${emailStyles.button}">View your order</a>
        </td>
      </tr>
    `;

  const html = renderEmailLayout({
    title: "Order Confirmation",
    preheader: `Order #${orderShort} confirmed.`,
    contentHtml,
  });

  const lines = [
    brandLine(),
    `Order #${orderShort}`,
    `Placed: ${orderDate}`,
    "Receipt",
    "",
    "Items:",
    ...input.items.map((item) => {
      const size = item.sizeLabel ? ` (${item.sizeLabel})` : "";
      const detailsParts = [item.brand, item.model, item.category, item.sku].filter(
        Boolean,
      );
      const details = detailsParts.length ? ` [${detailsParts.join(" • ")}]` : "";
      const img = item.imageUrl ? ` (img: ${item.imageUrl})` : "";
      return `- ${item.title}${size}${details}${img} x${item.quantity} - $${formatMoney(
        item.lineTotal,
      )}`;
    }),
    "",
    `Subtotal: $${formatMoney(input.subtotal)}`,
    `Shipping: $${formatMoney(input.shipping)}`,
    `Tax: $${formatMoney(input.tax)}`,
    `Processing fee (${PROCESSING_FEE_LABEL}): $${formatMoney(processingFee)}`,
    `Total: $${formatMoney(displayTotal)}`,
  ];

  if (input.fulfillment === "ship") {
    lines.push("", "Shipping Address:", ...addressLines);
  } else {
    lines.push("", "Fulfillment: Local pickup");
  }

  lines.push("", `View your order: ${orderUrl}`);
  lines.push(buildEmailFooterText());

  return { html, text: lines.join("\n") };
};
