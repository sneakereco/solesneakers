export function checkoutStatusLabel(
  status: string | null | undefined,
  failureReason?: string | null,
  expiresAt?: string | null,
  now = Date.now(),
): string | null {
  if (status === "canceled")
    return failureReason === "checkout_expired" ? "Checkout expired" : "Canceled";
  if (status === "pending")
    return expiresAt && Date.parse(expiresAt) <= now
      ? "Payment window expired · awaiting verification"
      : "Checkout pending";
  return null;
}
