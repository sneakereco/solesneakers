import { prepareCheckoutHandler } from "@/lib/checkout/prepare-checkout";
import { CheckoutPreparationRepository } from "@/Modules/Checkout/Source/Features/Preparation/reservation-repository";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db/database.types";
import { createCheckoutQuoteFingerprint } from "@/lib/checkout/checkout-quote-fingerprint";
import {
  futureCartHashFixture,
  futureShippingFixture,
} from "@/Modules/Checkout/Tests/Features/ContractCompatibility/fixtures";
import { createCheckoutCartHash } from "@/lib/checkout/checkout-cart-hash";

import { readOrIssueGuestContext } from "@/Modules/Checkout/Source/Features/Preparation/guest-context";
import { CheckoutCatalogUnavailable } from "@/lib/checkout/checkout-cart-resolver";
import { PreparationChanged } from "@/Modules/Checkout/Source/Features/Preparation/reservation-contract";
import { checkoutQuoteHandler } from "@/lib/checkout/checkout-quote";
const TEST_SECRET = "test-secret-for-shipping-confirmations";
const guestContext = readOrIssueGuestContext(
  new Request("https://shop.example.com"),
  TEST_SECRET,
);
const cookie = guestContext.setCookie!.split(";")[0];
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const QUOTE_FINGERPRINT =
  "610ae04d8f9e17f9c643e5d21637d830251ddeedd427e1ac9a32d3947d3e649b";

function request(quoteFingerprint = QUOTE_FINGERPRINT) {
  return new Request("https://shop.example.com/api/checkout/prepare", {
    headers: { cookie },
    method: "POST",
    body: JSON.stringify({
      items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }],
      fulfillment: "ship",
      idempotencyKey: IDEMPOTENCY_KEY,
      deviceSessionId: DEVICE_ID,
      quoteFingerprint,
      buyerEmail: "buyer@example.com",
      paymentMethod: "card",
      shippingAddress: {
        name: "Buyer",
        phone: "5555555555",
        line1: "1 Main Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US",
      },
      billingAddress: {
        givenName: "Buyer",
        familyName: "Example",
        phone: null,
        line1: "1 Billing Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US",
      },
    }),
  }) as never;
}

it("keeps an optional identity outage outside the accepted checkout and its abuse evidence", async () => {
  const deps = {
    ...dependencies(),
    resolveAnalyticsContext: jest
      .fn()
      .mockRejectedValue(new Error("identity unavailable")),
    outcome: jest.fn(),
  };
  const body = await (request() as Request).json();
  const req = new Request("https://shop.example.com/api/checkout/prepare", {
    headers: { cookie },
    method: "POST",
    body: JSON.stringify({ ...body, trackingContext: { consent: true } }),
  });
  const response = await prepareCheckoutHandler(req as never, deps);
  expect(response.status).toBe(201);
  expect(deps.resolveAnalyticsContext).toHaveBeenCalledWith(
    "buyer@example.com",
    expect.any(Object),
    { consent: true },
  );
  const reserved = deps.reserve.mock.calls[0][0];
  expect(reserved.analyticsContext).toBeNull();
  expect(reserved.protectionEvidence).not.toHaveProperty("trackingContext");
  expect(deps.outcome).not.toHaveBeenCalled();
});
function dependencies() {
  const item = {
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    quantity: 1,
    unitPriceCents: 10000,
    unitCostCents: 6000,
    lineTotalCents: 10000,
    variantSku: "SKU-1",
    productName: "Dunk Low",
    brand: "Nike",
    model: "Dunk",
    category: "shoes",
    condition: "new",
    sizeLabel: "10",
  };
  return {
    shippingConfirmationSecret: () => "test-secret-for-shipping-confirmations",
    checkAddressValidationAttempt: jest
      .fn()
      .mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    validateShippingAddress: jest.fn().mockResolvedValue({ status: "valid" }),
    findTenantId: jest.fn().mockResolvedValue("tenant-1"),
    getAccess: jest.fn().mockResolvedValue({ open: true }),
    verifyBrowser: jest.fn().mockResolvedValue({ allowed: true, reason: "passed" }),
    getClientIp: jest.fn().mockReturnValue("203.0.113.2"),
    getSession: jest.fn().mockResolvedValue(null),
    hashEmail: jest.fn().mockReturnValue("email-hash"),
    findExisting: jest.fn().mockResolvedValue(null),
    readRetryExpiration: jest.fn().mockResolvedValue(null),
    checkResume: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    checkAttempt: jest.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: null }),
    resolveCart: jest.fn().mockResolvedValue({ items: [item], subtotalCents: 10000 }),
    quote: jest.fn().mockResolvedValue({
      shippingCents: 1000,
      taxCents: 0,
      taxCalculationId: "square:pending",
      customerState: "SC",
    }),
    calculateSquareOrder: jest.fn().mockResolvedValue({
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 800,
      totalCents: 11800,
    }),
    inspectUnavailable: jest.fn(),
    reserve: jest.fn().mockResolvedValue({
      kind: "reserved",
      orderId: "order-1",
      reused: false,
      expiresAt: "2026-09-06T12:15:00.000Z",
      squareOrderId: null,
    }),
    createGuestAccessToken: jest.fn().mockResolvedValue("guest-token"),
    getSquareClientConfig: jest.fn().mockReturnValue({
      applicationId: "sandbox-app-id",
      locationId: "location-1",
      environment: "sandbox",
    }),
    createSquareOrder: jest.fn().mockResolvedValue({
      id: "square-order-1",
      version: 1,
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 800,
      totalCents: 11800,
      taxCalculationId: "square:square-order-1:v1",
    }),
    attachSquareOrder: jest.fn().mockResolvedValue(undefined),
    rejectBeforeAttach: jest.fn().mockResolvedValue(true),
    cancelSquareOrder: jest.fn().mockResolvedValue(undefined),
    releaseReservation: jest.fn().mockResolvedValue(true),
    reportError: jest.fn(),
    now: jest.fn(() => new Date("2026-09-06T12:00:00.000Z")),
  };
}

