import { NextRequest } from "next/server";
import { POST } from "@/app/api/checkout/submit/route";
import { createPrepareCheckoutDependencies } from "@/lib/checkout/prepare-checkout-dependencies";
import {
  createIssuePaymentPermitDependencies,
  createDirectPaymentDependencies,
} from "@/lib/checkout/payment-api-dependencies";
import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";
import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";

jest.mock("@/lib/checkout/prepare-checkout-dependencies", () => ({
  createPrepareCheckoutDependencies: jest.fn(),
}));
jest.mock("@/lib/checkout/payment-api-dependencies", () => ({
  createIssuePaymentPermitDependencies: jest.fn(),
  createDirectPaymentDependencies: jest.fn(),
}));
jest.mock("@/lib/checkout/prepare-checkout", () => ({
  prepareCheckoutHandler: jest.fn(),
}));
jest.mock("@/lib/checkout/issue-payment-permit", () => ({
  issuePaymentPermitHandler: jest.fn(),
}));
jest.mock("@/lib/checkout/create-direct-payment", () => ({
  createDirectPaymentHandler: jest.fn(),
}));

const preparation = {
  items: [
    {
      productId: "11111111-1111-4111-8111-111111111111",
      variantId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
    },
  ],
  fulfillment: "pickup",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  deviceSessionId: "44444444-4444-4444-8444-444444444444",
  quoteFingerprint: "a".repeat(64),
  paymentMethod: "afterpay",
  buyerEmail: "buyer@example.com",
  shippingAddress: null,
  pickupContact: { name: "Buyer", phone: "5555555555" },
  billingAddress: {
    givenName: "Buyer",
    familyName: "Example",
    line1: "1 Main St",
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US",
  },
};
function request() {
  return new NextRequest("https://shop.example/api/checkout/submit", {
    method: "POST",
    body: JSON.stringify({
      preparation,
      sourceId: "private-source",
      turnstileToken: "challenge",
    }),
  });
}
function fixture() {
  const verifyBrowser = jest.fn().mockResolvedValue({ allowed: true, reason: "passed" });
  const getSession = jest.fn().mockResolvedValue(null);
  const verifyTurnstile = jest
    .fn()
    .mockResolvedValue({ allowed: true, reason: "passed" });
  jest
    .mocked(createPrepareCheckoutDependencies)
    .mockReturnValue({ verifyBrowser, getSession } as never);
  jest
    .mocked(createIssuePaymentPermitDependencies)
    .mockReturnValue({ getClientIp: () => "203.0.113.2", verifyTurnstile } as never);
  jest
    .mocked(createDirectPaymentDependencies)
    .mockReturnValue({ reportError: jest.fn() } as never);
  jest.mocked(prepareCheckoutHandler).mockImplementation(async (_req, deps) => {
    expect(await deps.verifyBrowser()).toEqual({ allowed: true, reason: "passed" });
    await deps.getSession();
    return Response.json({
      orderId: "55555555-5555-4555-8555-555555555555",
      guestAccessToken: "guest",
      totals: { subtotalCents: 100, totalCents: 100, shippingCents: 0, taxCents: 0 },
    });
  });
  jest.mocked(issuePaymentPermitHandler).mockImplementation(async (_req, deps) => {
    await deps.verifyBrowser();
    await deps.getSession();
    expect(await deps.verifyTurnstile("challenge", "203.0.113.2")).toEqual({
      allowed: true,
      reason: "passed",
    });
    return Response.json({ permit: "private-permit" });
  });
  jest.mocked(createDirectPaymentHandler).mockImplementation(async (_req, deps) => {
    await deps.getSession();
    return Response.json({ status: "UNKNOWN" }, { status: 202 });
  });
  return { verifyBrowser, getSession, verifyTurnstile };
}
beforeEach(() => jest.clearAllMocks());
it("uses the original browser verdict, single-use challenge, and identity for all internal stages", async () => {
  const f = fixture();
  expect((await POST(request())).status).toBe(200);
  expect(f.verifyBrowser).toHaveBeenCalledTimes(1);
  expect(f.getSession).toHaveBeenCalledTimes(1);
  expect(f.verifyTurnstile).toHaveBeenCalledTimes(1);
  expect(f.verifyTurnstile.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(prepareCheckoutHandler).mock.invocationCallOrder[0],
  );
});
it("rejects a hosted browser verdict before challenge verification or inventory mutation", async () => {
  const f = fixture();
  f.verifyBrowser.mockResolvedValue({ allowed: false, reason: "bot" });
  expect((await POST(request())).status).toBe(403);
  expect(prepareCheckoutHandler).not.toHaveBeenCalled();
  expect(f.verifyTurnstile).not.toHaveBeenCalled();
});
it("rejects an expired single-use challenge before inventory mutation", async () => {
  const f = fixture();
  f.verifyTurnstile.mockResolvedValue({ allowed: false, reason: "invalid" });
  expect((await POST(request())).status).toBe(403);
  expect(prepareCheckoutHandler).not.toHaveBeenCalled();
});
