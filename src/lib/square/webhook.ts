import { WebhooksHelper } from "square";

export type SquareWebhookSignatureInput = {
  rawBody: string;
  signature: string;
  signatureKey: string;
  notificationUrl: string;
};

export async function verifySquareWebhookSignature(
  input: SquareWebhookSignatureInput,
): Promise<boolean> {
  if (
    !input.rawBody ||
    !input.signature ||
    !input.signatureKey ||
    !input.notificationUrl
  ) {
    return false;
  }

  try {
    return await WebhooksHelper.verifySignature({
      requestBody: input.rawBody,
      signatureHeader: input.signature,
      signatureKey: input.signatureKey,
      notificationUrl: input.notificationUrl,
    });
  } catch {
    return false;
  }
}
