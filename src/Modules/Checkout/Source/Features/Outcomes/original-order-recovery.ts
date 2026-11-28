import { z } from "zod";
import { prepareCheckoutRequestSchema } from "@/lib/checkout/checkout-request";
import {
  observePreparedCheckout,
  originalRecoveryContext,
  readGuestOrderAccess,
} from "./client-session";
import { withRequestDeadline } from "@/lib/http/request-deadline";

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

function recoveryPayload(original: {
  fingerprint: string;
  key: string;
  device: string | null;
}) {
  const saved: unknown = JSON.parse(original.fingerprint);
  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved) ||
    Object.keys(saved).some((key) => !originalFields.has(key))
  )
    throw Error(recoveryFailure);
  return prepareCheckoutRequestSchema.parse({
    ...saved,
    idempotencyKey: original.key,
    deviceSessionId: original.device,
    recoveryOnly: true,
  });
}

export function originalPaymentRetryContext(ownerId: string | null) {
  const original = observePreparedCheckout(ownerId);
  if (!original) return null;
  try {
    return { ...original, payload: recoveryPayload(original) };
  } catch {
    return null;
  }
}

const cents = z.number().int().nonnegative();
const originalRetryReply = z.object({
  code: z.literal("CHECKOUT_RECOVERY_REQUIRED"),
  orderId: z.uuid(),
  totals: z.object({
    subtotalCents: cents,
    shippingCents: cents,
    taxCents: cents,
    totalCents: cents,
  }),
  originalRetry: z.object({
    expiresAt: z.iso.datetime(),
    lines: z
      .array(
        z.object({
          productId: z.uuid(),
          variantId: z.uuid(),
          quantity: z.number().int().positive(),
          unitPriceCents: cents,
        }),
      )
      .min(1)
      .max(10),
  }),
});

export async function lookupOriginalPaymentRetry(
  original: NonNullable<ReturnType<typeof originalPaymentRetryContext>>,
  signal: AbortSignal,
) {
  const reply = await withRequestDeadline(async (requestSignal) => {
    const response = await fetch("/api/checkout/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(original.payload),
      signal: requestSignal,
    });
    return response.ok ? response.json() : null;
  }, signal);
  const parsed = originalRetryReply.safeParse(reply);
  if (!parsed.success || parsed.data.orderId !== original.scope.orderId) return null;
  const expiresAt = Date.parse(parsed.data.originalRetry.expiresAt);
  if (signal.aborted || !original.current() || expiresAt <= Date.now()) return null;
  return {
    ...original,
    expiresAt,
    lines: parsed.data.originalRetry.lines,
    quote: {
      completeness: "exact" as const,
      quoteFingerprint: original.payload.quoteFingerprint,
      totals: parsed.data.totals,
    },
  };
}
export async function recoverOriginalOrder(
  ownerId: string | null,
  requireOwner: () => Promise<void>,
  signal: AbortSignal,
): Promise<{ orderId: string; transientGuestAccessToken?: string }> {
  await requireOwner();
  const original = originalRecoveryContext(ownerId);
  if (!original || !original.current() || signal.aborted) throw Error(recoveryFailure);
  if (original.orderId && (ownerId !== null || readGuestOrderAccess(original.orderId)))
    return { orderId: original.orderId };
  let payload;
  try {
    payload = recoveryPayload(original);
  } catch {
    throw Error(recoveryFailure);
  }
  const { response, data } = await withRequestDeadline(async (requestSignal) => {
    const reply = await fetch("/api/checkout/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: requestSignal,
    });
    const body = await reply.json().catch(() => null);
    return { response: reply, data: body };
  }, signal);
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
