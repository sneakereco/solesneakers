import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { fixture, origin, order, totals, receipt } from "./checkout-browser-fixture.mjs";
import { shoe } from "./checkout-browser-fixture.mjs";

async function finalFixture(t, { suggestAddress = false, revalidate = false } = {}) {
  const f = await fixture(t, { owner: null });
  const calls = { reviews: [], submissions: [] };
  await f.ctx.addInitScript(() => {
    const create = window.Square.payments;
    window.Square.payments = (...args) => {
      const p = create(...args);
      p.paymentRequest = (input) => ({
        input,
        addEventListener() {},
        update(value) {
          Object.assign(this.input, value);
          return true;
        },
      });
      p.afterpayClearpay = async (request) => ({
        attach: async () => {},
        destroy: async () => true,
        tokenize: async () => {
          window.approvalStarted = true;
          if (window.holdApproval) await new Promise((r) => (window.releaseApproval = r));
          return {
            status: "OK",
            token: "afterpay-source",
            details: { shipping: { contact: request.input.shippingContact } },
          };
        },
      });
      return p;
    };
  });
  await f.ctx.route(origin + "/api/checkout/quote", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        completeness: "exact",
        quoteFingerprint: (body.shippingAddress?.postalCode === "20001-0001"
          ? "b"
          : "a"
        ).repeat(64),
        totals,
      },
    });
  });
  await f.ctx.route(origin + "/api/checkout/review", async (route) => {
    const body = route.request().postDataJSON();
    calls.reviews.push(body);
    if (suggestAddress && calls.reviews.length === 1)
      return route.fulfill({
        status: 422,
        json: {
          code: "SHIPPING_ADDRESS_SUGGESTION",
          error: "Confirm your address.",
          suggestedAddress: {
            ...body.shippingAddress,
            line1: "1 MARKET ST",
            postalCode: "20001-0001",
          },
          shippingConfirmation: "suggested-confirmation",
        },
      });
    return route.fulfill({ json: { reviewed: true, totals } });
  });
  await f.ctx.route(origin + "/api/checkout/submit", async (route) => {
    calls.submissions.push(route.request().postDataJSON());
    f.flow.reservations.set(
      route.request().postDataJSON().preparation.idempotencyKey,
      order,
    );
    if (f.flow.holdSubmission)
      await new Promise((resolve) => (f.flow.releaseSubmission = resolve));
    if (revalidate) {
      const page = route.request().frame().page();
      await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
      await page.waitForFunction(
        () =>
          window.fixtureSessionStatus === "ready" &&
          window.cart.validationStatus === "idle",
      );
    }
    return route
      .fulfill({
        json: {
          orderId: order,
          guestAccessToken: "from-prepare",
          totals,
          paymentResult: { status: 202, body: { status: "UNKNOWN" } },
        },
      })
      .catch(() => {});
  });
  return { ...f, calls };
}
async function afterpay(page) {
  await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Afterpay", exact: true }).click();
}

test("verified unpaid cancellation retires recovery without consuming the cart", async (t) => {
  const { open, flow, calls } = await finalFixture(t);
  flow.status = {
    ...receipt,
    status: "canceled",
    financial: {
      source: "ledger",
      snapshot: {
        orderId: order,
        revision: "1",
        financialState: "unpaid",
        capturedCents: 0,
        refundedCents: 0,
        fulfillmentStatus: "unfulfilled",
        reviewReason: null,
      },
    },
  };
  const page = await open();
  await afterpay(page);
  await page.getByRole("heading", { name: "Order canceled", exact: true }).waitFor();
  const originalKey = calls.submissions[0].preparation.idempotencyKey;
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")))
    .toBe(null);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("checkout_original_recovery_v1")),
    null,
  );
  assert.deepEqual(
    await page.evaluate(() => window.cart.items.map((row) => row.quantity)),
    [2],
  );
  await page.evaluate(() => window.navigate("/checkout"));
  await afterpay(page);
  await expect.poll(() => calls.submissions.length).toBe(2);
  assert.notEqual(calls.submissions[1].preparation.idempotencyKey, originalKey);
});

