jest.mock("@/lib/checkout/prepare-checkout", () => ({
  prepareCheckoutHandler: jest.fn(),
}));
jest.mock("@/lib/checkout/issue-payment-permit", () => ({
  issuePaymentPermitHandler: jest.fn(),
}));
jest.mock("@/lib/checkout/create-direct-payment", () => ({
  createDirectPaymentHandler: jest.fn(),
}));
jest.mock("@/lib/checkout/prepare-checkout-dependencies", () => ({
  createPrepareCheckoutDependencies: jest.fn(() => ({ stage: "prepare" })),
}));
jest.mock("@/lib/checkout/payment-api-dependencies", () => ({
  createIssuePaymentPermitDependencies: jest.fn(() => ({ stage: "permit" })),
  createDirectPaymentDependencies: jest.fn(() => ({ stage: "pay" })),
}));

import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";
import { issuePaymentPermitHandler } from "@/lib/checkout/issue-payment-permit";
import { createDirectPaymentHandler } from "@/lib/checkout/create-direct-payment";
import { POST as prepare } from "../../app/api/checkout/prepare/route";
import { POST as permit } from "../../app/api/checkout/payment-permit/route";
import { POST as pay } from "../../app/api/checkout/pay/route";

describe("direct checkout API routes", () => {
  it.each([
    ["prepare", prepare, prepareCheckoutHandler],
    ["payment-permit", permit, issuePaymentPermitHandler],
    ["pay", pay, createDirectPaymentHandler],
  ])("delegates the %s route", async (path, route, handler) => {
    const expected = Response.json({ ok: true });
    jest.mocked(handler).mockResolvedValue(expected);
    const request = new Request(`https://shop.example.com/api/checkout/${path}`, {
      method: "POST",
      body: "{}",
    });
    await expect(route(request as never)).resolves.toBe(expected);
    expect(handler).toHaveBeenCalledWith(request, expect.any(Object));
  });
});
