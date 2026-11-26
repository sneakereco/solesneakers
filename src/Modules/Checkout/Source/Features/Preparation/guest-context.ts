import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCheckoutIdentitySecret } from "@/lib/checkout/checkout-identity";

const cookieName = "__Host-checkout-context";
function digest(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret)
    .update(purpose + "\0" + value)
    .digest("hex");
}
function equalDigest(a: string, b: string) {
  return (
    /^[0-9a-f]{64}$/.test(a) &&
    /^[0-9a-f]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export function readGuestContext(
  request: Request,
  secret = getCheckoutIdentitySecret(),
): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(cookieName + "="));
  if (values.length !== 1) return null;
  const match = /^v1\.([0-9a-f]{64})\.([0-9a-f]{64})$/.exec(
    values[0].slice(cookieName.length + 1),
  );
  if (!match || !equalDigest(match[2], digest(secret, "checkout-cookie-v1", match[1])))
    return null;
  return digest(secret, "checkout-owner-v1", match[1]);
}
export function readOrIssueGuestContext(
  request: Request,
  secret = getCheckoutIdentitySecret(),
): { contextHash: string; setCookie?: string } {
  const existing = readGuestContext(request, secret);
  if (existing) return { contextHash: existing };
  const nonce = randomBytes(32).toString("hex");
  return {
    contextHash: digest(secret, "checkout-owner-v1", nonce),
    setCookie:
      cookieName +
      "=v1." +
      nonce +
      "." +
      digest(secret, "checkout-cookie-v1", nonce) +
      "; Path=/; Secure; HttpOnly; SameSite=Lax",
  };
}
export function verifyGuestPreparationReuse(
  order: { userId: string | null; guestContextHash: string | null },
  contextHash: string,
): boolean {
  return (
    order.userId === null &&
    !!order.guestContextHash &&
    equalDigest(order.guestContextHash, contextHash)
  );
}
