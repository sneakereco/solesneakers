import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";
import { emailFooterText } from "@/lib/email/footer";
import { renderEmailLayout } from "@/lib/email/template";
import { emailStyles } from "@/lib/email/theme";

export const buildPasswordUpdatedEmail = (accountUrl: string) => {
  const contentHtml = `
      <tr>
        <td class="email-hero" style="${emailStyles.heroCell}">
          <div style="${emailStyles.eyebrow}">Security notice</div>
          <h1 class="email-heading" style="${emailStyles.heading}">Password updated</h1>
          <p style="margin:16px auto 0;max-width:440px;${emailStyles.copy}">
            We're confirming that your ${EMAIL_DISPLAY_NAME} account password was changed successfully.
          </p>
        </td>
      </tr>
      <tr>
        <td class="email-pad" style="padding:0 40px 42px;text-align:center;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
            <tr>
              <td style="padding:18px 20px;text-align:left;">
                <div style="${emailStyles.labelAccent}">Wasn't you?</div>
                <p style="margin:8px 0 0;${emailStyles.subcopy}">Reset your password immediately and contact support so we can help secure your account.</p>
              </td>
            </tr>
          </table>
          <div style="margin-top:26px;">
            <a class="email-button" href="${accountUrl}" style="${emailStyles.button}">Review your account</a>
          </div>
        </td>
      </tr>
    `;

  const html = renderEmailLayout({
    title: "Password Updated",
    preheader: `Your ${EMAIL_DISPLAY_NAME} password was updated.`,
    contentHtml,
  });

  const text = `Your password was updated

We're confirming that your ${EMAIL_DISPLAY_NAME} account password was changed successfully.
If you did not make this change, reset your password right away and contact support.
Review your account: ${accountUrl}
${emailFooterText()}
`;

  return { html, text };
};
