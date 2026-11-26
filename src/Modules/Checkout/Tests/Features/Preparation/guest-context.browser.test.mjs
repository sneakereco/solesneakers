import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { mountCheckoutBrowser } from "../../../../../../tests/browser/fixtures/checkout-hardening.mjs";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const { checkoutQuoteHandler } = require("../../../../../lib/checkout/checkout-quote.ts");
const {
  prepareCheckoutHandler,
} = require("../../../../../lib/checkout/prepare-checkout.ts");

test(
  "overlapping first quotes in two Chromium tabs preserve a lost preparation after the second Set-Cookie arrives",
  { timeout: 45000 },
  async () => {
    const secret = "browser-fixture-signing-secret-for-task7";
    const prior = process.env.CHECKOUT_IDENTITY_HMAC_SECRET;
    process.env.CHECKOUT_IDENTITY_HMAC_SECRET = secret;
    const item = {
      productId: "11111111-1111-4111-8111-111111111111",
      variantId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
      unitPriceCents: 1000,
      unitCostCents: 0,
      lineTotalCents: 1000,
      variantSku: "test",
      productName: "Fixture",
      brand: "fixture",
      model: null,
      category: "shoes",
      condition: "new",
      sizeLabel: "10",
    };
    const totals = {
      subtotalCents: 1000,
      shippingCents: 0,
      taxCents: 80,
      totalCents: 1080,
    };
    const quoteBody = {
      items: [{ productId: item.productId, variantId: item.variantId, quantity: 1 }],
      fulfillment: "pickup",
      shippingAddress: null,
    };
    const orderId = "33333333-3333-4333-8333-333333333333",
      deviceSessionId = "44444444-4444-4444-8444-444444444444";
    const prepareBody = {
      ...quoteBody,
      deviceSessionId,
      idempotencyKey: orderId,
      pickupContact: { name: "Buyer", phone: "5555555555" },
      billingAddress: {
        givenName: "Test",
        familyName: "Buyer",
        line1: "1 Main St",
        city: "Charleston",
        state: "SC",
        postalCode: "29401",
        country: "US",
      },
      buyerEmail: "buyer@fixture.invalid",
      paymentMethod: "card",
    };
    const starts = [Promise.withResolvers(), Promise.withResolvers()];
    const send = [Promise.withResolvers(), Promise.withResolvers()];
    let prepared = null,
      quotes = 0,
      allocations = 0,
      lost = false;
    const deps = {
      findTenantId: async () => "fixture-tenant",
      getAccess: async () => ({ open: true }),
      verifyBrowser: async () => ({ allowed: true, reason: "passed" }),
      getSession: async () => null,
      shippingConfirmationSecret: () => secret,
      getClientIp: () => "127.0.0.1",
      hashEmail: () => "f".repeat(64),
      getSquareClientConfig: () => ({}),
      findExisting: async () => prepared,
      now: () => new Date(),
      checkAttempt: async () => ({ allowed: true }),
      resolveCart: async () => ({ items: [item], subtotalCents: 1000 }),
      quote: async () => ({ shippingCents: 0, customerState: "SC" }),
      calculateSquareOrder: async () => totals,
      reserve: async (input) => {
        if (prepared) {
          assert.equal("guest:" + prepared.guestContextHash, input.ownerBinding);
          return {
            kind: "reserved",
            orderId,
            expiresAt: prepared.expiresAt,
            reused: true,
          };
        }
        allocations++;
        prepared = {
          orderId,
          guarded: true,
          guestContextHash: input.ownerBinding.slice(6),
          userId: null,
          deviceSessionId,
          cartHash: input.cartHash,
          status: "pending",
          items: [item],
          expiresAt: new Date(Date.now() + 900000).toISOString(),
          ...totals,
        };
        return {
          kind: "reserved",
          orderId,
          expiresAt: prepared.expiresAt,
          reused: false,
        };
      },
      createSquareOrder: async () => ({ ...totals, id: "fixture-order", version: 1 }),
      attachSquareOrder: async () => {
        prepared.squareOrderId = "fixture-order";
        prepared.squareOrderVersion = 1;
      },
      createGuestAccessToken: async () => "inert-fixture-result",
      reportError: (e) => {
        throw e;
      },
    };
    let browser;
    try {
      browser = await mountCheckoutBrowser({
        route: async (route, url) => {
          const req = route.request();
          if (url.pathname === "/api/cart/validate")
            return route.fulfill({ json: { items: [] } });
          const headers = await req.allHeaders();
          const input = new Request(url, {
            method: "POST",
            headers,
            body: req.postData(),
          });
          let response;
          if (url.pathname === "/api/checkout/quote") {
            const idx = quotes++;
            assert.equal(headers.cookie, undefined);
            response = await checkoutQuoteHandler(input, deps);
            assert.equal(response.status, 200);
            starts[idx].resolve();
            await send[idx].promise;
          } else {
            assert.equal(url.pathname, "/api/checkout/prepare");
            response = await prepareCheckoutHandler(input, deps);
            if (!lost) {
              assert.equal(response.status, 201);
              lost = true;
              return route.abort("connectionreset");
            }
          }
          return route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          });
        },
      });
      const other = await browser.context.newPage();
      await other.goto(browser.page.url());
      const post = (page, path, body) =>
        page.evaluate(
          async ({ path, body }) => {
            try {
              const result = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              return { status: result.status, body: await result.json() };
            } catch {
              return { status: 0 };
            }
          },
          { path, body },
        );
      const first = post(browser.page, "/api/checkout/quote", quoteBody);
      await starts[0].promise;
      const delayed = post(other, "/api/checkout/quote", quoteBody);
      await starts[1].promise;
      send[0].resolve();
      const quote = await first;
      const body = { ...prepareBody, quoteFingerprint: quote.body.quoteFingerprint };
      assert.equal((await post(browser.page, "/api/checkout/prepare", body)).status, 0);
      assert.ok(lost);
      send[1].resolve();
      assert.equal((await delayed).status, 200);
      const retry = await post(browser.page, "/api/checkout/prepare", body);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.orderId, orderId);
      assert.equal(retry.body.reused, true);
      assert.equal((await post(other, "/api/checkout/prepare", body)).status, 200);
      assert.equal(allocations, 1);
      const proofs = (await browser.context.cookies()).filter((c) =>
        c.name.startsWith("__Host-checkout-context"),
      );
      assert.equal(proofs.length, 2);
      assert.ok(
        proofs.every(
          (c) => c.secure && c.httpOnly && c.sameSite === "Lax" && c.path === "/",
        ),
      );
      assert.ok(
        !(await other.evaluate(() => document.cookie)).includes(
          "__Host-checkout-context",
        ),
      );
    } finally {
      for (const handle of send) handle.resolve();
      if (browser) await browser.close();
      if (prior === undefined) delete process.env.CHECKOUT_IDENTITY_HMAC_SECRET;
      else process.env.CHECKOUT_IDENTITY_HMAC_SECRET = prior;
    }
  },
);
