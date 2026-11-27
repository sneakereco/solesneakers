import { getRateLimitPolicyForRequest } from "@/proxy/rate-limit";

describe("checkout proxy rate-limit ownership", () => {
  it("retains coarse request protection for checkout routes", () => {
    for (const path of [
      "/api/checkout/prepare",
      "/api/checkout/payment-permit",
      "/api/checkout/pay",
    ]) {
      expect(getRateLimitPolicyForRequest(path, "POST")).toMatchObject({
        bucket: "checkout_traffic",
      });
    }
  });

  it("retains the general write limit for unrelated API writes", () => {
    expect(getRateLimitPolicyForRequest("/api/contact", "POST")).toEqual({
      bucket: "api_write",
      maxRequests: 30,
      window: "1 m",
    });
  });

  it("keeps non-mutating checkout quotes behind the coarse checkout policy", () => {
    expect(getRateLimitPolicyForRequest("/api/checkout/quote", "POST")).toEqual({
      bucket: "checkout_traffic",
      maxRequests: 300,
      window: "1 m",
    });
  });

  it("does not put signed webhook delivery behind a browser IP bucket", () => {
    expect(getRateLimitPolicyForRequest("/api/webhooks/square", "POST")).toBeNull();
    expect(getRateLimitPolicyForRequest("/api/webhooks/shippo", "POST")).toBeNull();
    expect(
      getRateLimitPolicyForRequest("/api/webhooks/square/evil", "POST"),
    ).not.toBeNull();
  });
});
