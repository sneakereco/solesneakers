import {
  PaymentPermitStore,
  type PaymentPermitPayload,
} from "@/lib/checkout/payment-permit";

const payload: PaymentPermitPayload = {
  tenantId: "tenant-1",
  orderId: "order-1",
  cartHash: "cart-hash",
  totalCents: 11000,
  method: "card",
  deviceSessionId: "44444444-4444-4444-8444-444444444444",
  normalizedEmailHash: "email-hmac",
  squareIdempotencyKey: "55555555-5555-4555-8555-555555555555",
};

describe("PaymentPermitStore", () => {
  it("stores an opaque permit for two minutes", async () => {
    const redis = {
      set: jest.fn().mockResolvedValue("OK"),
      eval: jest.fn(),
    };
    const store = new PaymentPermitStore(redis, () => "permit-token");

    await expect(store.issue(payload)).resolves.toEqual({
      token: "permit-token",
      expiresInSeconds: 120,
    });
    expect(redis.set).toHaveBeenCalledWith(
      "rdk:checkout:payment-permit:permit-token",
      JSON.stringify(payload),
      { nx: true, ex: 120 },
    );
  });

  it("atomically consumes a permit once", async () => {
    const redis = {
      set: jest.fn(),
      eval: jest
        .fn()
        .mockResolvedValueOnce(JSON.stringify(payload))
        .mockResolvedValueOnce(null),
    };
    const store = new PaymentPermitStore(redis);

    await expect(store.consume("permit-token")).resolves.toEqual(payload);
    await expect(store.consume("permit-token")).resolves.toBeNull();
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed stored data", async () => {
    const store = new PaymentPermitStore({
      set: jest.fn(),
      eval: jest.fn().mockResolvedValue('{"orderId":1}'),
    });

    await expect(store.consume("permit-token")).rejects.toThrow(
      "checkout_protection_unavailable",
    );
  });

  it("fails closed when Upstash cannot issue or consume", async () => {
    const store = new PaymentPermitStore({
      set: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      eval: jest.fn().mockRejectedValue(new Error("redis unavailable")),
    });

    await expect(store.issue(payload)).rejects.toThrow("checkout_protection_unavailable");
    await expect(store.consume("permit-token")).rejects.toThrow(
      "checkout_protection_unavailable",
    );
  });
});