describe("prepareCheckoutHandler", () => {
  async function existingCheckout(version: 3 | 4, changes: Record<string, unknown> = {}) {
    const deps = dependencies();
    const body = await (request() as Request).json();
    const input = { ...body, tenantId: "tenant-1" };
    const hash =
      version === 3 ? createCheckoutCartHash(input) : futureCartHashFixture(input);
    const existing = {
      guarded: true,
      userId: null,
      guestContextHash: guestContext.contextHash,
      deviceSessionId: DEVICE_ID,
      orderId: "order-1",
      cartHash: hash,
      status: "pending",
      expiresAt: "2026-09-06T12:15:00.000Z",
      squareOrderId: "square-order-1",
      squareOrderVersion: 1,
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 800,
      totalCents: 11800,
      items: (await deps.resolveCart()).items,
      ...changes,
    };
    deps.resolveCart.mockClear();
    deps.findExisting.mockResolvedValue(existing);
    deps.reserve.mockResolvedValue({
      kind: "reserved",
      orderId: "order-1",
      expiresAt: existing.expiresAt,
      reused: true,
    });
    return { deps, body, existing };
  }

  it("requires merchant access for an unattached ordinary resume while allocation pause still permits completion", async () => {
    for (const locked of [true, false]) {
      const { deps } = await existingCheckout(3, {
        squareOrderId: null,
        squareOrderVersion: null,
      });
      deps.getAccess.mockImplementation((_tenant, scope) =>
        Promise.resolve(
          scope === "new_prepare" || locked
            ? { open: false, message: "Merchant closed" }
            : { open: true },
        ),
      );
      const response = await prepareCheckoutHandler(request(), deps);
      expect(response.status).toBe(locked ? 503 : 200);
      expect(deps.createSquareOrder).toHaveBeenCalledTimes(locked ? 0 : 1);
      expect(deps.calculateSquareOrder).toHaveBeenCalledTimes(locked ? 0 : 1);
    }
  });

  it("discovers the authorized original while new allocation is paused", async () => {
    const { deps, body } = await existingCheckout(3);
    deps.getAccess.mockResolvedValue({ open: false, message: "Allocation paused" });
    const req = new Request("https://shop.example.com/api/checkout/prepare", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ ...body, recoveryOnly: true }),
    });
    const response = await prepareCheckoutHandler(req as never, deps);
    expect(response.status).toBe(200);
    expect((await response.json()).orderId).toBe("order-1");
    expect(deps.checkResume).toHaveBeenCalledWith(
      expect.objectContaining({
        shopperBinding: "guest:" + guestContext.contextHash,
        attached: true,
      }),
    );
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "unfinished",
    "wrong-context",
    "wrong-account",
    "wrong-device",
    "authorized",
  ])(
    "recovery-only prepare %s can only read the original owned attached order",
    async (kind) => {
      const { deps, body } = await existingCheckout(
        3,
        kind === "unfinished"
          ? { squareOrderId: null, squareOrderVersion: null }
          : kind === "wrong-context"
            ? { guestContextHash: "other" }
            : {},
      );
      if (kind === "missing") deps.findExisting.mockResolvedValue(null);
      if (kind === "wrong-account")
        deps.getSession.mockResolvedValue({
          user: { id: "other", email: body.buyerEmail },
        });
      const req = new Request("https://shop.example.com/api/checkout/prepare", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({
          ...body,
          ...(kind === "wrong-device" ? { deviceSessionId: PRODUCT_ID } : {}),
          recoveryOnly: true,
        }),
      });
      const response = await prepareCheckoutHandler(req as never, deps);
      expect(response.status).toBe(kind === "authorized" ? 200 : 409);
      const data = await response.json();
      if (kind === "authorized") {
        expect(data.orderId).toBe("order-1");
        expect(data.guestAccessToken).toBe("guest-token");
      } else {
        expect(data.code).toBe("CHECKOUT_RECOVERY_REQUIRED");
        expect(data.orderId).toBeUndefined();
        expect(deps.createGuestAccessToken).not.toHaveBeenCalled();
        expect(deps.readRetryExpiration).not.toHaveBeenCalled();
      }
      for (const dependency of [
        deps.resolveCart,
        deps.validateShippingAddress,
        deps.reserve,
        deps.createSquareOrder,
        deps.calculateSquareOrder,
        deps.attachSquareOrder,
        deps.checkAttempt,
      ])
        expect(dependency).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "recovery preserves the original and gives exact retry metadata only when qualified (%s)",
    async (qualified) => {
      const { deps, body, existing } = await existingCheckout(3);
      const expiry = "2026-09-06T12:14:00.000Z";
      if (qualified) deps.readRetryExpiration.mockResolvedValue(expiry);
      else deps.readRetryExpiration.mockRejectedValue(new Error("snapshot failed"));
      const response = await prepareCheckoutHandler(
        new Request("https://shop.example.com/api/checkout/prepare", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({ ...body, recoveryOnly: true }),
        }) as never,
        deps,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        orderId: existing.orderId,
        code: "CHECKOUT_RECOVERY_REQUIRED",
        totals: {
          subtotalCents: 10000,
          shippingCents: 1000,
          taxCents: 800,
          totalCents: 11800,
        },
      });
      expect(data.originalRetry).toEqual(
        qualified
          ? {
              expiresAt: expiry,
              lines: [
                {
                  productId: PRODUCT_ID,
                  variantId: VARIANT_ID,
                  quantity: 1,
                  unitPriceCents: 10000,
                },
              ],
            }
          : undefined,
      );
      expect(deps.readRetryExpiration).toHaveBeenCalledWith("tenant-1", existing);
      expect(deps.reserve).not.toHaveBeenCalled();
      expect(deps.calculateSquareOrder).not.toHaveBeenCalled();
      expect(deps.createSquareOrder).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: "paid" },
    { expiresAt: "2020-01-01T00:00:00Z" },
    { cartHash: "mismatch" },
    { squareOrderVersion: null },
    { taxCents: 700 },
  ])(
    "recovery-only terminal or incompatible order never invites a new payment %#",
    async (changes) => {
      const { deps, body } = await existingCheckout(3, changes);
      const req = new Request("https://shop.example.com/api/checkout/prepare", {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ ...body, recoveryOnly: true }),
      });
      const res = await prepareCheckoutHandler(req as never, deps);
      const data = await res.json();
      if (
        "cartHash" in changes ||
        "squareOrderVersion" in changes ||
        "taxCents" in changes
      ) {
        expect(res.status).toBe(409);
        expect(data.code).toBe("CHECKOUT_RECOVERY_REQUIRED");
        expect(data.orderId).toBeUndefined();
      } else {
        expect(res.status).toBe(200);
        expect(data.orderId).toBe("order-1");
        expect(data.guestAccessToken).toBe("guest-token");
      }
      for (const fn of [
        deps.reserve,
        deps.checkAttempt,
        deps.createSquareOrder,
        deps.attachSquareOrder,
        deps.calculateSquareOrder,
        deps.validateShippingAddress,
      ])
        expect(fn).not.toHaveBeenCalled();
    },
  );
  it.each([3, 4] as const)(
    "reuses a persisted v%s checkout without rewriting or creating a Square order",
    async (version) => {
      const { deps, existing } = await existingCheckout(version);
      const before = JSON.stringify(existing);
      const response = await prepareCheckoutHandler(request(), deps);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        orderId: "order-1",
        reused: true,
        guestAccessToken: "guest-token",
        totals: { totalCents: 11800 },
      });
      expect(JSON.stringify(existing)).toBe(before);
      expect(deps.reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          cartHash: existing.cartHash,
          ownerBinding: "guest:" + guestContext.contextHash,
        }),
      );
      expect(deps.createSquareOrder).not.toHaveBeenCalled();
      expect(deps.attachSquareOrder).not.toHaveBeenCalled();
    },
  );

  it.each([
    { buyerEmail: "other@example.com" },
    { paymentMethod: "afterpay" },
    {
      shippingAddress: {
        name: "Buyer",
        phone: "5555555555",
        line1: "2 Main Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US",
      },
    },
    {
      billingAddress: {
        givenName: "Buyer",
        familyName: "Example",
        phone: null,
        line1: "2 Billing Street",
        line2: null,
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US",
      },
    },
    { items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 2 }] },
  ])(
    "rejects changed v4 checkout identity %j without replacing the stored hash",
    async (change) => {
      const { deps, body, existing } = await existingCheckout(4);
      const hash = existing.cartHash;
      const response = await prepareCheckoutHandler(
        new Request("https://shop.example.com/api/checkout/prepare", {
          headers: { cookie },
          method: "POST",
          body: JSON.stringify({ ...body, ...change }),
        }) as never,
        deps,
      );
      expect(response.status).toBe(409);
      expect(existing.cartHash).toBe(hash);
      expect(deps.reserve).not.toHaveBeenCalled();
      expect(deps.createSquareOrder).not.toHaveBeenCalled();
    },
  );

  it.each([{ status: "paid" }, { expiresAt: "2026-09-06T12:00:00.000Z" }])(
    "refuses unusable v4 pending checkout %j",
    async (change) => {
      const { deps } = await existingCheckout(4, change);
      const response = await prepareCheckoutHandler(request(), deps);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "CHECKOUT_RECOVERY_REQUIRED",
        orderId: "order-1",
        guestAccessToken: "guest-token",
      });
      expect(deps.createSquareOrder).not.toHaveBeenCalled();
      expect(deps.reserve).not.toHaveBeenCalled();
    },
  );

  it("resumes a lost prepare response with the quote-issued cookie and denies changed or missing proof", async () => {
    const previous = process.env.CHECKOUT_IDENTITY_HMAC_SECRET;
    process.env.CHECKOUT_IDENTITY_HMAC_SECRET = TEST_SECRET;
    try {
      const { deps, body, existing } = await existingCheckout(3);
      const quoteRequest = new Request("https://shop.example.com/api/checkout/quote", {
        method: "POST",
        body: JSON.stringify({
          items: body.items,
          shippingAddress: body.shippingAddress,
          fulfillment: body.fulfillment,
        }),
      });
      const quoted = await checkoutQuoteHandler(quoteRequest as never, deps);
      expect(quoted.status).toBe(200);
      const original = quoted.headers.get("set-cookie")!.split(";")[0];
      const prepareReq = (c: string) =>
        new Request("https://shop.example.com/api/checkout/prepare", {
          method: "POST",
          headers: { cookie: c },
          body: JSON.stringify(body),
        }) as never;
      deps.findExisting.mockResolvedValueOnce(null);
      deps.reserve.mockResolvedValueOnce({
        kind: "reserved",
        orderId: "order-1",
        reused: false,
        expiresAt: existing.expiresAt,
      });
      const lost = await prepareCheckoutHandler(prepareReq(original), deps);
      expect(lost.status).toBe(201);
      const ownerBinding = deps.reserve.mock.calls[0][0].ownerBinding;
      deps.findExisting.mockResolvedValue({
        ...existing,
        guestContextHash: ownerBinding.slice(6),
      });
      const resumed = await prepareCheckoutHandler(prepareReq(original), deps);
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toMatchObject({
        orderId: "order-1",
        guestAccessToken: "guest-token",
        reused: true,
      });
      for (const context of [cookie, "", original + "x"]) {
        const denied = await prepareCheckoutHandler(prepareReq(context), deps);
        expect(denied.status).toBe(409);
        expect(Object.keys(await denied.json()).sort()).toEqual(["code", "error"]);
      }
      deps.findExisting.mockResolvedValue({
        ...existing,
        guarded: false,
        guestContextHash: null,
      });
      const recovery = await prepareCheckoutHandler(prepareReq(original), deps);
      expect(recovery.status).toBe(409);
      expect(await recovery.json()).toEqual({
        code: "CHECKOUT_RECOVERY_REQUIRED",
        error:
          "Check your order using your account or secure order link before trying again.",
      });
      expect(deps.reserve).toHaveBeenCalledTimes(2);
      expect(deps.createSquareOrder).toHaveBeenCalledTimes(1);
      expect(deps.createGuestAccessToken).toHaveBeenCalledTimes(2);
    } finally {
      if (previous === undefined) delete process.env.CHECKOUT_IDENTITY_HMAC_SECRET;
      else process.env.CHECKOUT_IDENTITY_HMAC_SECRET = previous;
    }
  });
  it("resumes only the matching verified account and device without minting a guest credential", async () => {
    const { deps, existing, body } = await existingCheckout(3);
    deps.findExisting.mockResolvedValue({
      ...existing,
      userId: PRODUCT_ID,
      guestContextHash: null,
    });
    const account = (id: string) => ({ user: { id, email: "buyer@example.com" } });
    const req = (deviceSessionId: string) =>
      new Request("https://shop.example.com/api/checkout/prepare", {
        method: "POST",
        body: JSON.stringify({ ...body, deviceSessionId }),
      }) as never;
    deps.getSession.mockResolvedValue(account(PRODUCT_ID));
    const resumed = await prepareCheckoutHandler(req(DEVICE_ID), deps);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).not.toHaveProperty("guestAccessToken");
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: PRODUCT_ID,
        ownerBinding: "account:" + PRODUCT_ID,
      }),
    );
    expect((await prepareCheckoutHandler(req(VARIANT_ID), deps)).status).toBe(409);
    deps.getSession.mockResolvedValue(account(VARIANT_ID));
    expect((await prepareCheckoutHandler(req(DEVICE_ID), deps)).status).toBe(409);
    expect(deps.reserve).toHaveBeenCalledTimes(1);
    expect(deps.createGuestAccessToken).not.toHaveBeenCalled();
  });

  it("resumes the previously priced owned order if address verification becomes unavailable", async () => {
    const { deps } = await existingCheckout(3);
    deps.validateShippingAddress.mockResolvedValue({ status: "unavailable" });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).reused).toBe(true);
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
  });
  it("selects the stored order proof even when a different verified proof appears first", async () => {
    const { deps, body } = await existingCheckout(3);
    const concurrent = readOrIssueGuestContext(
      new Request("https://shop.example.com"),
      TEST_SECRET,
    );
    const response = await prepareCheckoutHandler(
      new Request("https://shop.example.com/api/checkout/prepare", {
        method: "POST",
        headers: { cookie: concurrent.setCookie!.split(";")[0] + "; " + cookie },
        body: JSON.stringify(body),
      }) as never,
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerBinding: "guest:" + guestContext.contextHash,
        otherGuestContexts: [concurrent.contextHash],
      }),
    );
  });
  it("validates Square totals when reusing v4", async () => {
    const { deps } = await existingCheckout(4, { totalCents: 11801 });
    expect((await prepareCheckoutHandler(request(), deps)).status).toBe(409);
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });

  it("accepts v2 shipping confirmation through preparation without a second address check", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    const shippingConfirmation = futureShippingFixture(
      {
        deviceSessionId: body.deviceSessionId,
        normalizedEmailHash: "email-hash",
        paymentMethod: body.paymentMethod,
        address: body.shippingAddress,
      },
      deps.shippingConfirmationSecret(),
      deps.now().getTime() + 600000,
    );
    deps.validateShippingAddress.mockResolvedValue({ status: "invalid" });
    const response = await prepareCheckoutHandler(
      new Request("https://shop.example.com/api/checkout/prepare", {
        headers: { cookie },
        method: "POST",
        body: JSON.stringify({
          ...body,
          shippingConfirmation,
          shippingAddressOverride: true,
        }),
      }) as never,
      deps,
    );
    expect(response.status).toBe(201);
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
    expect(deps.checkAddressValidationAttempt).not.toHaveBeenCalled();
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        protectionEvidence: expect.objectContaining({
          shipping_address_override_confirmed: true,
        }),
      }),
    );
  });

  it("reserves server-priced inventory and attaches Square authoritative tax", async () => {
    const deps = dependencies();
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        orderId: "order-1",
        guestAccessToken: "guest-token",
        totals: {
          subtotalCents: 10000,
          shippingCents: 1000,
          taxCents: 800,
          totalCents: 11800,
        },
      }),
    );
    expect(deps.attachSquareOrder).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({ id: "square-order-1" }),
    );
    expect(deps.calculateSquareOrder.mock.invocationCallOrder[0]).toBeLessThan(
      deps.reserve.mock.invocationCallOrder[0],
    );
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: "card",
        taxCents: 800,
        totalCents: 11800,
        billingAddress: expect.objectContaining({
          givenName: "Buyer",
          familyName: "Example",
          postalCode: "29401",
          country: "US",
        }),
      }),
    );
  });

  it("returns the locked item conflict and no payment dispatch when the stock-one reservation loses", async () => {
    const deps = dependencies();
    const conflicts = [
      {
        productId: PRODUCT_ID,
        variantId: VARIANT_ID,
        requestedQuantity: 1,
        availableQuantity: 0,
        reason: "reserved_by_other",
      },
    ];
    deps.reserve.mockResolvedValue({ kind: "conflict", conflicts });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "INVENTORY_CONFLICT",
      paymentState: "not_submitted",
      conflicts,
    });
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });
  it("decides a missing catalog line inside the allocation transaction and preserves technical failures", async () => {
    const deps = dependencies();
    deps.resolveCart.mockRejectedValue(new CheckoutCatalogUnavailable());
    const conflicts = [
      {
        productId: PRODUCT_ID,
        variantId: VARIANT_ID,
        requestedQuantity: 1,
        availableQuantity: 0,
        reason: "sold_out",
      },
    ];
    deps.inspectUnavailable
      .mockResolvedValueOnce(conflicts)
      .mockRejectedValueOnce(new PreparationChanged())
      .mockRejectedValueOnce(Error("database unavailable"));
    let response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "INVENTORY_CONFLICT",
      conflicts,
      paymentState: "not_submitted",
    });
    response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(409);
    expect(Object.keys(await response.json())).toEqual(["error"]);
    response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(503);
    expect(Object.keys(await response.json())).toEqual(["error"]);
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });
  it.each([
    ["createSquareOrder", "create"],
    ["attachSquareOrder", "attach"],
    ["createGuestAccessToken", "tokenize"],
  ] as const)(
    "identifies the failing preparation phase at %s without changing recovery safety",
    async (dependency, phase) => {
      const deps = dependencies();
      const error = Error("SYNTHETIC_PRIVATE_PROVIDER_DATA");
      deps[dependency].mockRejectedValue(error);
      const response = await prepareCheckoutHandler(request(), deps);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Checkout is temporarily unavailable",
      });
      expect(deps.reportError).toHaveBeenCalledWith(error, { phase, orderId: "order-1" });
      expect(deps.releaseReservation).not.toHaveBeenCalled();
      expect(deps.cancelSquareOrder).not.toHaveBeenCalled();
    },
  );
  it("preserves the reservation for an ambiguous Square attach", async () => {
    const deps = dependencies();
    deps.attachSquareOrder.mockRejectedValue(Error("reply lost"));
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(503);
    expect(deps.cancelSquareOrder).not.toHaveBeenCalled();
    expect(deps.releaseReservation).not.toHaveBeenCalled();
    expect(deps.createGuestAccessToken).not.toHaveBeenCalled();
  });
  it("keeps a concurrently attached order when another CreateOrder response disagrees", async () => {
    const deps = dependencies();
    deps.rejectBeforeAttach.mockResolvedValue(false);
    deps.createSquareOrder.mockResolvedValue({
      id: "square-order-1",
      version: 1,
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 810,
      totalCents: 11810,
      taxCalculationId: "square:fixture:v1",
    });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(await response.json()).toMatchObject({ code: "CHECKOUT_RECOVERY_REQUIRED" });
    expect(deps.cancelSquareOrder).not.toHaveBeenCalled();
    expect(deps.releaseReservation).not.toHaveBeenCalled();
  });
  it("keeps identical Square creation payloads for reversed equivalent baskets", async () => {
    const deps = dependencies(),
      base = (await deps.resolveCart()).items[0];
    const other = { ...base, variantId: "11111111-2222-4222-8222-222222222222" };
    const items = [base, other],
      totals = {
        subtotalCents: 20000,
        shippingCents: 1000,
        taxCents: 800,
        totalCents: 21800,
      };
    const body = await (request() as Request).json();
    const quoteFingerprint = createCheckoutQuoteFingerprint({
      items: items.map(({ variantId, quantity, unitPriceCents }) => ({
        variantId,
        quantity,
        unitPriceCents,
      })),
      fulfillment: "ship",
      shippingAddress: body.shippingAddress,
      totals,
    });
    deps.calculateSquareOrder.mockResolvedValue(totals);
    deps.createSquareOrder.mockResolvedValue({
      ...totals,
      id: "fixture",
      version: 1,
      taxCalculationId: "square:fixture:v1",
    });
    for (const ordered of [items, [...items].reverse()]) {
      deps.resolveCart.mockResolvedValue({ items: ordered, subtotalCents: 20000 });
      const response = await prepareCheckoutHandler(
        new Request("https://shop.example.com/api/checkout/prepare", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({
            ...body,
            quoteFingerprint,
            items: ordered.map(({ productId, variantId, quantity }) => ({
              productId,
              variantId,
              quantity,
            })),
          }),
        }) as never,
        deps,
      );
      expect(response.status).toBe(201);
    }
    expect(deps.createSquareOrder.mock.calls[0][0]).toEqual(
      deps.createSquareOrder.mock.calls[1][0],
    );
  });
  it("does not reserve or contact Square when the daily limit is exhausted", async () => {
    const deps = dependencies();
    deps.checkAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });

  it("rejects a stale exact quote before reserving inventory", async () => {
    const deps = dependencies();
    const response = await prepareCheckoutHandler(request("b".repeat(64)), deps);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Checkout totals changed. Review the updated total and try again.",
    });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.createSquareOrder).not.toHaveBeenCalled();
  });

  it("cancels and releases when created Square totals change after calculation", async () => {
    const deps = dependencies();
    deps.createSquareOrder.mockResolvedValue({
      id: "square-order-1",
      version: 1,
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 801,
      totalCents: 11801,
      taxCalculationId: "square:square-order-1:v1",
    });

    const response = await prepareCheckoutHandler(request(), deps);

    expect(response.status).toBe(409);
    expect(deps.attachSquareOrder).not.toHaveBeenCalled();
    expect(deps.cancelSquareOrder).toHaveBeenCalledWith(
      "square-order-1",
      1,
      expect.any(String),
    );
    expect(deps.releaseReservation).toHaveBeenCalledWith(
      "order-1",
      "square_order_totals_changed",
    );
  });
});

