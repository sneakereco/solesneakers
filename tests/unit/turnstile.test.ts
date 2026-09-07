import { verifyTurnstile } from "@/lib/security/turnstile";

const input = {
  token: "turnstile-token",
  remoteIp: "203.0.113.10",
};

const dependencies = {
  secretKey: "turnstile-secret",
  expectedHostname: "shop.example.com",
  expectedAction: "checkout-payment",
  fetch: jest.fn(),
};

describe("verifyTurnstile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accepts a server-verified token for the checkout hostname and action", async () => {
    dependencies.fetch.mockResolvedValue(
      Response.json({
        success: true,
        hostname: "shop.example.com",
        action: "checkout-payment",
      }),
    );

    await expect(verifyTurnstile(input, dependencies)).resolves.toEqual({
      allowed: true,
      reason: "passed",
    });

    const request = dependencies.fetch.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    expect(String(request?.body)).toContain("turnstile-token");
    expect(String(request?.body)).toContain("turnstile-secret");
  });

  it.each([
    { success: false, hostname: "shop.example.com", action: "checkout-payment" },
    { success: true, hostname: "evil.example.com", action: "checkout-payment" },
    { success: true, hostname: "shop.example.com", action: "contact-form" },
  ])("rejects an invalid or misbound token", async (providerBody) => {
    dependencies.fetch.mockResolvedValue(Response.json(providerBody));

    await expect(verifyTurnstile(input, dependencies)).resolves.toEqual({
      allowed: false,
      reason: "invalid",
    });
  });

  it("fails closed when Siteverify is unavailable", async () => {
    dependencies.fetch.mockRejectedValue(new Error("network unavailable"));

    await expect(verifyTurnstile(input, dependencies)).resolves.toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });

  it("rejects malformed tokens without contacting Siteverify", async () => {
    await expect(verifyTurnstile({ ...input, token: "" }, dependencies)).resolves.toEqual(
      { allowed: false, reason: "invalid" },
    );
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });
});