for (const kind of ["legacy", "review", "refunded"]) {
  test(`a ${kind} cancellation cannot unlock an uncertain payment`, async (t) => {
    const { open, flow } = await finalFixture(t);
    flow.status = {
      ...receipt,
      status: "canceled",
      financial:
        kind === "legacy"
          ? { source: "legacy" }
          : {
              source: "ledger",
              snapshot: {
                orderId: order,
                revision: "1",
                financialState: kind === "refunded" ? "refunded" : "unpaid",
                capturedCents: kind === "refunded" ? 2000 : 0,
                refundedCents: kind === "refunded" ? 2000 : 0,
                fulfillmentStatus: "unfulfilled",
                reviewReason: kind === "review" ? "square_status_conflict" : null,
              },
            },
    };
    const page = await open();
    await afterpay(page);
    await page
      .getByRole("heading", {
        name:
          kind === "legacy"
            ? "Order canceled"
            : kind === "refunded"
              ? "Order refund recorded"
              : "Payment under review",
        exact: true,
      })
      .waitFor();
    assert.ok(
      await page.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")),
    );
    assert.ok(
      await page.evaluate(() => sessionStorage.getItem("checkout_original_recovery_v1")),
    );
    assert.deepEqual(
      await page.evaluate(() => window.cart.items.map((row) => row.quantity)),
      [2],
    );
  });
}

test("guest accepted address keeps its quote through a same-owner session recheck", async (t) => {
  const { open, calls, flow } = await finalFixture(t, {
    suggestAddress: true,
    revalidate: true,
  });
  const page = await open();
  await afterpay(page);
  await page.getByRole("button", { name: "Accept suggested address" }).click();
  await expect.poll(() => calls.submissions.length).toBe(1);
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toMatch(/checkout\/(processing|success)/);
  assert.equal(calls.submissions[0].preparation.quoteFingerprint, "b".repeat(64));
  assert.equal(
    calls.submissions[0].preparation.shippingConfirmation,
    "suggested-confirmation",
  );
  assert.equal(calls.submissions[0].sourceId, "afterpay-source");
  assert.equal(flow.prepares.length, 0);
});

test("reload after server acceptance retains the original lookup and cannot start another payment", async (t) => {
  const { open, flow, calls } = await finalFixture(t);
  flow.holdSubmission = true;
  const page = await open();
  await afterpay(page);
  await expect.poll(() => !!flow.releaseSubmission).toBe(true);
  const key = await page.evaluate(() =>
    sessionStorage.getItem("checkout_idempotency_key"),
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("checkout_original_recovery_v1") || "null")
          ?.pair[0],
    ),
    key,
    "recovery must be durable before any response or unload callback",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Check original order" })).toBeVisible();
  await page.getByRole("button", { name: "Check original order" }).press("Enter");
  await page.getByText("Order Confirmed!").waitFor();
  assert.equal(calls.submissions.length, 1);
  assert.equal(flow.prepares[0].idempotencyKey, key);
  assert.equal(flow.prepares[0].recoveryOnly, true);
  flow.releaseSubmission();
});

test("unwritable recovery state refuses payment before the final server request", async (t) => {
  const { open, calls, ctx } = await finalFixture(t);
  await ctx.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "checkout_original_recovery_v1")
        throw new DOMException("denied", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  const page = await open();
  await afterpay(page);
  await expect(page.getByRole("button", { name: "Return to checkout" })).toBeVisible();
  assert.equal(calls.submissions.length, 0);
});

test("unavailable owner verification ends review with an actionable error", async (t) => {
  const { open, flow, ctx, calls } = await finalFixture(t);
  await ctx.route(origin + "/api/checkout/review", async (route) => {
    flow.sessionFailure = true;
    await route
      .request()
      .frame()
      .page()
      .evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
    return route.fulfill({ json: { reviewed: true, totals } });
  });
  const page = await open();
  await afterpay(page);
  await expect(page.getByRole("button", { name: "Retry cart access" })).toBeVisible();
  await expect(page.locator("dialog")).not.toBeVisible();
  assert.equal(calls.submissions.length, 0);
});

