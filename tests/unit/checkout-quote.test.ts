import {
  checkoutQuoteHandler,
  type CheckoutQuoteDependencies,
} from "@/lib/checkout/checkout-quote";

const requestBody = {
  items: [
    {
      productId: "11111111-1111-4111-8111-111111111111",
      variantId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
    },
  ],
  fulfillment: "ship" as const,
  shippingAddress: null,
};

const resolvedItem = {
  productId: requestBody.items[0].productId,
  variantId: requestBody.items[0].variantId,
  quantity: 1,
  unitPriceCents: 10_000,
  unitCostCents: 5_000,
  lineTotalCents: 10_000,
  variantSku: "SKU-1",
  productName: "Test Shoe",
  brand: "Sole",
  model: "One",
  category: "shoes",
  condition: "new",
  sizeLabel: "10",
};

function dependencies(
  overrides: Partial<CheckoutQuoteDependencies> = {},
): CheckoutQuoteDependencies {
  return {
    findTenantId: jest.fn().mockResolvedValue("tenant-1"),
    getAccess: jest.fn().mockResolvedValue({ open: true }),
    verifyBrowser: jest.fn().mockResolvedValue({ allowed: true, reason: "verified" }),
    resolveCart: jest.fn().mockResolvedValue({
      items: [resolvedItem],
      subtotalCents: 10_000,
    }),
    quote: jest.fn().mockResolvedValue({
      shippingCents: 1_500,
      taxCents: 0,
      taxCalculationId: "square:pending",
      customerState: "SC",
    }),
    calculateSquareOrder: jest.fn().mockResolvedValue({
      subtotalCents: 10_000,
      shippingCents: 1_500,
      taxCents: 825,
      totalCents: 12_325,
    }),
    reportError: jest.fn(),
    ...overrides,
  };
}

function request(body: unknown = requestBody): Request {
  return new Request("https://shop.example.com/api/checkout/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("checkoutQuoteHandler", () => {
  it("returns a non-mutating preliminary shipping quote without an address", async () => {
    const deps = dependencies();
    const response = await checkoutQuoteHandler(request() as never, deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      completeness: "preliminary",
      totals: {
        subtotalCents: 10_000,
        shippingCents: 1_500,
        taxCents: null,
        totalCents: 11_500,
      },
      quoteFingerprint: null,
    });
    expect(deps.calculateSquareOrder).not.toHaveBeenCalled();
  });

  it("returns an exact Square shipping quote and fingerprint for a complete address", async () => {
    const deps = dependencies();
    const shippingAddress = {
      name: "Buyer Example",
      phone: "8435550100",
      line1: "1 Main Street",
      line2: null,
      city: "Charleston",
      state: "SC",
      postalCode: "29401",
      country: "US",
    };
    const response = await checkoutQuoteHandler(
      request({ ...requestBody, shippingAddress }) as never,
      deps,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      completeness: "exact",
      totals: {
        subtotalCents: 10_000,
        shippingCents: 1_500,
        taxCents: 825,
        totalCents: 12_325,
      },
      quoteFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(deps.calculateSquareOrder).toHaveBeenCalledWith({
      fulfillment: "ship",
      subtotalCents: 10_000,
      shippingCents: 1_500,
      shippingAddress,
      items: [resolvedItem],
    });
  });

  it("calculates wallet tax from a redacted shipping destination", async () => {
    const deps = dependencies();
    const shippingAddress = {
      state: "DE",
      postalCode: "19801",
      country: "US",
    };

    const response = await checkoutQuoteHandler(
      request({ ...requestBody, shippingAddress }) as never,
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).completeness).toBe("exact");
    expect(deps.calculateSquareOrder).toHaveBeenCalledWith({
      fulfillment: "ship",
      subtotalCents: 10_000,
      shippingCents: 1_500,
      shippingAddress,
      items: [resolvedItem],
    });
  });

  it("calculates pickup immediately with zero shipping", async () => {
    const deps = dependencies({
      quote: jest.fn().mockResolvedValue({
        shippingCents: 0,
        taxCents: 0,
        taxCalculationId: "square:pending",
        customerState: "SC",
      }),
      calculateSquareOrder: jest.fn().mockResolvedValue({
        subtotalCents: 10_000,
        shippingCents: 0,
        taxCents: 600,
        totalCents: 10_600,
      }),
    });
    const response = await checkoutQuoteHandler(
      request({ ...requestBody, fulfillment: "pickup" }) as never,
      deps,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).completeness).toBe("exact");
    expect(deps.calculateSquareOrder).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillment: "pickup", shippingCents: 0 }),
    );
  });

  it("rejects malformed input before resolving a cart", async () => {
    const deps = dependencies();
    const response = await checkoutQuoteHandler(request({ items: [] }) as never, deps);

    expect(response.status).toBe(400);
    expect(deps.resolveCart).not.toHaveBeenCalled();
  });

  it("fails closed when checkout is unavailable or browser verification fails", async () => {
    const unavailable = dependencies({
      getAccess: jest.fn().mockResolvedValue({ open: false, message: "Closed" }),
    });
    expect((await checkoutQuoteHandler(request() as never, unavailable)).status).toBe(
      503,
    );

    const bot = dependencies({
      verifyBrowser: jest.fn().mockResolvedValue({ allowed: false, reason: "bot" }),
    });
    expect((await checkoutQuoteHandler(request() as never, bot)).status).toBe(403);
  });

  it("reports provider failures without exposing details", async () => {
    const error = new Error("provider body");
    const deps = dependencies({
      calculateSquareOrder: jest.fn().mockRejectedValue(error),
    });
    const response = await checkoutQuoteHandler(
      request({
        ...requestBody,
        shippingAddress: {
          name: "Buyer Example",
          phone: "8435550100",
          line1: "1 Main Street",
          line2: null,
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
      }) as never,
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Checkout totals are temporarily unavailable",
    });
    expect(deps.reportError).toHaveBeenCalledWith(error);
  });
});
