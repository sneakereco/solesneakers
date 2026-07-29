// src/lib/email/template.ts
import { emailFooterHtml } from "@/lib/email/footer";
import { env } from "@/config/env";
import { EMAIL_BRAND, emailStyles } from "@/lib/email/theme";

type EmailLayoutInput = {
  title: string;
  preheader?: string;
  contentHtml: string;
  footerHtml?: string;
  width?: number;
};

export const renderEmailLayout = ({
  title,
  preheader,
  contentHtml,
  footerHtml,
  width = 620,
}: EmailLayoutInput) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
      <style>
        :root { color-scheme: light; supported-color-schemes: light; }
        table { border-spacing: 0; }
        img { -ms-interpolation-mode: bicubic; }
        a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
        @media only screen and (max-width: 640px) {
          .email-outer { padding: 0 !important; }
          .email-shell { border-left: 0 !important; border-right: 0 !important; }
          .email-logo-cell { padding: 25px 20px 23px !important; }
          .email-logo { width: 146px !important; }
          .email-hero { padding: 38px 22px 26px !important; }
          .email-pad { padding-left: 20px !important; padding-right: 20px !important; }
          .email-heading { font-size: 32px !important; }
          .email-button { display: block !important; text-align: center !important; }
        }
      </style>
    </head>
    <body style="${emailStyles.body}">
      ${preheader ? `<div style="${emailStyles.preheader}">${preheader}</div>` : ""}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-outer" style="${emailStyles.outerTable}">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="email-shell" style="max-width:${width}px;${emailStyles.container}">
              <tr>
                <td style="${emailStyles.announcement}">Curated heat &nbsp;&bull;&nbsp; Authenticated always &nbsp;&bull;&nbsp; New inventory daily</td>
              </tr>
              <tr>
                <td class="email-logo-cell" style="${emailStyles.logoCell}">
                  <a href="${env.NEXT_PUBLIC_SITE_URL}" aria-label="Visit ${EMAIL_BRAND.name}" style="display:inline-block;text-decoration:none;">
                    <img class="email-logo" src="${env.NEXT_PUBLIC_SITE_URL}/images/email-logo.png" width="168" alt="${EMAIL_BRAND.name}" style="${emailStyles.logo}" />
                  </a>
                </td>
              </tr>
              ${contentHtml}
              ${footerHtml ?? emailFooterHtml()}
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;