test("original-order recovery settles only captured units after a lost response and cart edit", async (t) => {
  const { open, flow, calls } = await finalFixture(t);
  flow.holdSubmission = true;
  const page = await open();
  await afterpay(page);
  await expect.poll(() => !!flow.releaseSubmission).toBe(true);
  await page.evaluate(async (shoe) => window.cart.addItem(shoe), shoe);
  await page.reload();
  await page.getByRole("button", { name: "Check original order" }).press("Enter");
  await page.getByText("Order Confirmed!").waitFor();
  await expect
    .poll(() => page.evaluate(() => window.cart.items.map((row) => row.quantity)))
    .toEqual([1]);
  assert.equal(calls.submissions.length, 1);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")),
    null,
  );
  flow.releaseSubmission();
});

test("a known guest order refreshes an unstored access token after checkout reload", async (t) => {
  const { open, flow, calls, ctx } = await finalFixture(t);
  let pending = true;
  flow.status = (url) =>
    url.searchParams.get("token") === "from-prepare"
      ? pending
        ? { ...receipt, status: "pending", purchasedLines: null }
        : receipt
      : 403;
  await ctx.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "rdk_guest_order_token")
        throw new DOMException("denied", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  const page = await open();
  await afterpay(page);
  await expect.poll(() => flow.gets.length).toBeGreaterThan(0);
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("rdk_guest_order_token")),
    null,
  );
  pending = false;
  await page.goto(origin + "/checkout");
  await page.getByRole("button", { name: "Check original order" }).press("Enter");
  await page.getByText("Order Confirmed!").waitFor();
  assert.equal(calls.submissions.length, 1);
  assert.equal(flow.prepares.at(-1).recoveryOnly, true);
});

