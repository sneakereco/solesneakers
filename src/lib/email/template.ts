// src/lib/email/template.ts
import { emailFooterHtml } from "@/lib/email/footer";
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
  width = 560,
}: EmailLayoutInput) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <meta name="viewport" content="width=device-width,initial-scale=1" />
    </head>
    <body style="${emailStyles.body}">
      ${preheader ? `<div style="${emailStyles.preheader}">${preheader}</div>` : ""}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.outerTable}">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:${width}px;${emailStyles.container}">
              <tr>
                <td style="${emailStyles.logoCell}">
                  <div style="${emailStyles.wordmarkWrap}">
                    <p style="${emailStyles.wordmark}">${EMAIL_BRAND.name}</p>
                    <p style="${emailStyles.kicker}">${EMAIL_BRAND.kicker}</p>
                  </div>
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
