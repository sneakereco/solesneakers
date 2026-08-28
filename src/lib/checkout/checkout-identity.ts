import { createHmac } from "node:crypto";

export function normalizeCheckoutEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashNormalizedCheckoutEmail(email: string, secret: string): string {
  if (!secret) {
    throw new Error("checkout_identity_secret_missing");
  }

  return createHmac("sha256", secret)
    .update(normalizeCheckoutEmail(email), "utf8")
    .digest("hex");
}

export function getCheckoutIdentitySecret(): string {
  const secret = process.env.CHECKOUT_IDENTITY_HMAC_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("checkout_identity_secret_missing");
  }
  return secret;
}
