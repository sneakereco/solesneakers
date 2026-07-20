// src/lib/email/footer.ts
import { env } from "@/config/env";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import {
  EMAIL_BRAND,
  EMAIL_COLORS,
  EMAIL_FONT_STACK,
  emailStyles,
} from "@/lib/email/theme";

const siteUrl = env.NEXT_PUBLIC_SITE_URL;

export const emailFooterHtml = () => `
  <tr>
    <td style="padding:22px 24px 26px;border-top:1px solid ${EMAIL_COLORS.border};">
      <div style="font-size:11px;line-height:1.7;color:${EMAIL_COLORS.subtle};font-family:${EMAIL_FONT_STACK};">
        <div style="font-weight:700;color:${EMAIL_COLORS.text};letter-spacing:0.22em;text-transform:uppercase;">
          ${EMAIL_BRAND.name}
        </div>
        <div style="margin-top:8px;color:${EMAIL_COLORS.muted};">
          <a href="mailto:${SUPPORT_EMAIL}" style="${emailStyles.link}">${SUPPORT_EMAIL}</a>
          &nbsp;|&nbsp;
          <a href="${INSTAGRAM_URL}" style="${emailStyles.link}">${INSTAGRAM_HANDLE}</a>
          &nbsp;|&nbsp;
          <a href="${siteUrl}/contact" style="${emailStyles.link}">Contact</a>
        </div>
        <div style="margin-top:6px;">
          <a href="${siteUrl}/shipping" style="${emailStyles.link}">Shipping</a>
          &nbsp;|&nbsp;
          <a href="${siteUrl}/refunds" style="${emailStyles.link}">Returns &amp; Refunds</a>
        </div>
      </div>
    </td>
  </tr>
`;

export const emailFooterText = () =>
  [
    "",
    EMAIL_BRAND.name,
    `Email: ${SUPPORT_EMAIL}`,
    `Instagram: ${INSTAGRAM_HANDLE} (${INSTAGRAM_URL})`,
    `Contact: ${siteUrl}/contact`,
    `Shipping: ${siteUrl}/shipping`,
    `Returns & Refunds: ${siteUrl}/refunds`,
  ].join("\n");
