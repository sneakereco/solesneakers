import type { PaymentLinkRequest } from "@/lib/checkout/payment-link-request";
import type { ResolvedCheckoutItem } from "@/lib/checkout/checkout-cart-resolver";

export type CheckoutPricingQuoteInput = {
  fulfillment: PaymentLinkRequest["fulfillment"];
  shippingAddress: PaymentLinkRequest["shippingAddress"] | null;
  subtotalCents: number;
  items: ResolvedCheckoutItem[];
};

export type CheckoutPricingQuote = {
  shippingCents: number;
  taxCents: number;
  taxCalculationId: string;
  customerState: string;
};

export type CheckoutPricingGateway = {
  assertReady(): Promise<void>;
  quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>;
};

export class CheckoutPricingUnavailableError extends Error {
  constructor() {
    super("checkout_pricing_unavailable");
  }
}

export function createCheckoutPricingGateway(): CheckoutPricingGateway {
  return {
    assertReady: () => Promise.reject(new CheckoutPricingUnavailableError()),
    quote: () => Promise.reject(new CheckoutPricingUnavailableError()),
  };
}
