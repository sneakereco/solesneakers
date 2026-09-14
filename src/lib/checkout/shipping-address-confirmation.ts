import { createHmac, timingSafeEqual } from "node:crypto";

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
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match) {
    return false;
  }
  const expires = Number(match[1]);
  if (expires <= now.getTime() || expires > now.getTime() + 10 * 60 * 1000) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(match[2], "hex"),
    Buffer.from(signature(scope, expires, secret), "hex"),
  );
}
