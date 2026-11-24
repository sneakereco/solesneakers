import { createHash, createHmac } from "node:crypto";

import type { PaymentPermitPayload } from "@/lib/checkout/payment-permit";
import type { createCheckoutCartHash } from "@/lib/checkout/checkout-cart-hash";

export function futurePermitFixture(legacy: PaymentPermitPayload) {
  const { tenantId: _tenantId, ...bindings } = legacy;
  return { version: 2, ...bindings };
}

// Test-only future producer: explicit domain, no tenant, unchanged address key.
export function futureShippingFixture(
  scope: {
    deviceSessionId: string;
    normalizedEmailHash: string;
    paymentMethod: string;
    address: {
      line1: string;
      line2?: string | null;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
  },
  secret: string,
  expires: number,
) {
  const addressKey = JSON.stringify(
    [
      scope.address.line1,
      scope.address.line2,
      scope.address.city,
      scope.address.state,
      scope.address.postalCode,
      scope.address.country,
    ].map((value) => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase()),
  );
  const signature = createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "shipping-address-confirmation-v2",
        scope.deviceSessionId,
        scope.normalizedEmailHash,
        scope.paymentMethod,
        addressKey,
        expires,
      ]),
    )
    .digest("hex");
  return `v2.${expires}.${signature}`;
}

// Test-only future producer: v3 canonical ordering with version 4 and no tenant.
export function futureCartHashFixture(
  input: Parameters<typeof createCheckoutCartHash>[0],
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
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
      }),
      "utf8",
    )
    .digest("hex");
}

// In-memory Redis boundary, including TTL and GET+DEL semantics; no provider I/O.
export function permitRedisFixture() {
  const entries = new Map<string, { value: unknown; expires: number }>();
  let clock = 0;
  return {
    advance(milliseconds: number) {
      clock += milliseconds;
    },
    seed(token: string, value: unknown, ttlSeconds = 120) {
      entries.set(`rdk:checkout:payment-permit:${token}`, {
        value,
        expires: clock + ttlSeconds * 1000,
      });
    },
    set: jest.fn((key: string, value: string, options: { nx: true; ex: number }) => {
      if (entries.has(key)) {
        return Promise.resolve(null);
      }
      entries.set(key, { value, expires: clock + options.ex * 1000 });
      return Promise.resolve("OK");
    }),
    eval: jest.fn((script: string, keys: string[], _args: string[]) => {
      if (
        !script.includes('redis.call("GET", KEYS[1])') ||
        !script.includes('redis.call("DEL", KEYS[1])')
      ) {
        throw new Error("fixture requires atomic GET+DEL script");
      }
      const entry = entries.get(keys[0]);
      entries.delete(keys[0]);
      return Promise.resolve(entry && entry.expires > clock ? entry.value : null);
    }),
  };
}
