import type { PaymentLinkRequest } from "@/lib/checkout/payment-link-request";
import type { ResolvedCheckoutItem } from "@/lib/checkout/checkout-cart-resolver";
import type { ShippingDefaultsRepository } from "@/repositories/shipping-defaults-repo";

export type CheckoutPricingQuoteInput = {
  tenantId: string;
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
  quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>;
};

export class CheckoutPricingUnavailableError extends Error {
  readonly category: string | null;

  constructor(category: string | null = null) {
    super("checkout_pricing_unavailable");
    this.name = "CheckoutPricingUnavailableError";
    this.category = category;
  }
}

type ShippingDefaultsReader = Pick<ShippingDefaultsRepository, "getByCategories">;

export function createCheckoutPricingGateway(
  repository: ShippingDefaultsReader,
): CheckoutPricingGateway {
  return {
    quote: async (input) => {
      const customerState = input.shippingAddress?.state ?? "SC";

      if (input.fulfillment === "pickup") {
        return {
          shippingCents: 0,
          taxCents: 0,
          taxCalculationId: "square:pending",
          customerState,
        };
      }

      const categories = [...new Set(input.items.map(({ category }) => category))];
      const rows = await repository.getByCategories(input.tenantId, categories);
      const prices = new Map(rows.map((row) => [row.category, row.shipping_cost_cents]));
      let shippingCents = 0;

      for (const category of categories) {
        const cents = prices.get(category);
        if (cents === undefined || !Number.isSafeInteger(cents) || cents < 0) {
          throw new CheckoutPricingUnavailableError(category);
        }
        shippingCents = Math.max(shippingCents, cents);
      }

      return {
        shippingCents,
        taxCents: 0,
        taxCalculationId: "square:pending",
        customerState,
      };
    },
  };
}