test("a stalled original-order lookup ends without another financial submission", async (t) => {
  const { open, flow, calls, ctx } = await finalFixture(t);
  flow.holdSubmission = true;
  const page = await open();
  await afterpay(page);
  await expect.poll(() => !!flow.releaseSubmission).toBe(true);
  await page.reload();
  await ctx.route(origin + "/api/checkout/prepare", () => new Promise(() => {}));
  await page.clock.install();
  await page.getByRole("button", { name: "Check original order" }).press("Enter");
  await page.clock.fastForward(15001);
  await expect(page.getByText(/We could not find your original order/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check original order" })).toBeEnabled();
  assert.equal(calls.submissions.length, 1);
  flow.releaseSubmission();
});

async function cashAppFixture(t) {
  const f = await finalFixture(t);
  await f.ctx.addInitScript(() => {
    const create = window.Square.payments;
    window.Square.payments = (...args) => {
      const p = create(...args);
      p.cashAppPay = async (_req, options) => {
        let listener;
        return {
          attach: async () => {
            window.startCashApproval = () => options.shouldTokenize();
            window.finishCashApproval = () =>
              listener({
                detail: { tokenResult: { status: "OK", token: "cash-source" } },
              });
          },
          addEventListener(_event, fn) {
            listener = fn;
          },
          destroy: async () => true,
        };
      };
      return p;
    };
  });
  return f;
}

for (const cancel of [true, false])
  test(
    cancel
      ? "Cash App cancel ignores a late approval and permits a same-method retry"
      : "Cash App approval timeout permits a same-method retry",
    async (t) => {
      const { open, calls } = await cashAppFixture(t);
      const page = await open();
      await page.clock.install();
      await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
      await page.waitForFunction(() => typeof window.startCashApproval === "function");
      assert.equal(
        await page.evaluate(() => {
          window.lateCashApproval = window.finishCashApproval;
          return window.startCashApproval();
        }),
        true,
      );
      if (cancel) await page.getByRole("button", { name: "Cancel checkout" }).click();
      else {
        await page.clock.fastForward(301000);
        await page.getByRole("button", { name: "Return to checkout" }).click();
      }
      await page.evaluate(() => window.lateCashApproval());
      assert.equal(calls.submissions.length, 0);
      await page.waitForFunction(
        () => window.finishCashApproval !== window.lateCashApproval,
      );
      assert.equal(await page.evaluate(() => window.startCashApproval()), true);
      await page.evaluate(() => window.finishCashApproval());
      await expect.poll(() => calls.submissions.length).toBe(1);
    },
  );

test("a changed review quote refreshes the visible total before another approval", async (t) => {
  const { open, ctx, calls } = await finalFixture(t);
  let changed = false;
  await ctx.route(origin + "/api/checkout/quote", (route) =>
    route.fulfill({
      json: {
        completeness: "exact",
        quoteFingerprint: (changed ? "b" : "a").repeat(64),
        totals: changed ? { ...totals, totalCents: 2100, taxCents: 100 } : totals,
      },
    }),
  );
  await ctx.route(origin + "/api/checkout/review", (route) => {
    changed = true;
    return route.fulfill({
      status: 409,
      json: {
        code: "CHECKOUT_TOTALS_CHANGED",
        error: "Checkout totals changed. Review the updated total and try again.",
      },
    });
  });
  const page = await open();
  await afterpay(page);
  await page.getByRole("button", { name: "Return to checkout" }).click();
  await expect
    .poll(() => page.getByText("$21.00", { exact: true }).count())
    .toBeGreaterThan(0);
  assert.equal(calls.submissions.length, 0);
});

test("a stock conflict during review offers cart recovery before any financial submission", async (t) => {
  const { open, ctx, calls } = await finalFixture(t);
  await ctx.route(origin + "/api/checkout/review", (route) =>
    route.fulfill({
      status: 409,
      json: {
        code: "INVENTORY_CONFLICT",
        paymentState: "not_submitted",
        conflicts: [
          {
            productId: shoe.productId,
            variantId: shoe.variantId,
            requestedQuantity: 2,
            availableQuantity: 0,
            reason: "sold_out",
          },
        ],
      },
    }),
  );
  const page = await open();
  await afterpay(page);
  await expect(page.getByRole("link", { name: "Review your cart" })).toBeVisible();
  assert.equal(calls.submissions.length, 0);
});

test("long Afterpay approval holds no stock and submits only after a usable source", async (t) => {
  const { open, calls, flow } = await finalFixture(t);
  const page = await open();
  await page.evaluate(() => (window.holdApproval = true));
  await page.clock.install();
  await afterpay(page);
  await page.waitForFunction(() => window.approvalStarted);
  assert.equal(calls.submissions.length, 0);
  assert.equal(flow.permits, 0);
  assert.equal(flow.prepares.length, 0);
  await page.clock.fastForward(121000);
  assert.equal(calls.submissions.length, 0);
  await page.evaluate(() => window.releaseApproval());
  await expect.poll(() => calls.submissions.length).toBe(1);
});

for (const cancel of [true, false])
  test(
    cancel
      ? "canceling provider approval retires a late callback"
      : "stalled provider approval ends with recovery controls",
    async (t) => {
      const { open, calls } = await finalFixture(t);
      const page = await open();
      await page.evaluate(() => (window.holdApproval = true));
      await page.clock.install();
      await afterpay(page);
      await page.waitForFunction(() => window.approvalStarted);
      if (cancel) await page.getByRole("button", { name: "Cancel checkout" }).click();
      else await page.clock.fastForward(301000);
      if (cancel) await expect(page.locator("dialog")).not.toBeVisible();
      else
        await expect(
          page.getByRole("button", { name: "Return to checkout" }),
        ).toBeVisible();
      await page.evaluate(() => window.releaseApproval());
      await page.waitForTimeout(30);
      assert.equal(calls.submissions.length, 0);
    },
  );
