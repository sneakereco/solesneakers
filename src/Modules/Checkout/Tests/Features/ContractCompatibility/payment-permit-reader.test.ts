import {
  PaymentPermitStore,
  type PaymentPermitPayload,
} from "@/lib/checkout/payment-permit";
import { futurePermitFixture, permitRedisFixture } from "./fixtures";

const legacy: PaymentPermitPayload = {
  tenantId: "tenant-1",
  orderId: "order-1",
  cartHash: "cart-hash",
  totalCents: 11800,
  method: "card",
  deviceSessionId: "device-1",
  normalizedEmailHash: "email-hash",
  squareIdempotencyKey: "11111111-1111-4111-8111-111111111111",
};

describe("payment permit compatibility reader", () => {
  it.each([false, true])(
    "consumes a tenant-free v2 permit once (serialized=%s)",
    async (serialized) => {
      const redis = permitRedisFixture();
      const payload = futurePermitFixture(legacy);
      redis.seed("permit", serialized ? JSON.stringify(payload) : payload);
      const store = new PaymentPermitStore(redis);
      await expect(store.consume("permit")).resolves.toEqual(payload);
      await expect(store.consume("permit")).resolves.toBeNull();
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        ["rdk:checkout:payment-permit:permit"],
        [],
      );
    },
  );

  it.each([
    { version: 3 },
    { version: "2" },
    { version: 1 },
    { tenantId: "injected" },
    { unexpected: true },
    { totalCents: 0 },
    { totalCents: 1.5 },
    { method: "googlePay" },
    { orderId: "" },
    { cartHash: "" },
    { deviceSessionId: "" },
    { normalizedEmailHash: "" },
    { squareIdempotencyKey: "not-a-uuid" },
  ])("fails closed and consumes invalid v2 payload %j", async (change) => {
    const redis = permitRedisFixture();
    redis.seed("permit", { ...futurePermitFixture(legacy), ...change });
    const store = new PaymentPermitStore(redis);
    await expect(store.consume("permit")).rejects.toThrow(
      "checkout_protection_unavailable",
    );
    await expect(store.consume("permit")).resolves.toBeNull();
  });

  it.each(Object.keys(futurePermitFixture(legacy)))(
    "rejects missing %s",
    async (field) => {
      const redis = permitRedisFixture();
      const payload: Record<string, unknown> = futurePermitFixture(legacy);
      delete payload[field];
      redis.seed("permit", payload);
      await expect(new PaymentPermitStore(redis).consume("permit")).rejects.toThrow(
        "checkout_protection_unavailable",
      );
    },
  );

  it("preserves the two-minute legacy issuance TTL and expires v2 at the same boundary", async () => {
    const redis = permitRedisFixture();
    const store = new PaymentPermitStore(redis, () => "legacy");
    await store.issue(legacy);
    redis.seed("future", futurePermitFixture(legacy));
    redis.advance(120000);
    await expect(store.consume("legacy")).resolves.toBeNull();
    await expect(store.consume("future")).resolves.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      "rdk:checkout:payment-permit:legacy",
      JSON.stringify(legacy),
      { nx: true, ex: 120 },
    );
  });

  it("does not expose future issuance through the legacy producer", async () => {
    const redis = permitRedisFixture();
    await expect(
      new PaymentPermitStore(redis).issue(
        futurePermitFixture(legacy) as unknown as PaymentPermitPayload,
      ),
    ).rejects.toThrow();
    expect(redis.set).not.toHaveBeenCalled();
  });
});
