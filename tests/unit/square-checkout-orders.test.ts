import { SquareCheckoutOrdersGateway } from "@/lib/square/checkout-orders";

const item = {
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
};

const shippingAddress = {
  name: "Buyer Example",
  phone: "8435550100",
  line1: "1 Main Street",
  line2: null,
  city: "Charleston",
  state: "SC",
  postalCode: "29401",
  country: "US" as const,
};

describe("SquareCheckoutOrdersGateway", () => {
  it("calculates an order without creating it", async () => {
    const calculate = jest.fn().mockResolvedValue({
      order: {
        totalMoney: { amount: BigInt(28_563), currency: "USD" },
        totalTaxMoney: { amount: BigInt(2_063), currency: "USD" },
        totalServiceChargeMoney: { amount: BigInt(1_500), currency: "USD" },
      },
    });
    const create = jest.fn();
    const gateway = new SquareCheckoutOrdersGateway(
      { calculate, create, get: jest.fn(), update: jest.fn() },
      "square-location-1",
    );

    await expect(
      gateway.calculate({
        fulfillment: "ship",
        buyerEmail: "buyer@example.com",
        subtotalCents: 25_000,
        shippingCents: 1_500,
        shippingAddress,
        items: [item],
      }),
    ).resolves.toEqual({
      subtotalCents: 25_000,
      shippingCents: 1_500,
      taxCents: 2_063,
      totalCents: 28_563,
    });
    expect(create).not.toHaveBeenCalled();
    expect(calculate).toHaveBeenCalledWith({
      order: expect.objectContaining({
        locationId: "square-location-1",
        referenceId: undefined,
        pricingOptions: { autoApplyTaxes: true, autoApplyDiscounts: false },
      }),
    });
  });

  it("creates an automatically taxed shipping order from server prices", async () => {
    const create = jest.fn().mockResolvedValue({
      order: {
        id: "square-order-1",
        version: 1,
        totalMoney: { amount: BigInt(28563), currency: "USD" },
        totalTaxMoney: { amount: BigInt(2063), currency: "USD" },
        totalServiceChargeMoney: { amount: BigInt(1500), currency: "USD" },
      },
    });
    const gateway = new SquareCheckoutOrdersGateway(
      { calculate: jest.fn(), create, get: jest.fn(), update: jest.fn() },
      "square-location-1",
    );

    await expect(
      gateway.create({
        localOrderId: "4a57e953-80dd-4609-970f-31984acfe810",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        fulfillment: "ship",
        buyerEmail: "buyer@example.com",
        subtotalCents: 25000,
        shippingCents: 1500,
        shippingAddress,
        items: [item],
      }),
    ).resolves.toEqual({
      id: "square-order-1",
      version: 1,
      subtotalCents: 25000,
      shippingCents: 1500,
      taxCents: 2063,
      totalCents: 28563,
      taxCalculationId: "square:square-order-1:v1",
    });

    expect(create).toHaveBeenCalledWith({
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      order: expect.objectContaining({
        locationId: "square-location-1",
        referenceId: "4a57e953-80dd-4609-970f-31984acfe810",
        lineItems: [
          expect.objectContaining({
            name: "Air Runner - 10",
            quantity: "1",
            basePriceMoney: { amount: BigInt(25000), currency: "USD" },
          }),
        ],
        serviceCharges: [
          expect.objectContaining({
            name: "Shipping",
            amountMoney: { amount: BigInt(1500), currency: "USD" },
          }),
        ],
        fulfillments: [
          expect.objectContaining({
            type: "SHIPMENT",
            shipmentDetails: {
              recipient: expect.objectContaining({
                displayName: "Buyer Example",
                emailAddress: "buyer@example.com",
                address: expect.objectContaining({ postalCode: "29401" }),
              }),
            },
          }),
        ],
        pricingOptions: { autoApplyTaxes: true, autoApplyDiscounts: false },
      }),
    });
  });

  it("creates pickup without shipping charges", async () => {
    const create = jest.fn().mockResolvedValue({
      order: {
        id: "square-order-2",
        version: 2,
        totalMoney: { amount: BigInt(25000), currency: "USD" },
        totalTaxMoney: { amount: BigInt(0), currency: "USD" },
        totalServiceChargeMoney: { amount: BigInt(0), currency: "USD" },
      },
    });
    const gateway = new SquareCheckoutOrdersGateway(
      { calculate: jest.fn(), create, get: jest.fn(), update: jest.fn() },
      "square-location-1",
    );

    await gateway.create({
      localOrderId: "local-order-2",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      fulfillment: "pickup",
      buyerEmail: "buyer@example.com",
      subtotalCents: 25000,
      shippingCents: 0,
      shippingAddress: null,
      items: [item],
    });

    const order = create.mock.calls[0]?.[0].order;
    expect(order.serviceCharges).toBeUndefined();
    expect(order.fulfillments).toEqual([
      expect.objectContaining({
        type: "PICKUP",
        pickupDetails: {
          scheduleType: "ASAP",
          prepTimeDuration: "PT0S",
        },
      }),
    ]);
  });

  it("rejects a provider total that does not reconcile", async () => {
    const gateway = new SquareCheckoutOrdersGateway(
      {
        calculate: jest.fn(),
        create: jest.fn().mockResolvedValue({
          order: {
            id: "square-order-3",
            version: 1,
            totalMoney: { amount: BigInt(9999), currency: "USD" },
            totalTaxMoney: { amount: BigInt(500), currency: "USD" },
            totalServiceChargeMoney: { amount: BigInt(0), currency: "USD" },
          },
        }),
        get: jest.fn(),
        update: jest.fn(),
      },
      "square-location-1",
    );

    await expect(
      gateway.create({
        localOrderId: "local-order-3",
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        fulfillment: "pickup",
        buyerEmail: "buyer@example.com",
        subtotalCents: 25000,
        shippingCents: 0,
        shippingAddress: null,
        items: [item],
      }),
    ).rejects.toThrow("square_checkout_order_total_mismatch");
  });

  it("cancels an unpaid order using optimistic concurrency", async () => {
    const update = jest.fn().mockResolvedValue({
      order: { id: "square-order-1", state: "CANCELED", version: 4 },
    });
    const gateway = new SquareCheckoutOrdersGateway(
      { calculate: jest.fn(), create: jest.fn(), get: jest.fn(), update },
      "square-location-1",
    );

    await gateway.cancel("square-order-1", 3, "cancel-idempotency-key");

    expect(update).toHaveBeenCalledWith({
      orderId: "square-order-1",
      idempotencyKey: "cancel-idempotency-key",
      order: {
        locationId: "square-location-1",
        version: 3,
        state: "CANCELED",
      },
    });
  });

  it("loads the current order state and version before expiration", async () => {
    const get = jest.fn().mockResolvedValue({
      order: {
        id: "square-order-1",
        state: "OPEN",
        version: 7,
        tenders: [{ paymentId: "payment-1" }],
      },
    });
    const gateway = new SquareCheckoutOrdersGateway(
      { calculate: jest.fn(), create: jest.fn(), get, update: jest.fn() },
      "square-location-1",
    );

    await expect(gateway.getCancellationState("square-order-1")).resolves.toEqual({
      state: "OPEN",
      version: 7,
      hasPayment: true,
    });
    expect(get).toHaveBeenCalledWith({ orderId: "square-order-1" });
  });
});