describe("shipping deliverability gate", () => {
  it("continues an accepted suggestion without another address check or quota", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    const suggestedAddress = { ...body.shippingAddress, line1: "1 Main St" };
    deps.validateShippingAddress.mockResolvedValue({
      status: "suggestion",
      address: suggestedAddress,
    });
    const first = await prepareCheckoutHandler(request(), deps);
    const review = await first.json();
    expect(typeof review.shippingConfirmation).toBe("string");
    const response = await prepareCheckoutHandler(
      new Request("https://shop.example.com/api/checkout/prepare", {
        headers: { cookie },
        method: "POST",
        body: JSON.stringify({
          ...body,
          shippingAddress: suggestedAddress,
          shippingConfirmation: review.shippingConfirmation,
          quoteFingerprint: createCheckoutQuoteFingerprint({
            items: [{ variantId: VARIANT_ID, quantity: 1, unitPriceCents: 10000 }],
            fulfillment: "ship",
            shippingAddress: suggestedAddress,
            totals: {
              subtotalCents: 10000,
              shippingCents: 1000,
              taxCents: 800,
              totalCents: 11800,
            },
          }),
        }),
      }) as never,
      deps,
    );
    expect(response.status).toBe(201);
    expect(deps.validateShippingAddress).toHaveBeenCalledTimes(1);
    expect(deps.checkAddressValidationAttempt).toHaveBeenCalledTimes(1);
    expect(deps.checkAttempt).toHaveBeenCalledTimes(1);
  });
  it("continues the entered address when the buyer explicitly overrides a suggestion", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    deps.validateShippingAddress.mockResolvedValue({
      status: "suggestion",
      address: { ...body.shippingAddress, line1: "1 Main St" },
    });
    const first = await prepareCheckoutHandler(request(), deps);
    const review = await first.json();

    expect(typeof review.enteredShippingConfirmation).toBe("string");

    const response = await prepareCheckoutHandler(
      new Request("https://shop.example.com/api/checkout/prepare", {
        headers: { cookie },
        method: "POST",
        body: JSON.stringify({
          ...body,
          shippingAddressOverride: true,
          shippingConfirmation: review.enteredShippingConfirmation,
        }),
      }) as never,
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.validateShippingAddress).toHaveBeenCalledTimes(1);
    expect(deps.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingAddress: body.shippingAddress,
        protectionEvidence: expect.objectContaining({
          shipping_address_override_confirmed: true,
        }),
      }),
    );
  });
  it.each(["applePay"])(
    "prepares %s without Shippo or its quota",
    async (paymentMethod) => {
      const deps = dependencies();
      deps.validateShippingAddress.mockRejectedValue(new Error("Shippo unavailable"));
      deps.checkAddressValidationAttempt.mockResolvedValue({
        allowed: false,
        retryAfterSeconds: 60,
      });
      const body = await (request() as Request).json();
      const response = await prepareCheckoutHandler(
        new Request("https://shop.example.com/api/checkout/prepare", {
          headers: { cookie },
          method: "POST",
          body: JSON.stringify({ ...body, paymentMethod }),
        }) as never,
        deps,
      );
      expect(response.status).toBe(201);
      expect(deps.validateShippingAddress).not.toHaveBeenCalled();
      expect(deps.checkAddressValidationAttempt).not.toHaveBeenCalled();
      expect(deps.reserve).toHaveBeenCalledWith(
        expect.objectContaining({
          shippingAddress: body.shippingAddress,
          paymentMethod,
          protectionEvidence: expect.objectContaining({ payment_method: paymentMethod }),
        }),
      );
    },
  );
  it.each(["card", "afterpay", "cashAppPay"])(
    "blocks invalid %s destinations before reservation or Square",
    async (paymentMethod) => {
      const deps = dependencies();
      deps.validateShippingAddress.mockResolvedValue({ status: "invalid" });
      const body = await (request() as Request).json();
      const response = await prepareCheckoutHandler(
        new Request("https://shop.example.com/api/checkout/prepare", {
          headers: { cookie },
          method: "POST",
          body: JSON.stringify({ ...body, paymentMethod }),
        }) as never,
        deps,
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "SHIPPING_ADDRESS_INVALID" });
      expect(deps.reserve).not.toHaveBeenCalled();
      expect(deps.calculateSquareOrder).not.toHaveBeenCalled();
      expect(deps.createSquareOrder).not.toHaveBeenCalled();
    },
  );
  it("returns a suggested address without reserving inventory", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    const suggestedAddress = { ...body.shippingAddress, line1: "1 Main St" };
    deps.validateShippingAddress.mockResolvedValue({
      status: "suggestion",
      address: suggestedAddress,
    });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "SHIPPING_ADDRESS_SUGGESTION",
      suggestedAddress,
    });
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.checkAttempt).not.toHaveBeenCalled();
  });
  it("fails closed when Shippo is unavailable", async () => {
    const deps = dependencies();
    deps.validateShippingAddress.mockResolvedValue({ status: "unavailable" });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "SHIPPING_ADDRESS_UNAVAILABLE" });
    expect(body.error).not.toMatch(/charged/i);
    expect(deps.reserve).not.toHaveBeenCalled();
  });
  it("returns recovery for a legacy order before checking shipping", async () => {
    const deps = dependencies();
    deps.findExisting.mockResolvedValue({ squareOrderId: "existing", guarded: false });
    deps.validateShippingAddress.mockResolvedValue({ status: "invalid" });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CHECKOUT_RECOVERY_REQUIRED");
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
  });
  it("stops rate-limited address checks before contacting Shippo", async () => {
    const deps = dependencies();
    deps.checkAddressValidationAttempt.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });
    const response = await prepareCheckoutHandler(request(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
    expect(deps.checkAttempt).not.toHaveBeenCalled();
  });
  it("persists the pickup recipient and sends it to Square without Shippo", async () => {
    const deps = dependencies();
    const body = await (request() as Request).json();
    const pickupContact = { name: "Pickup Buyer", phone: "3365550100" };
    const pickupTotals = {
      subtotalCents: 10000,
      shippingCents: 0,
      taxCents: 700,
      totalCents: 10700,
    };
    deps.quote.mockResolvedValue({
      shippingCents: 0,
      taxCents: 0,
      taxCalculationId: "square:pending",
      customerState: "NC",
    });
    deps.calculateSquareOrder.mockResolvedValue(pickupTotals);
    deps.createSquareOrder.mockResolvedValue({
      ...(await deps.createSquareOrder()),
      ...pickupTotals,
    });
    deps.createSquareOrder.mockClear();
    const quoteFingerprint = createCheckoutQuoteFingerprint({
      items: [{ variantId: VARIANT_ID, quantity: 1, unitPriceCents: 10000 }],
      fulfillment: "pickup",
      shippingAddress: null,
      totals: pickupTotals,
    });
    const response = await prepareCheckoutHandler(
      new Request("https://shop.example.com/api/checkout/prepare", {
        headers: { cookie },
        method: "POST",
        body: JSON.stringify({
          ...body,
          quoteFingerprint,
          fulfillment: "pickup",
          shippingAddress: null,
          pickupContact,
        }),
      }) as never,
      deps,
    );
    expect(deps.validateShippingAddress).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(deps.reserve).toHaveBeenCalledWith(expect.objectContaining({ pickupContact }));
    expect(deps.createSquareOrder).toHaveBeenCalledWith(
      expect.objectContaining({ pickupContact }),
    );
  });
});

it("preserves inventory reason from a structured reservation RPC error", async () => {
  const db = createClient<Database>("http://localhost:54321", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: () =>
        Promise.resolve(
          Response.json(
            {
              code: "P0001",
              message: "checkout_inventory_unavailable",
              details: null,
              hint: null,
            },
            { status: 400 },
          ),
        ),
    },
  });
  const repo = new CheckoutPreparationRepository(db);
  const outcome = jest.fn();
  const result = await prepareCheckoutHandler(request(), {
    ...dependencies(),
    reserve: (input) => repo.reserveCheckout(input),
    outcome,
  });
  expect(result.status).toBe(503);
  expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ reason: "inventory" }));
});
