import { US_STATE_OPTIONS } from "@/components/checkout/us-state-options";
import type { CheckoutPaymentAddress } from "@/components/checkout/SquarePaymentMethods";
import type { ExactCheckoutQuote } from "@/lib/checkout/checkout-request";

export type AfterpayCheckoutContext = {
  fulfillment: "ship" | "pickup";
  quote: ExactCheckoutQuote;
  shippingAddress: CheckoutPaymentAddress | null;
  fullAddressConfirmed?: boolean;
};

function normalized(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ")
    : "";
}

export function matchesAfterpayAddress(
  value: unknown,
  expected: CheckoutPaymentAddress,
  allowRedacted = false,
): boolean {
  if (!value || typeof value !== "object") return false;
  const contact = value as Record<string, unknown>;
  const state = normalized(contact.state);
  const stateCode = US_STATE_OPTIONS.find(
    ([code, name]) => code === state || name.toUpperCase() === state,
  )?.[0];
  const postalCode = normalized(contact.postalCode);
  if (
    normalized(contact.countryCode) !== "US" ||
    stateCode !== expected.state ||
    !/^\d{5}(-\d{4})?$/.test(postalCode)
  )
    return false;
  // ZIP+4 may be shortened by the provider; two supplied extensions must agree.
  if (
    postalCode.slice(0, 5) !== expected.postalCode.slice(0, 5) ||
    (postalCode.length > 5 &&
      expected.postalCode.length > 5 &&
      postalCode !== expected.postalCode)
  )
    return false;
  const lines = contact.addressLines;
  if (!allowRedacted || lines !== undefined) {
    if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string"))
      return false;
    if (
      normalized(lines[0]) !== normalized(expected.line1) ||
      normalized(lines.slice(1).join(" ")) !== normalized(expected.line2)
    )
      return false;
  }
  if (!allowRedacted || contact.city !== undefined) {
    if (normalized(contact.city) !== normalized(expected.city)) return false;
  }
  return true;
}

export function afterpayShippingUpdate(
  context: AfterpayCheckoutContext | null,
  value: unknown,
) {
  if (
    !context ||
    (context.fulfillment === "ship" &&
      (!context.shippingAddress ||
        !matchesAfterpayAddress(value, context.shippingAddress, true)))
  ) {
    return { error: "Use the shipping address confirmed on the checkout page." };
  }
  const pickup = context.fulfillment === "pickup";
  return {
    shippingOptions: [
      {
        id: pickup ? "PICKUP" : "STANDARD",
        label: pickup ? "Pickup by appointment" : "Standard shipping",
        amount: pickup ? "0.00" : (context.quote.totals.shippingCents / 100).toFixed(2),
        taxLineItems: [
          { label: "Tax", amount: (context.quote.totals.taxCents / 100).toFixed(2) },
        ],
        total: {
          label: "Total",
          amount: (context.quote.totals.totalCents / 100).toFixed(2),
        },
      },
    ],
  };
}
