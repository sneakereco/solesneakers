import { SquareError } from "square";
import { squareDeclineCode, SquarePaymentsGateway } from "@/lib/square/payments";

const input = {
  method: "card" as const,
  attemptId: "10a88b57-5418-4d03-ba46-be65ff0fcb64",
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
        referenceId: input.attemptId,
        locationId: "square-location-1",
        sourceType: "CARD",
        cardDetails: {
          card: { cardBrand: "VISA", last4: "4242" },
          avsStatus: "AVS_ACCEPTED",
        },
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
      referenceId: input.attemptId,
      details: expect.objectContaining({
        source_type: "CARD",
        card_type: "VISA",
        card_last4: "4242",
        avs_result_code: "AVS_ACCEPTED",
      }),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "cnon:card-nonce-ok",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        amountMoney: { amount: BigInt(28563), currency: "USD" },
        autocomplete: true,
        orderId: "square-order-1",
        locationId: "square-location-1",
        referenceId: "10a88b57-5418-4d03-ba46-be65ff0fcb64",
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

  it("replays the same provider command and preserves the guarded attempt reference", async () => {
    const create = jest.fn().mockRejectedValue(new Error("timeout"));
    const gateway = new SquarePaymentsGateway(
      { create, get: jest.fn() },
      "fixture-location",
    );
    await expect(gateway.create(input)).rejects.toThrow("timeout");
    await expect(gateway.create(input)).rejects.toThrow("timeout");
    const first = create.mock.calls[0][0];
    expect(create.mock.calls[1][0]).toEqual(first);
    expect(first.referenceId).toBe(input.attemptId);
    expect(first.note).toBe("Sole Sneakers order " + input.localOrderId);
    expect(first.note).not.toContain(input.idempotencyKey);
    await expect(
      gateway.create({
        ...input,
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow();
    expect(create.mock.calls[2][0]).toEqual({
      ...first,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    });
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
      details: expect.objectContaining({ card_last4: null }),
    });
    expect(get).toHaveBeenCalledWith({ paymentId: "payment-1" });
  });
});

it("classifies only unambiguous authenticated decline responses", () => {
  const response = (codes: string[], statusCode = 400) =>
    new SquareError({
      statusCode,
      body: { errors: codes.map((code) => ({ code, category: "PAYMENT_METHOD_ERROR" })) },
    });
  expect(squareDeclineCode(response(["CARD_DECLINED"]))).toBe("CARD_DECLINED");
  for (const error of [
    response(["CARD_DECLINED", "IDEMPOTENCY_KEY_REUSED"]),
    response(["CARD_TOKEN_USED"]),
    response(["CARD_DECLINED"], 503),
    response(["CARD_DECLINED"], 408),
    response(["CARD_DECLINED"], 409),
    new Error("CARD_DECLINED"),
  ])
    expect(squareDeclineCode(error)).toBeNull();
});

it("fingerprints the complete exact request with a server key and an independent source domain", () => {
  const gateway = new SquarePaymentsGateway(
    { create: jest.fn(), get: jest.fn() },
    "location-one",
  );
  const other = new SquarePaymentsGateway(
    { create: jest.fn(), get: jest.fn() },
    "location-two",
  );
  const hashes = gateway.fingerprints(input, "fixture-key");
  expect(hashes.requestDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(hashes.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(gateway.fingerprints({ ...input }, "fixture-key")).toEqual(hashes);
  for (const variant of [
    { ...input, totalCents: 77 },
    { ...input, sourceId: "other" },
    { ...input, attemptId: input.localOrderId },
    { ...input, billingAddress: null },
  ])
    expect(gateway.fingerprints(variant, "fixture-key").requestDigest).not.toBe(
      hashes.requestDigest,
    );
  expect(other.fingerprints(input, "fixture-key").requestDigest).not.toBe(
    hashes.requestDigest,
  );
  expect(gateway.fingerprints(input, "other-key").sourceDigest).not.toBe(
    hashes.sourceDigest,
  );
});

it.each([
  ["cashAppPay", "WALLET", { walletDetails: { brand: "CASH_APP" } }],
  ["afterpay", "BUY_NOW_PAY_LATER", { buyNowPayLaterDetails: { brand: "AFTERPAY" } }],
  ["applePay", "CARD", {}],
] as const)("accepts a bound %s provider source", async (method, sourceType, details) => {
  const gateway = new SquarePaymentsGateway(
    {
      create: jest.fn().mockResolvedValue({
        payment: {
          id: "p",
          orderId: input.squareOrderId,
          referenceId: input.attemptId,
          locationId: "loc",
          status: "APPROVED",
          amountMoney: { amount: BigInt(input.totalCents), currency: "USD" },
          sourceType,
          ...details,
        },
      }),
      get: jest.fn(),
    },
    "loc",
  );
  expect((await gateway.create({ ...input, method })).id).toBe("p");
});

it.each([
  { referenceId: input.localOrderId, sourceType: "CARD" },
  { referenceId: input.attemptId, sourceType: "EXTERNAL" },
])("rejects a mismatched attempt or financial source", async (mismatch) => {
  const gateway = new SquarePaymentsGateway(
    {
      create: jest.fn().mockResolvedValue({
        payment: {
          id: "p",
          locationId: "loc",
          orderId: input.squareOrderId,
          status: "APPROVED",
          amountMoney: { amount: BigInt(input.totalCents), currency: "USD" },
          ...mismatch,
        },
      }),
      get: jest.fn(),
    },
    "loc",
  );
  await expect(gateway.create(input)).rejects.toThrow("square_payment_invalid_response");
});

it.each(["COMPLETED", "FAILED", "CANCELED", "PENDING", "APPROVED"])(
  "requires a matching merchant location before accepting %s proof",
  async (status) => {
    for (const locationId of [undefined, "other-location"]) {
      const payment = {
        id: "fixture-payment",
        orderId: input.squareOrderId,
        referenceId: input.attemptId,
        sourceType: "CARD",
        locationId,
        status,
        amountMoney: { amount: BigInt(input.totalCents), currency: "USD" },
      };
      const gateway = new SquarePaymentsGateway(
        { create: jest.fn().mockResolvedValue({ payment }), get: jest.fn() },
        "loc",
      );
      await expect(gateway.create(input)).rejects.toThrow(
        "square_payment_invalid_response",
      );
    }
  },
);
