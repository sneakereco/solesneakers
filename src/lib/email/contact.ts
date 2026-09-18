import { emailFooterText } from "@/lib/email/footer";
import { renderEmailLayout } from "@/lib/email/template";
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";

type ContactEmailInput = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const buildContactSubmissionEmail = (input: ContactEmailInput) => {
  const safeName = escapeHtml(input.name);
  const safeEmail = escapeHtml(input.email);
  const safeSubject = escapeHtml(input.subject);
  const safeMessage = escapeHtml(input.message);
  const contentHtml = `
      <tr>
        <td class="email-hero" style="${emailStyles.heroCell}">
          <div style="${emailStyles.eyebrow}">Contact Form</div>
          <h1 class="email-heading" style="${emailStyles.heading}">New message received</h1>
        </td>
      </tr>
      <tr>
        <td class="email-pad" style="padding:0 40px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
            <tr>
              <td style="padding:18px 20px;">
                <div style="${emailStyles.label}">From</div>
                <div style="font-size:15px;color:${EMAIL_COLORS.text};font-weight:700;margin-top:4px;">
                  ${safeName}
                </div>
                <div style="font-size:13px;color:${EMAIL_COLORS.muted};margin-top:6px;">
                  ${safeEmail}
                </div>
              </td>
              <td style="padding:18px 20px;text-align:right;">
                <div style="${emailStyles.label}">Subject</div>
                <div style="font-size:14px;color:${EMAIL_COLORS.text};margin-top:4px;">
                  ${safeSubject}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="email-pad" style="padding:0 40px 40px;">
          <div style="${emailStyles.labelAccent}">Message</div>
          <div style="margin-top:10px;${emailStyles.panel}padding:14px;font-size:13px;line-height:1.7;color:${EMAIL_COLORS.muted};">
            ${safeMessage.replace(/\n/g, "<br />")}
          </div>
        </td>
      </tr>
    `;

  const html = renderEmailLayout({
    title: "New message received",
    preheader: "New Contact Form Submission",
    contentHtml,
  });

  const text = `New Contact Form Submission
Name: ${input.name}
Email: ${input.email}
Subject: ${input.subject}
Message:
${input.message}
${emailFooterText()}
`;

  const subjectPrefix = "Contact";

  return { html, text, subjectPrefix };
};
