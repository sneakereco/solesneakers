// src/lib/email/footer.ts
import { env } from "@/config/env";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { EMAIL_BRAND, EMAIL_COLORS, EMAIL_FONT_STACK } from "@/lib/email/theme";

const siteUrl = env.NEXT_PUBLIC_SITE_URL;

export const emailFooterHtml = () => `
  <tr>
    <td class="email-pad" style="padding:32px 40px;background:${EMAIL_COLORS.accentSoft};border-top:1px solid ${EMAIL_COLORS.border};font-family:${EMAIL_FONT_STACK};color:${EMAIL_COLORS.muted};">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding:0 0 18px;font-size:17px;line-height:1.2;font-weight:700;color:${EMAIL_COLORS.text};">
            ${EMAIL_BRAND.name}
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 20px;font-size:12px;line-height:2;color:${EMAIL_COLORS.subtle};">
            <a href="${siteUrl}/store" style="color:${EMAIL_COLORS.text};text-decoration:none;">Shop</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${siteUrl}/account" style="color:${EMAIL_COLORS.text};text-decoration:none;">Account</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${siteUrl}/shipping" style="color:${EMAIL_COLORS.text};text-decoration:none;">Shipping</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${siteUrl}/contact" style="color:${EMAIL_COLORS.text};text-decoration:none;">Contact</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 0 0;border-top:1px solid ${EMAIL_COLORS.border};font-size:11px;line-height:1.8;color:${EMAIL_COLORS.subtle};">
            Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMAIL_COLORS.text};text-decoration:underline;">${SUPPORT_EMAIL}</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${INSTAGRAM_URL}" style="color:${EMAIL_COLORS.text};text-decoration:underline;">${INSTAGRAM_HANDLE}</a>
            <br />&copy; ${new Date().getFullYear()} ${EMAIL_BRAND.name}. All rights reserved.
          </td>
        </tr>
      </table>
    </td>
  </tr>
`;

export const emailFooterText = () =>
  [
    "",
    EMAIL_BRAND.name,
    `Email: ${SUPPORT_EMAIL}`,
    `Instagram: ${INSTAGRAM_HANDLE} (${INSTAGRAM_URL})`,
  ].join("\n");
