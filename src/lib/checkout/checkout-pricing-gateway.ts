import type { PaymentLinkRequest } from "@/lib/checkout/payment-link-request";
import type { ResolvedCheckoutItem } from "@/lib/checkout/checkout-cart-resolver";
import type {
  CheckoutSettings,
  CheckoutSettingsRepository,
} from "@/repositories/checkout-settings-repo";

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
  assertReady(tenantId: string): Promise<void>;
  quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>;
};

export class CheckoutPricingUnavailableError extends Error {
  constructor() {
    super("checkout_pricing_unavailable");
  }
}

type CheckoutSettingsReader = Pick<CheckoutSettingsRepository, "getByTenant">;

async function requireSettings(
  repository: CheckoutSettingsReader,
  tenantId: string,
): Promise<CheckoutSettings> {
  const settings = await repository.getByTenant(tenantId);
  if (!settings) {
    throw new CheckoutPricingUnavailableError();
  }
  return settings;
}

export function createCheckoutPricingGateway(
  repository: CheckoutSettingsReader,
): CheckoutPricingGateway {
  return {
    assertReady: async (tenantId) => {
      await requireSettings(repository, tenantId);
    },
    quote: async (input) => {
      const settings = await requireSettings(repository, input.tenantId);
      const customerState = input.shippingAddress?.state ?? "SC";

      return {
        shippingCents: input.fulfillment === "ship" ? settings.flatShippingCents : 0,
        taxCents: 0,
        taxCalculationId: "square:pending",
        customerState,
      };
    },
  };
}
