import { SquarePaymentsGateway } from "@/lib/square/payments";

const input = {
  localOrderId: "4a57e953-80dd-4609-970f-31984acfe810",
  squareOrderId: "square-order-1",
  sourceId: "cnon:card-nonce-ok",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  totalCents: 28563,
  billingAddress: {
    line1: "2 Billing Street",
    line2: null,
    city: "Charleston",
    state: "SC",
    postalCode: "29402",
    country: "US" as const,
  },
  shippingAddress: {
    name: "Buyer Example",
    phone: "8435550100",
    line1: "1 Main Street",
    line2: null,
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US" as const,
  },
};

describe("SquarePaymentsGateway", () => {
  it("creates an exact-order payment without opting into a Square email receipt", async () => {
    const create = jest.fn().mockResolvedValue({
      payment: {
        id: "payment-1",
        orderId: "square-order-1",
        status: "COMPLETED",
        amountMoney: { amount: BigInt(28563), currency: "USD" },
      },
    });
    const gateway = new SquarePaymentsGateway(
      { create, get: jest.fn() },
      "square-location-1",
    );

    await expect(gateway.create(input)).resolves.toEqual({
      id: "payment-1",
      orderId: "square-order-1",
      status: "COMPLETED",
      totalCents: 28563,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "cnon:card-nonce-ok",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        amountMoney: { amount: BigInt(28563), currency: "USD" },
        autocomplete: true,
        orderId: "square-order-1",
        locationId: "square-location-1",
        referenceId: "4a57e953-80dd-4609-970f-31984acfe810",
        shippingAddress: {
          addressLine1: "1 Main Street",
          locality: "Charleston",
          administrativeDistrictLevel1: "SC",
          postalCode: "29401",
          country: "US",
        },
        billingAddress: {
          addressLine1: "2 Billing Street",
          locality: "Charleston",
          administrativeDistrictLevel1: "SC",
          postalCode: "29402",
          country: "US",
        },
      }),
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("buyerEmailAddress");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("customerId");
  });

  it("rejects a mismatched payment response", async () => {
    const gateway = new SquarePaymentsGateway(
      {
        create: jest.fn().mockResolvedValue({
          payment: {
            id: "payment-2",
            orderId: "different-order",
            status: "COMPLETED",
            amountMoney: { amount: BigInt(28563), currency: "USD" },
          },
        }),
        get: jest.fn(),
      },
      "square-location-1",
    );

    await expect(gateway.create(input)).rejects.toThrow(
      "square_payment_invalid_response",
    );
  });

  it("retrieves and validates an authoritative payment", async () => {
    const get = jest.fn().mockResolvedValue({
      payment: {
        id: "payment-1",
        orderId: "square-order-1",
        status: "PENDING",
        amountMoney: { amount: BigInt(28563), currency: "USD" },
      },
    });
    const gateway = new SquarePaymentsGateway(
      { create: jest.fn(), get },
      "square-location-1",
    );

    await expect(gateway.get("payment-1")).resolves.toEqual({
      id: "payment-1",
      orderId: "square-order-1",
      status: "PENDING",
      totalCents: 28563,
    });
    expect(get).toHaveBeenCalledWith({ paymentId: "payment-1" });
  });
});
