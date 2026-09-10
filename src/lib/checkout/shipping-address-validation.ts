import type { PrepareCheckoutRequest } from "@/lib/checkout/checkout-request";

export type ShippingAddress = NonNullable<PrepareCheckoutRequest["shippingAddress"]>;
export type ShippingValidationResult =
  | { status: "valid" | "invalid" | "unavailable" }
  | { status: "suggestion"; address: ShippingAddress };

export function shippingAddressKey(address: ShippingAddress): string {
  return JSON.stringify(
    [
      address.line1,
      address.line2,
      address.city,
      address.state,
      address.postalCode,
      address.country,
    ].map((value) => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase()),
  );
}

export class ShippingAddressValidationError extends Error {
  constructor(
    message: string,
    readonly enteredAddress: ShippingAddress,
    readonly suggestedAddress?: ShippingAddress,
  ) {
    super(message);
    this.name = "ShippingAddressValidationError";
  }
}
