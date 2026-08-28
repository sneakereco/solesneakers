jest.mock("@/lib/checkout/create-payment-link", () => ({
  createPaymentLinkHandler: jest.fn(),
}));

jest.mock("@/lib/checkout/create-payment-link-dependencies", () => ({
  createPaymentLinkDependencies: jest.fn(() => ({ dependency: true })),
}));

import { createPaymentLinkHandler } from "@/lib/checkout/create-payment-link";
import { createPaymentLinkDependencies } from "@/lib/checkout/create-payment-link-dependencies";

import { POST } from "../../app/api/checkout/payment-link/route";

describe("POST /api/checkout/payment-link", () => {
  it("delegates to the guarded handler with request-scoped dependencies", async () => {
    const expected = Response.json(
      { url: "https://square.link/u/example" },
      { status: 201 },
    );
    jest.mocked(createPaymentLinkHandler).mockResolvedValue(expected);
    const request = new Request("https://shop.example.com/api/checkout/payment-link", {
      method: "POST",
      body: "{}",
    });

    const response = await POST(request as never);

    expect(response).toBe(expected);
    expect(createPaymentLinkDependencies).toHaveBeenCalledWith(expect.any(String));
    expect(createPaymentLinkHandler).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ dependency: true }),
    );
  });
});
