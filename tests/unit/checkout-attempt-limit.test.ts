import { CheckoutAttemptLimiter } from "@/lib/checkout/checkout-attempt-limit";
import { parseCheckoutAdmissionBudgets } from "@/Modules/Checkout/Source/Features/Operations/admission";
import { hashNormalizedCheckoutEmail } from "@/lib/checkout/checkout-identity";
const config = {
  version: 1 as const,
  revision: "local-fixture",
  ipPerMinute: 120,
  globalPerMinute: 400,
  providers: { square: 2, shippo: 2 },
};
const identity = {
  clientIp: "203.0.113.1",
  shopperBinding: "account:fixture",
  eventId: "key-1",
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

test("rejects missing, malformed, unsupported and unbounded runtime budgets", () => {
  for (const raw of [
    undefined,
    "{}",
    "{bad",
    JSON.stringify({ ...config, version: 2 }),
    JSON.stringify({ ...config, revision: "" }),
    JSON.stringify({ ...config, providers: { square: 5, shippo: 1 } }),
  ])
    expect(parseCheckoutAdmissionBudgets(raw)).toBeNull();
  expect(parseCheckoutAdmissionBudgets(JSON.stringify(config))).toEqual(config);
});
test("admission uses an atomic Redis call and reports rounded retry seconds", async () => {
  const redis = { eval: jest.fn().mockResolvedValue([0, 125001]) };
  await expect(
    new CheckoutAttemptLimiter(redis, config).check(identity),
  ).resolves.toEqual({ allowed: false, retryAfterSeconds: 126 });
  const [, keys, args] = redis.eval.mock.calls[0];
  expect(keys).toEqual([
    "rdk:checkout:{admission}:ip:203.0.113.1",
    "rdk:checkout:{admission}:global",
    "rdk:checkout:{admission}:prepare:account:fixture",
  ]);
  expect(args.slice(-3)).toEqual(["600000", "5", "key-1"]);
});
test("fails closed on Redis outage, invalid response or missing budgets", async () => {
  for (const redis of [
    { eval: jest.fn().mockRejectedValue(Error()) },
    { eval: jest.fn().mockResolvedValue([5, 1]) },
  ]) {
    await expect(
      new CheckoutAttemptLimiter(redis, config).check(identity),
    ).rejects.toThrow("checkout_protection_unavailable");
  }
  const redis = { eval: jest.fn() };
  await expect(new CheckoutAttemptLimiter(redis, null).check(identity)).rejects.toThrow();
  expect(redis.eval).not.toHaveBeenCalled();
});
test("address checking spends its own bounded shopper allowance", async () => {
  const redis = { eval: jest.fn().mockResolvedValue([1, 0]) };
  await new CheckoutAttemptLimiter(redis, config).checkAddressValidation(identity);
  expect(redis.eval.mock.calls[0][1]).toContain(
    "rdk:checkout:{admission}:address:account:fixture",
  );
  expect(redis.eval.mock.calls[0][1].join()).not.toContain("prepare:");
});
