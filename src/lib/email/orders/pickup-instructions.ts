import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import { EMAIL_COLORS, emailStyles } from "@/lib/email/theme";
import { renderEmailLayout } from "@/lib/email/template";
import { PICKUP_INSTRUCTIONS, PICKUP_LOCATION_SUMMARY } from "@/config/pickup";
import type { PickupInstructionsEmailInput } from "@/types/domain/email";
import { buildEmailFooterText, buildOrderUrl, brandLine } from "@/lib/email/orders/utils";

export const buildPickupInstructionsEmail = (input: PickupInstructionsEmailInput) => {
  const orderShort = input.orderId.slice(0, 8).toUpperCase();
  const orderNumber = `#${orderShort}`;
  const orderUrl = buildOrderUrl(input.orderUrl);
  const locationSummary = input.locationSummary ?? PICKUP_LOCATION_SUMMARY;

  const rawInstructions = input.instructions ?? PICKUP_INSTRUCTIONS;
  const filteredInstructions = rawInstructions.filter((line) => {
    const normalized = line.toLowerCase();
    return !/(appointment|reply to this email|schedule|pickup time|time windows|dm|instagram)/i.test(
      normalized,
    );
  });

  const notesHtml = filteredInstructions.length
    ? `
      <div style="height:10px;"></div>
      <div style="${emailStyles.labelAccent}">Pickup notes</div>
      <ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.7;color:${EMAIL_COLORS.text};">
        ${filteredInstructions.map((line) => `<li style="margin:0 0 8px;">${line}</li>`).join("")}
      </ul>
    `
    : "";

  const contentHtml = `
    <tr>
      <td class="email-hero" style="${emailStyles.heroCell}">
        <div style="${emailStyles.eyebrow}">Local pickup</div>
        <h1 class="email-heading" style="${emailStyles.heading}">Let's get your order to you</h1>
        <p style="margin:16px auto 0;max-width:450px;${emailStyles.copy}">
          Order ${orderNumber} is ready to coordinate for local pickup in ${locationSummary}.
        </p>
      </td>
    </tr>
    <tr>
      <td class="email-pad" style="padding:0 40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="${emailStyles.panel}">
          <tr>
            <td style="padding:20px;">
              <div style="${emailStyles.labelAccent}">Next step</div>
              <ul style="margin:10px 0 0;padding-left:18px;font-size:13px;line-height:1.7;color:${EMAIL_COLORS.text};">
                <li style="margin:0 0 8px;">
                  Reply to this email or DM us on Instagram
                  <a href="${INSTAGRAM_URL}" style="color:${EMAIL_COLORS.text};text-decoration:underline;">${INSTAGRAM_HANDLE}</a>
                  with <strong>${orderNumber}</strong> and 2-3 times that work for you.
                </li>
                <li style="margin:0 0 8px;">
                  Bring your order confirmation email to the meetup.
                </li>
              </ul>
              ${notesHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td class="email-pad" style="padding:10px 40px 42px;text-align:center;">
        <a class="email-button" href="${orderUrl}" style="${emailStyles.button}">View order</a>
      </td>
    </tr>
  `;

  const html = renderEmailLayout({
    title: "Local Pickup Instructions",
    preheader: `Pickup details for order ${orderNumber}.`,
    contentHtml,
  });

  const lines = [
    brandLine(),
    `Pickup instructions for order ${orderNumber}`,
    "",
    `Pickup area: ${locationSummary}`,
    "",
    "Next step:",
    `- Reply to this email or DM us on Instagram: ${INSTAGRAM_URL} (${INSTAGRAM_HANDLE})`,
    `- Include ${orderNumber} and 2-3 times that work for you.`,
    `- Bring your order confirmation email to the meetup.`,
    "",
    ...(filteredInstructions.length
      ? ["Pickup notes:", ...filteredInstructions.map((line) => `- ${line}`), ""]
      : []),
    `View your order: ${orderUrl}`,
    "",
    buildEmailFooterText(),
  ];

  return { html, text: lines.join("\n") };
};
