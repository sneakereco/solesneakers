import { createHash } from "node:crypto";

import type { PrepareCheckoutRequest } from "@/lib/checkout/checkout-request";

type CheckoutCartHashInput = Pick<
  PrepareCheckoutRequest,
  | "items"
  | "fulfillment"
  | "paymentMethod"
  | "shippingAddress"
  | "billingAddress"
  | "pickupContact"
> & {
  tenantId: string;
  buyerEmail: string;
};

export function createCheckoutCartHash(input: CheckoutCartHashInput): string {
  const items = [...input.items].sort((left, right) => {
    const leftKey = `${left.productId}:${left.variantId}`;
    const rightKey = `${right.productId}:${right.variantId}`;
    return leftKey.localeCompare(rightKey);
  });

  const canonical = JSON.stringify({
    version: 3,
    tenantId: input.tenantId,
    buyerEmail: input.buyerEmail,
    fulfillment: input.fulfillment,
    paymentMethod: input.paymentMethod,
    shippingAddress: input.shippingAddress ?? null,
    billingAddress: input.billingAddress ?? null,
    pickupContact: input.pickupContact
      ? { name: input.pickupContact.name, phone: input.pickupContact.phone }
      : null,
    items,
  });

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
