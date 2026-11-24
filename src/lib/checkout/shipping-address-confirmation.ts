import { createHmac } from "node:crypto";
import { verifyCompatibleShippingConfirmation } from "@/Modules/Checkout/Source/Features/ContractCompatibility/shipping-confirmation-reader";

import {
  shippingAddressKey,
  type ShippingAddress,
} from "@/lib/checkout/shipping-address-validation";

type ConfirmationScope = {
  tenantId: string;
  deviceSessionId: string;
  normalizedEmailHash: string;
  paymentMethod: string;
  address: ShippingAddress;
};

function signature(scope: ConfirmationScope, expires: number, secret: string) {
  if (!secret) {
    throw new Error("shipping_confirmation_secret_missing");
  }
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "shipping-address-confirmation-v1",
        scope.tenantId,
        scope.deviceSessionId,
        scope.normalizedEmailHash,
        scope.paymentMethod,
        shippingAddressKey(scope.address),
        expires,
      ]),
    )
    .digest("hex");
}

export function issueShippingConfirmation(
  scope: ConfirmationScope,
  secret: string,
  now: Date,
): string {
  const expires = now.getTime() + 10 * 60 * 1000;
  return `${expires}.${signature(scope, expires, secret)}`;
}

export function verifyShippingConfirmation(
  token: string,
  scope: ConfirmationScope,
  secret: string,
  now: Date,
): boolean {
  return verifyCompatibleShippingConfirmation(token, scope, secret, now);
}
