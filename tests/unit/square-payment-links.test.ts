import { SquarePaymentLinksGateway } from "@/lib/square/payment-links";

describe("SquarePaymentLinksGateway", () => {
  it("creates an externally-priced hosted checkout with tipping, coupons, and Afterpay disabled", async () => {
    const create = jest.fn().mockResolvedValue({
      paymentLink: {
        id: "link-1",
        orderId: "square-order-1",
        url: "https://sandbox.square.link/u/example",
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
        taxCents: 2063,
      }),
    ).resolves.toEqual({
      id: "link-1",
      orderId: "square-order-1",
      url: "https://sandbox.square.link/u/example",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "checkout-attempt-1",
        quickPay: {
          name: "Sole Sneakers order 4a57e953",
          locationId: "square-location-1",
          priceMoney: { amount: BigInt(27063), currency: "USD" },
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
      taxCents: 0,
    });

    const request = create.mock.calls[0]?.[0];
    expect(request.checkoutOptions.askForShippingAddress).toBe(false);
    expect(request.checkoutOptions.shippingFee).toBeUndefined();
    expect(request.quickPay.priceMoney.amount).toBe(BigInt(5000));
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
        taxCents: 0,
      }),
    ).rejects.toThrow("square_payment_link_invalid_response");
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
