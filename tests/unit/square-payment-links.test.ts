import { SquarePaymentLinksGateway } from "@/lib/square/payment-links";

describe("SquarePaymentLinksGateway", () => {
  it("creates an externally-priced hosted checkout with tipping, coupons, and Afterpay disabled", async () => {
    const create = jest.fn().mockResolvedValue({
      paymentLink: {
        id: "link-1",
        orderId: "square-order-1",
        url: "https://sandbox.square.link/u/example",
      },
      relatedResources: {
        orders: [
          {
            id: "square-order-1",
            version: 1,
            totalMoney: { amount: BigInt(28563), currency: "USD" },
            totalTaxMoney: { amount: BigInt(2063), currency: "USD" },
            totalServiceChargeMoney: { amount: BigInt(1500), currency: "USD" },
          },
        ],
      },
    });
    const gateway = new SquarePaymentLinksGateway(
      { create, delete: jest.fn() },
      "square-location-1",
    );

    await expect(
      gateway.create({
        localOrderId: "4a57e953-80dd-4609-970f-31984acfe810",
        tenantId: "e135f553-f303-4573-a556-133075deee62",
        idempotencyKey: "checkout-attempt-1",
        fulfillment: "ship",
        buyerEmail: "buyer@example.com",
        redirectUrl:
          "https://shop.example.com/checkout/processing?orderId=4a57e953-80dd-4609-970f-31984acfe810",
        subtotalCents: 25000,
        shippingCents: 1500,
        shippingAddress: {
          name: "Buyer Example",
          phone: "8435550100",
          line1: "1 Main Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
        items: [
          {
            productId: "product-1",
            variantId: "variant-1",
            quantity: 1,
            unitPriceCents: 25000,
            unitCostCents: 15000,
            lineTotalCents: 25000,
            variantSku: "SKU-1",
            productName: "Air Runner",
            brand: "Sole",
            model: "One",
            category: "shoes",
            condition: "new",
            sizeLabel: "10",
          },
        ],
      }),
    ).resolves.toEqual({
      id: "link-1",
      orderId: "square-order-1",
      url: "https://sandbox.square.link/u/example",
      taxCents: 2063,
      shippingCents: 1500,
      totalCents: 28563,
      taxCalculationId: "square:square-order-1:v1",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "checkout-attempt-1",
        order: {
          locationId: "square-location-1",
          referenceId: "4a57e953-80dd-4609-970f-31984acfe810",
          lineItems: [
            expect.objectContaining({
              name: "Air Runner - 10",
              quantity: "1",
              basePriceMoney: { amount: BigInt(25000), currency: "USD" },
            }),
          ],
          pricingOptions: {
            autoApplyTaxes: true,
            autoApplyDiscounts: false,
          },
        },
        checkoutOptions: expect.objectContaining({
          allowTipping: false,
          askForShippingAddress: true,
          enableCoupon: false,
          enableLoyalty: false,
          acceptedPaymentMethods: expect.objectContaining({
            afterpayClearpay: false,
          }),
          shippingFee: {
            name: "Shipping",
            charge: { amount: BigInt(1500), currency: "USD" },
          },
        }),
        prePopulatedData: { buyerEmail: "buyer@example.com" },
      }),
    );
  });

  it("omits shipping collection and fees for pickup", async () => {
    const create = jest.fn().mockResolvedValue({
      paymentLink: {
        id: "link-2",
        orderId: "square-order-2",
        url: "https://square.link/u/example",
      },
      relatedResources: {
        orders: [
          {
            id: "square-order-2",
            version: 2,
            totalMoney: { amount: BigInt(5000), currency: "USD" },
            totalTaxMoney: { amount: BigInt(0), currency: "USD" },
            totalServiceChargeMoney: { amount: BigInt(0), currency: "USD" },
          },
        ],
      },
    });
    const gateway = new SquarePaymentLinksGateway(
      { create, delete: jest.fn() },
      "square-location-1",
    );

    await gateway.create({
      localOrderId: "local-order-2",
      tenantId: "tenant-1",
      idempotencyKey: "checkout-attempt-2",
      fulfillment: "pickup",
      buyerEmail: null,
      redirectUrl: "https://shop.example.com/checkout/processing",
      subtotalCents: 5000,
      shippingCents: 0,
      shippingAddress: null,
      items: [
        {
          productId: "product-2",
          variantId: "variant-2",
          quantity: 1,
          unitPriceCents: 5000,
          unitCostCents: 3000,
          lineTotalCents: 5000,
          variantSku: "SKU-2",
          productName: "Pickup Item",
          brand: "Sole",
          model: null,
          category: "shoes",
          condition: "new",
          sizeLabel: "9",
        },
      ],
    });

    const request = create.mock.calls[0]?.[0];
    expect(request.checkoutOptions.askForShippingAddress).toBe(false);
    expect(request.checkoutOptions.shippingFee).toBeUndefined();
    expect(request.order.lineItems[0].basePriceMoney.amount).toBe(BigInt(5000));
    expect(request.prePopulatedData).toBeUndefined();
  });

  it("rejects a non-Square redirect returned by the provider", async () => {
    const create = jest.fn().mockResolvedValue({
      paymentLink: {
        id: "link-3",
        orderId: "square-order-3",
        url: "https://evil.example/steal",
      },
    });
    const gateway = new SquarePaymentLinksGateway(
      { create, delete: jest.fn() },
      "square-location-1",
    );

    await expect(
      gateway.create({
        localOrderId: "local-order-3",
        tenantId: "tenant-1",
        idempotencyKey: "checkout-attempt-3",
        fulfillment: "pickup",
        buyerEmail: null,
        redirectUrl: "https://shop.example.com/checkout/processing",
        subtotalCents: 5000,
        shippingCents: 0,
        shippingAddress: null,
        items: [
          {
            productId: "product-3",
            variantId: "variant-3",
            quantity: 1,
            unitPriceCents: 5000,
            unitCostCents: 3000,
            lineTotalCents: 5000,
            variantSku: "SKU-3",
            productName: "Item",
            brand: "Sole",
            model: null,
            category: "shoes",
            condition: "new",
            sizeLabel: "9",
          },
        ],
      }),
    ).rejects.toThrow("square_payment_link_invalid_response");
  });

  it("rejects a Square order whose returned total does not reconcile", async () => {
    const create = jest.fn().mockResolvedValue({
      paymentLink: {
        id: "link-4",
        orderId: "square-order-4",
        url: "https://square.link/u/example",
      },
      relatedResources: {
        orders: [
          {
            id: "square-order-4",
            version: 1,
            totalMoney: { amount: BigInt(9999), currency: "USD" },
            totalTaxMoney: { amount: BigInt(500), currency: "USD" },
            totalServiceChargeMoney: { amount: BigInt(0), currency: "USD" },
          },
        ],
      },
    });
    const gateway = new SquarePaymentLinksGateway(
      { create, delete: jest.fn() },
      "square-location-1",
    );

    await expect(
      gateway.create({
        localOrderId: "local-order-4",
        tenantId: "tenant-1",
        idempotencyKey: "checkout-attempt-4",
        fulfillment: "pickup",
        buyerEmail: null,
        redirectUrl: "https://shop.example.com/checkout/processing",
        subtotalCents: 5000,
        shippingCents: 0,
        shippingAddress: null,
        items: [
          {
            productId: "product-4",
            variantId: "variant-4",
            quantity: 1,
            unitPriceCents: 5000,
            unitCostCents: 3000,
            lineTotalCents: 5000,
            variantSku: "SKU-4",
            productName: "Item",
            brand: "Sole",
            model: null,
            category: "shoes",
            condition: "new",
            sizeLabel: "9",
          },
        ],
      }),
    ).rejects.toThrow("square_payment_link_total_mismatch");
  });

  it("deletes an expired hosted payment link before inventory release", async () => {
    const remove = jest.fn().mockResolvedValue({});
    const gateway = new SquarePaymentLinksGateway(
      { create: jest.fn(), delete: remove },
      "square-location-1",
    );

    await gateway.delete("link-expired");

    expect(remove).toHaveBeenCalledWith({ id: "link-expired" });
  });
});
