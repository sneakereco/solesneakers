import {
  CheckoutAttemptLimiter,
  type CheckoutAttemptIdentity,
} from "@/lib/checkout/checkout-attempt-limit";
import { hashNormalizedCheckoutEmail } from "@/lib/checkout/checkout-identity";

const identity: CheckoutAttemptIdentity = {
  tenantId: "tenant-1",
  clientIp: "203.0.113.10",
  userId: "user-1",
  normalizedEmailHash: "email-hmac",
  deviceSessionId: "device-session-1",
};

describe("checkout identity", () => {
  it("normalizes and HMACs email without exposing it", () => {
    const first = hashNormalizedCheckoutEmail(" Buyer@Example.COM ", "secret-value");
    const second = hashNormalizedCheckoutEmail("buyer@example.com", "secret-value");

    expect(first).toBe(second);
    expect(first).not.toContain("buyer@example.com");
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("CheckoutAttemptLimiter", () => {
  it("atomically consumes only email, account, and device daily quotas", async () => {
    const evalScript = jest.fn().mockResolvedValue([1, 0]);
    const limiter = new CheckoutAttemptLimiter({ eval: evalScript }, () => 1000);

    await expect(limiter.check(identity)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: null,
    });

    const [, keys, args] = evalScript.mock.calls[0] ?? [];
    expect(keys).toEqual([
      "rdk:checkout:tenant:tenant-1:email:email-hmac",
      "rdk:checkout:tenant:tenant-1:user:user-1",
      "rdk:checkout:tenant:tenant-1:device:device-session-1",
    ]);
    expect(keys.join(" ")).not.toContain("203.0.113.10");
    expect(args).toEqual(expect.arrayContaining(["5", "5", "10"]));
  });

  it("returns the provider retry time when a daily identity quota is full", async () => {
    const limiter = new CheckoutAttemptLimiter(
      { eval: jest.fn().mockResolvedValue([0, 125001]) },
      () => 1000,
    );

    await expect(limiter.check(identity)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 126,
    });
  });

  it("fails closed when Upstash is unavailable", async () => {
    const limiter = new CheckoutAttemptLimiter({
      eval: jest.fn().mockRejectedValue(new Error("redis unavailable")),
    });

    await expect(limiter.check(identity)).rejects.toThrow(
      "checkout_protection_unavailable",
    );
  });
});
