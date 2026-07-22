// src/lib/email/footer.ts
import { env } from "@/config/env";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { EMAIL_BRAND, EMAIL_COLORS, EMAIL_FONT_STACK } from "@/lib/email/theme";

const siteUrl = env.NEXT_PUBLIC_SITE_URL;

export const emailFooterHtml = () => `
  <tr>
    <td class="email-pad" style="padding:30px 40px 32px;background:${EMAIL_COLORS.text};font-family:${EMAIL_FONT_STACK};color:${EMAIL_COLORS.inverse};">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding:0 0 20px;font-size:10px;line-height:1.4;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${EMAIL_COLORS.inverse};">
            ${EMAIL_BRAND.name}
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 22px;font-size:12px;line-height:1.9;color:${EMAIL_COLORS.inverseMuted};">
            <a href="${siteUrl}/store" style="color:${EMAIL_COLORS.inverse};text-decoration:none;">Shop</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${siteUrl}/account" style="color:${EMAIL_COLORS.inverse};text-decoration:none;">Account</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${siteUrl}/shipping" style="color:${EMAIL_COLORS.inverse};text-decoration:none;">Shipping</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${siteUrl}/contact" style="color:${EMAIL_COLORS.inverse};text-decoration:none;">Contact</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 0 0;border-top:1px solid #27272a;font-size:11px;line-height:1.8;color:${EMAIL_COLORS.inverseMuted};">
            Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMAIL_COLORS.inverse};text-decoration:underline;">${SUPPORT_EMAIL}</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${INSTAGRAM_URL}" style="color:${EMAIL_COLORS.inverse};text-decoration:underline;">${INSTAGRAM_HANDLE}</a>
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
