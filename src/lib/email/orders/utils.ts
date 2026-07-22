import { env } from "@/config/env";
import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";
import { emailFooterText } from "@/lib/email/footer";
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import type { OrderTrackingEmailBase, ShippingAddress } from "@/types/domain/email";

export const formatMoney = (value: number) => value.toFixed(2);

const formatLine = (value?: string | null) => (value ? value.trim() : "");

export const buildAddressLines = (address?: ShippingAddress | null) => {
  if (!address) {
    return [];
  }
  const lines = [
    formatLine(address.name),
    formatLine(address.line1),
    formatLine(address.line2),
    [formatLine(address.city), formatLine(address.state), formatLine(address.postalCode)]
      .filter(Boolean)
      .join(", ")
      .trim(),
    formatLine(address.country),
  ];
  return lines.filter(Boolean);
};

export const buildOrderUrl = (orderUrl?: string | null) =>
  orderUrl ?? `${env.NEXT_PUBLIC_SITE_URL}/account`;

export const buildEmailFooterText = () => emailFooterText();

export const brandLine = () => EMAIL_DISPLAY_NAME;

export const buildTrackingPanelHtml = (input: OrderTrackingEmailBase) => {
  const carrierLabel = input.carrier ?? "Carrier";
  const trackingLabel = input.trackingNumber ?? "Tracking details will be shared soon.";
  const trackingUrl = input.trackingUrl ?? null;

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
      <tr>
        <td style="padding:18px 20px;">
          <div style="${emailStyles.label}">Carrier</div>
          <div style="font-size:14px;color:${EMAIL_COLORS.text};margin-top:4px;">
            ${carrierLabel}
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 20px;border-top:1px solid ${EMAIL_COLORS.panelBorder};">
          <div style="${emailStyles.label}">Tracking</div>
          <div style="font-size:14px;color:${EMAIL_COLORS.text};margin-top:4px;">
            ${trackingUrl ? `<a href="${trackingUrl}" style="${emailStyles.accentLink}">${trackingLabel}</a>` : trackingLabel}
          </div>
        </td>
      </tr>
    </table>
  `;
};

export const buildTrackingPanelText = (input: OrderTrackingEmailBase) => {
  const lines: string[] = [];
  if (input.carrier) {
    lines.push(`Carrier: ${input.carrier}`);
  }
  if (input.trackingNumber) {
    lines.push(`Tracking: ${input.trackingNumber}`);
  }
  if (input.trackingUrl) {
    lines.push(`Track: ${input.trackingUrl}`);
  }
  return lines.join("\n");
};

type OrderStatusContentInput = {
  order: OrderTrackingEmailBase;
  orderShort: string;
  eyebrow: string;
  heading: string;
  message: string;
  buttonUrl: string;
  buttonLabel: string;
};

export const buildOrderStatusContentHtml = ({
  order,
  orderShort,
  eyebrow,
  heading,
  message,
  buttonUrl,
  buttonLabel,
}: OrderStatusContentInput) => `
  <tr>
    <td class="email-hero" style="${emailStyles.heroCell}">
      <div style="${emailStyles.eyebrow}">${eyebrow}</div>
      <h1 class="email-heading" style="${emailStyles.heading}">${heading}</h1>
      <p style="margin:16px auto 0;max-width:440px;${emailStyles.copy}">${message}</p>
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
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td class="email-pad" style="padding:0 40px 16px;">
      ${buildTrackingPanelHtml(order)}
    </td>
  </tr>
  <tr>
    <td class="email-pad" style="padding:10px 40px 42px;text-align:center;">
      <a class="email-button" href="${buttonUrl}" style="${emailStyles.button}">${buttonLabel}</a>
    </td>
  </tr>
`;
