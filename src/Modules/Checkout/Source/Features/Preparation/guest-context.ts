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
// Multiple initial responses can arrive after an order has already been bound.
const maxProofs = 16;
export class GuestContextLimit extends Error {}
export function readGuestContexts(
  request: Request,
  secret = getCheckoutIdentitySecret(),
): string[] {
  const header = request.headers.get("cookie") ?? "";
  if (Buffer.byteLength(header) > 16384) throw new GuestContextLimit();
  const contexts = new Set<string>(),
    names = new Set<string>();
  let candidates = 0;
  for (const entry of header.split(";")) {
    const part = entry.trim(),
      separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator);
    if (name !== cookieName && !name.startsWith(cookieName + "-")) continue;
    if (++candidates > maxProofs || names.has(name)) throw new GuestContextLimit();
    names.add(name);
    const value = /^(v[12])\.([0-9a-f]{64})\.([0-9a-f]{64})$/.exec(
      part.slice(separator + 1),
    );
    if (!value) continue;
    const [, version, nonce, signature] = value;
    const legacy = version === "v1";
    if (name !== (legacy ? cookieName : cookieName + "-" + nonce)) continue;
    if (
      equalDigest(
        signature,
        digest(secret, legacy ? "checkout-cookie-v1" : "checkout-cookie-v2", nonce),
      )
    )
      contexts.add(digest(secret, "checkout-owner-v1", nonce));
  }
  if (candidates === maxProofs && contexts.size === 0) throw new GuestContextLimit();
  return [...contexts];
}
export function readGuestContext(
  request: Request,
  secret = getCheckoutIdentitySecret(),
): string | null {
  return readGuestContexts(request, secret)[0] ?? null;
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
      "-" +
      nonce +
      "=v2." +
      nonce +
      "." +
      digest(secret, "checkout-cookie-v2", nonce) +
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
