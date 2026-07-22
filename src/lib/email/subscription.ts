import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";
import { env } from "@/config/env";
import { emailFooterText } from "@/lib/email/footer";
import { renderEmailLayout } from "@/lib/email/template";
import { emailStyles } from "@/lib/email/theme";

export const buildSubscriptionConfirmedEmail = () => {
  const contentHtml = `
      <tr>
        <td class="email-hero" style="${emailStyles.heroCell}">
          <div style="${emailStyles.eyebrow}">Subscription confirmed</div>
          <h1 class="email-heading" style="${emailStyles.heading}">You're on the list</h1>
          <p style="margin:16px auto 0;max-width:430px;${emailStyles.copy}">New arrivals, restocks, and curated drops from ${EMAIL_DISPLAY_NAME} will land here first.</p>
          <div style="margin-top:26px;">
            <a class="email-button" href="${env.NEXT_PUBLIC_SITE_URL}/store" style="${emailStyles.button}">Shop new arrivals</a>
          </div>
        </td>
      </tr>
    `;

  const html = renderEmailLayout({
    title: "Subscription confirmed",
    preheader: `You're subscribed to ${EMAIL_DISPLAY_NAME} updates.`,
    contentHtml,
  });

  const text = `Subscription confirmed
Thanks for signing up for ${EMAIL_DISPLAY_NAME} updates.
${emailFooterText()}
`;

  return { html, text };
};

export const buildSubscriptionConfirmationEmail = (confirmUrl: string) => {
  const contentHtml = `
      <tr>
          <td class="email-hero" style="${emailStyles.heroCell}">
            <div style="${emailStyles.eyebrow}">Confirm subscription</div>
            <h1 class="email-heading" style="${emailStyles.heading}">One step from the drop</h1>
            <p style="margin:16px auto 0;max-width:430px;${emailStyles.copy}">Confirm your email to get new arrivals, restocks, and store updates from ${EMAIL_DISPLAY_NAME}.</p>
          </td>
        </tr>
        <tr>
          <td class="email-pad" style="padding:0 40px 42px;text-align:center;">
            <a class="email-button" href="${confirmUrl}" style="${emailStyles.button}">Confirm subscription</a>
            <p style="margin:18px 0 0;${emailStyles.subcopy}">This link expires in 24 hours.</p>
            <p style="margin:6px 0 0;${emailStyles.subcopy}">If you didn't request this email, you can safely ignore it.</p>
          </td>
        </tr>
      `;

  const html = renderEmailLayout({
    title: "Confirm your subscription",
    preheader: `Confirm your email to get ${EMAIL_DISPLAY_NAME} updates.`,
    contentHtml,
  });

  const text = `Confirm your ${EMAIL_DISPLAY_NAME} subscription
Confirm here: ${confirmUrl}
This link expires in 24 hours.
If you didn't request this email, you can safely ignore it.
${emailFooterText()}
`;

  return { html, text };
};
