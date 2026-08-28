import { createHmac } from "node:crypto";

import { verifySquareWebhookSignature } from "@/lib/square/webhook";

const signatureKey = "square-signature-key";
const notificationUrl = "https://shop.example.com/api/webhooks/square";
const rawBody = JSON.stringify({
  merchant_id: "merchant-1",
  type: "payment.updated",
  event_id: "event-1",
});

function sign(body: string, url = notificationUrl): string {
  return createHmac("sha256", signatureKey)
    .update(`${url}${body}`, "utf8")
    .digest("base64");
}

describe("verifySquareWebhookSignature", () => {
  it("accepts the exact raw body and configured notification URL", async () => {
    await expect(
      verifySquareWebhookSignature({
        rawBody,
        signature: sign(rawBody),
        signatureKey,
        notificationUrl,
      }),
    ).resolves.toBe(true);
  });

  it("rejects an altered body", async () => {
    await expect(
      verifySquareWebhookSignature({
        rawBody: `${rawBody} `,
        signature: sign(rawBody),
        signatureKey,
        notificationUrl,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a signature generated for another notification URL", async () => {
    await expect(
      verifySquareWebhookSignature({
        rawBody,
        signature: sign(rawBody, "https://evil.example/api/webhooks/square"),
        signatureKey,
        notificationUrl,
      }),
    ).resolves.toBe(false);
  });

  it("rejects missing signature material without throwing", async () => {
    await expect(
      verifySquareWebhookSignature({
        rawBody,
        signature: "",
        signatureKey,
        notificationUrl,
      }),
    ).resolves.toBe(false);
  });
});
