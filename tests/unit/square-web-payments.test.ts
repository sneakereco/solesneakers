import {
  authorizeTokenizedSource,
  authorizeAndTokenize,
  squareWebPaymentsScriptUrl,
} from "@/lib/square/web-payments";

describe("Square Web Payments adapter", () => {
  it("selects the official environment-specific SDK", () => {
    expect(squareWebPaymentsScriptUrl("sandbox")).toBe(
      "https://sandbox.web.squarecdn.com/v1/square.js",
    );
    expect(squareWebPaymentsScriptUrl("production")).toBe(
      "https://web.squarecdn.com/v1/square.js",
    );
  });

  it("requests a bound permit before tokenizing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ permit: "permit-1" }),
    });
    const paymentMethod = {
      tokenize: jest.fn().mockResolvedValue({ status: "OK", token: "source-1" }),
    };

    await expect(
      authorizeAndTokenize({
        permitRequest: {
          orderId: "order-1",
          deviceSessionId: "device-1",
          method: "card",
          turnstileToken: "challenge-1",
        },
        paymentMethod,
        verificationDetails: { amount: "118.00", currencyCode: "USD" },
        fetchImpl: fetchImpl as never,
      }),
    ).resolves.toEqual({ permit: "permit-1", sourceId: "source-1" });
    expect(fetchImpl.mock.invocationCallOrder[0]).toBeLessThan(
      paymentMethod.tokenize.mock.invocationCallOrder[0],
    );
  });

  it("binds an already-tokenized wallet source after the wallet gesture", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ permit: "permit-1" }),
    });

    await expect(
      authorizeTokenizedSource({
        permitRequest: {
          orderId: "order-1",
          deviceSessionId: "device-1",
          method: "applePay",
        },
        sourceId: "wallet-source-1",
        fetchImpl: fetchImpl as never,
      }),
    ).resolves.toEqual({ permit: "permit-1", sourceId: "wallet-source-1" });
  });
});
