import { createHmac, timingSafeEqual } from "node:crypto";

import {
  shippingAddressKey,
  type ShippingAddress,
} from "@/lib/checkout/shipping-address-validation";

export type ShippingConfirmationScope = {
  tenantId: string;
  deviceSessionId: string;
  normalizedEmailHash: string;
  paymentMethod: string;
  address: ShippingAddress;
};

export function verifyCompatibleShippingConfirmation(
  token: string,
  scope: ShippingConfirmationScope,
  secret: string,
  now: Date,
): boolean {
  const match = /^(?:(v2)\.)?(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match) {
    return false;
  }
  const expires = Number(match[2]);
  if (expires <= now.getTime() || expires > now.getTime() + 10 * 60 * 1000) {
    return false;
  }
  if (!secret) {
    throw new Error("shipping_confirmation_secret_missing");
  }
  const domain = match[1]
    ? ["shipping-address-confirmation-v2"]
    : ["shipping-address-confirmation-v1", scope.tenantId];
  const signature = createHmac("sha256", secret)
    .update(
      JSON.stringify([
        ...domain,
        scope.deviceSessionId,
        scope.normalizedEmailHash,
        scope.paymentMethod,
        shippingAddressKey(scope.address),
        expires,
      ]),
    )
    .digest();
  return timingSafeEqual(Buffer.from(match[3], "hex"), signature);
}
