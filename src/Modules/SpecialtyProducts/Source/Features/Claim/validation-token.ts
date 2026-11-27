import { createHmac, timingSafeEqual } from "node:crypto";
import { validatedEligibilitySchema, type ValidatedEligibility } from "./claim-contract";
import {
  deriveEligibilityKeys,
  getIdentityKeyFingerprint,
  normalizeInstagramHandle,
} from "./normalize-identity";

type Binding = Pick<ValidatedEligibility, "campaignId" | "productId" | "browserId">;
type Purpose = "eligibility" | "correction";
function signature(payload: string, secret: string): Buffer {
  if (secret.length < 32) throw new Error("specialty_secret_unavailable");
  return createHmac("sha256", secret)
    .update("specialty-proof-v1." + payload)
    .digest();
}
function issue(value: ValidatedEligibility, secret: string, purpose: Purpose): string {
  const valid = validatedEligibilitySchema.parse(value);
  if (valid.identityKeyFingerprint !== getIdentityKeyFingerprint(secret))
    throw new Error("specialty_identity_key_mismatch");
  const keys = deriveEligibilityKeys(
    valid.campaignId,
    valid.instagramHandle,
    valid.address,
    secret,
  );
  if (
    keys.addressKey !== valid.addressKey ||
    keys.instagramKey !== valid.instagramKey ||
    normalizeInstagramHandle(valid.instagramHandle) !== valid.instagramHandle
  )
    throw new Error("invalid_eligibility_identity");
  const payload = Buffer.from(JSON.stringify({ purpose, value: valid })).toString(
    "base64url",
  );
  return payload + "." + signature(payload, secret).toString("base64url");
}
function verify(
  token: string,
  binding: Binding,
  secret: string,
  nowMs: number,
  purpose: Purpose,
): ValidatedEligibility | null {
  try {
    if (token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, encodedSignature] = parts;
    const supplied = Buffer.from(encodedSignature, "base64url");
    const expected = signature(payload, secret);
    if (
      supplied.length !== expected.length ||
      supplied.toString("base64url") !== encodedSignature ||
      !timingSafeEqual(supplied, expected)
    )
      return null;
    const envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (envelope?.purpose !== purpose) return null;
    const parsed = validatedEligibilitySchema.safeParse(envelope.value);
    if (!parsed.success) return null;
    const value = parsed.data;
    if (
      value.expiresAt <= nowMs ||
      value.campaignId !== binding.campaignId ||
      value.productId !== binding.productId ||
      value.browserId !== binding.browserId ||
      value.identityKeyFingerprint !== getIdentityKeyFingerprint(secret)
    )
      return null;
    const keys = deriveEligibilityKeys(
      value.campaignId,
      value.instagramHandle,
      value.address,
      secret,
    );
    return keys.addressKey === value.addressKey &&
      keys.instagramKey === value.instagramKey &&
      normalizeInstagramHandle(value.instagramHandle) === value.instagramHandle
      ? value
      : null;
  } catch {
    return null;
  }
}
export function issueEligibilityToken(
  value: ValidatedEligibility,
  secret: string,
): string {
  return issue(value, secret, "eligibility");
}
export function verifyEligibilityToken(
  token: string,
  binding: Binding,
  secret: string,
  nowMs: number,
): ValidatedEligibility | null {
  return verify(token, binding, secret, nowMs, "eligibility");
}
export function issueCorrectionToken(
  value: ValidatedEligibility,
  secret: string,
): string {
  return issue(value, secret, "correction");
}
export function verifyCorrectionToken(
  token: string,
  binding: Binding,
  secret: string,
  nowMs: number,
): ValidatedEligibility | null {
  return verify(token, binding, secret, nowMs, "correction");
}
