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
    <td style="padding:18px 24px 24px;border-top:1px solid ${EMAIL_COLORS.border};">
      <div style="font-size:11px;line-height:1.7;color:${EMAIL_COLORS.subtle};font-family:${EMAIL_FONT_STACK};">
        <div style="font-weight:700;color:${EMAIL_COLORS.text};letter-spacing:0.18em;text-transform:uppercase;">
          ${EMAIL_BRAND.name}
        </div>
        <div style="margin-top:6px;color:${EMAIL_COLORS.muted};">
          <a href="mailto:${SUPPORT_EMAIL}" style="${emailStyles.link}">${SUPPORT_EMAIL}</a>
          &nbsp;|&nbsp;
          <a href="${INSTAGRAM_URL}" style="${emailStyles.link}">${INSTAGRAM_HANDLE}</a>
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
  ].join("\n");
