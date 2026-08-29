import {
  CheckoutPricingUnavailableError,
  createCheckoutPricingGateway,
} from "@/lib/checkout/checkout-pricing-gateway";

describe("createCheckoutPricingGateway", () => {
  it("fails closed until the database flat rate is configured", async () => {
    const gateway = createCheckoutPricingGateway({
      getByTenant: jest.fn().mockResolvedValue(null),
    });

    await expect(gateway.assertReady("tenant-1")).rejects.toBeInstanceOf(
      CheckoutPricingUnavailableError,
    );
    await expect(
      gateway.quote({
        tenantId: "tenant-1",
        fulfillment: "pickup",
        shippingAddress: null,
        subtotalCents: 10000,
        items: [],
      }),
    ).rejects.toBeInstanceOf(CheckoutPricingUnavailableError);
  });

  it("quotes database flat-rate shipping and leaves tax for Square", async () => {
    const gateway = createCheckoutPricingGateway({
      getByTenant: jest.fn().mockResolvedValue({ flatShippingCents: 1295 }),
    });

    await expect(gateway.assertReady("tenant-1")).resolves.toBeUndefined();
    await expect(
      gateway.quote({
        tenantId: "tenant-1",
        fulfillment: "ship",
        shippingAddress: {
          name: "Buyer",
          phone: null,
          line1: "1 Main Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
        subtotalCents: 10000,
        items: [],
      }),
    ).resolves.toEqual({
      shippingCents: 1295,
      taxCents: 0,
      taxCalculationId: "square:pending",
      customerState: "SC",
    });
  });

  it("does not charge shipping for pickup", async () => {
    const gateway = createCheckoutPricingGateway({
      getByTenant: jest.fn().mockResolvedValue({ flatShippingCents: 1295 }),
    });

    await expect(
      gateway.quote({
        tenantId: "tenant-1",
        fulfillment: "pickup",
        shippingAddress: null,
        subtotalCents: 10000,
        items: [],
      }),
    ).resolves.toMatchObject({ shippingCents: 0, taxCents: 0 });
  });
});
