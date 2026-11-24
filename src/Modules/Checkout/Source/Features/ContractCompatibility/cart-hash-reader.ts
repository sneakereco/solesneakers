import { createHash } from "node:crypto";

import type { createCheckoutCartHash } from "@/lib/checkout/checkout-cart-hash";

export function matchesCheckoutCartHash(
  stored: string,
  legacyHash: string,
  input: Parameters<typeof createCheckoutCartHash>[0],
): boolean {
  if (stored === legacyHash) {
    return true;
  }
  const canonical = JSON.stringify({
    version: 4,
    buyerEmail: input.buyerEmail,
    fulfillment: input.fulfillment,
    paymentMethod: input.paymentMethod,
    shippingAddress: input.shippingAddress ?? null,
    billingAddress: input.billingAddress ?? null,
    pickupContact: input.pickupContact
      ? { name: input.pickupContact.name, phone: input.pickupContact.phone }
      : null,
    items: [...input.items].sort((left, right) =>
      `${left.productId}:${left.variantId}`.localeCompare(
        `${right.productId}:${right.variantId}`,
      ),
    ),
  });
  return stored === createHash("sha256").update(canonical, "utf8").digest("hex");
}
