import { z } from "zod";
import { prepareCheckoutRequestSchema } from "@/lib/checkout/checkout-request";
import { originalRecoveryContext } from "./client-session";

const originalFields = new Set([
  "items",
  "fulfillment",
  "buyerEmail",
  "paymentMethod",
  "shippingAddress",
  "billingAddress",
  "pickupContact",
  "quoteFingerprint",
]);
const recoveryFailure =
  "Open the secure order link in your email or check your account to find your original order.";
export async function recoverOriginalOrder(
  ownerId: string | null,
  requireOwner: () => Promise<void>,
  signal: AbortSignal,
): Promise<{ orderId: string; transientGuestAccessToken?: string }> {
  await requireOwner();
  const original = originalRecoveryContext(ownerId);
  if (!original || !original.current() || signal.aborted) throw Error(recoveryFailure);
  if (original.orderId) return { orderId: original.orderId };
  const saved: unknown = JSON.parse(original.fingerprint);
  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved) ||
    Object.keys(saved).some((key) => !originalFields.has(key))
  )
    throw Error(recoveryFailure);
  const payload = prepareCheckoutRequestSchema.safeParse({
    ...saved,
    idempotencyKey: original.key,
    deviceSessionId: original.device,
    recoveryOnly: true,
  });
  if (!payload.success) throw Error(recoveryFailure);
  const response = await fetch("/api/checkout/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload.data),
    signal,
  });
  const data = await response.json().catch(() => null);
  await requireOwner();
  if (
    signal.aborted ||
    !original.current() ||
    !response.ok ||
    data?.code !== "CHECKOUT_RECOVERY_REQUIRED" ||
    !z.uuid().safeParse(data.orderId).success ||
    (ownerId === null &&
      (typeof data.guestAccessToken !== "string" || !data.guestAccessToken.trim()))
  )
    throw Error(recoveryFailure);
  return original.accept(
    data.orderId,
    ownerId === null ? data.guestAccessToken : undefined,
  );
}
