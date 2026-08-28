import {
  CheckoutPricingUnavailableError,
  createCheckoutPricingGateway,
} from "@/lib/checkout/checkout-pricing-gateway";

describe("createCheckoutPricingGateway", () => {
  it("fails closed until an approved tax provider and shipping policy are configured", async () => {
    const gateway = createCheckoutPricingGateway();

    await expect(gateway.assertReady()).rejects.toBeInstanceOf(
      CheckoutPricingUnavailableError,
    );
    await expect(
      gateway.quote({
        fulfillment: "pickup",
        shippingAddress: null,
        subtotalCents: 10000,
        items: [],
      }),
    ).rejects.toBeInstanceOf(CheckoutPricingUnavailableError);
  });
});
