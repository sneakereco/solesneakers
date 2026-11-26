import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mountCheckoutBrowser } from "../../../../../../tests/browser/fixtures/checkout-hardening.mjs";
test("price review survives automatic revalidation and excludes the line from the payable total until accepted", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    guestItems: [other],
    route: (route) =>
      route.fulfill({ json: { items: [{ ...other, priceCents: 4100 }], removed: [] } }),
  });
  t.after(close);
  const review = page.getByRole("button", { name: "Accept updated price" });
  await expect(review).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(await page.evaluate(() => window.testCart.total), 0);
  await expect(page.getByText(/price changed from.*35.00.*41.00/i)).toBeVisible();
  const before = await page.evaluate(async () =>
    window.testCart.captureForCheckout({
      mode: "new",
      attemptKey: crypto.randomUUID(),
      expectedItems: window.testCart.items,
    }),
  );
  assert.notEqual(before.status, "captured");
  await review.click();
  await expect.poll(() => page.evaluate(() => window.testCart.total)).toBe(4100);
  await expect(review).toHaveCount(0);
});
test("legacy reply carrying retired placeholder loads the real current image on the full cart page", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    guestItems: [{ ...runner, imageUrl: "/old.jpg" }],
    route: (route) => route.fulfill({ json: { items: [runner], removed: [] } }),
  });
  t.after(close);
  const image = page.getByRole("img", { name: "Air Runner" });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", "/images/logo.png");
  await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBeGreaterThan(1);
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("rdk_cart_session"))[0].imageUrl,
    ),
    "/images/logo.png",
  );
});
test("a tab-local reset waits for the cart lock and rejects changed bytes", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    waitReady: false,
    setupDocument: () => sessionStorage.setItem("rdk_cart_session", " ".repeat(2000001)),
    route: offline,
  });
  t.after(close);
  await page.getByRole("button", { name: "Reset this saved cart" }).click();
  const kept = await page.evaluate(async (row) => {
    let release;
    const locked = new Promise((resolve) =>
      navigator.locks.request(
        "rdk_cart",
        () =>
          new Promise((r) => {
            release = r;
            resolve();
          }),
      ),
    );
    await locked;
    const operation = window.testCart.resetSavedBasket();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const wait = (await navigator.locks.query()).pending.some(
      (l) => l.name === "rdk_cart",
    );
    sessionStorage.setItem("rdk_cart_session", JSON.stringify([row]));
    release();
    const result = await operation;
    return { wait, result, raw: JSON.parse(sessionStorage.getItem("rdk_cart_session")) };
  }, other);
  assert.equal(kept.wait, true);
  assert.equal(kept.result.status, "stale");
  assert.deepEqual(kept.raw, [other]);
});
test("a queued repair loses its owner observation on sign-in change", async (t) => {
  const user = { id: "a", email: "a@fixture.invalid" };
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    initialUser: user,
    accountItems: { b: [other] },
    waitReady: false,
    documentData: user,
    setupDocument: (initial) => {
      localStorage.setItem("rdk_cart_user_a", " ".repeat(2000001));
      window.user = initial;
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) =>
        input === "/api/auth/session"
          ? Promise.resolve(Response.json({ user: window.user, role: "customer" }))
          : fetch(input, init);
    },
    route: offline,
  });
  t.after(close);
  await page.getByRole("button", { name: "Reset this saved cart" }).click();
  await page.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((r) => (window.release = r)),
    );
  });
  await page.waitForFunction(() => window.release);
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await page.waitForFunction(
    async () => (await navigator.locks.query()).pending.length > 0,
  );
  await page.evaluate(() => {
    window.user = { id: "b", email: "b@fixture.invalid" };
    window.dispatchEvent(new Event("sessionUpdate"));
  });
  await page.waitForFunction(() => window.testSession.user?.id === "b");
  await page.evaluate(() => window.release());
  await expect(page.getByRole("heading", { name: "Court" })).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("rdk_cart_user_a").length),
    2000001,
  );
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rdk_cart_user_b"))),
    [other],
  );
});
test("queued account repair cannot clear newer bytes or another account", async (t) => {
  const { page, context, close } = await mountCheckoutBrowser({
    initialUser: { id: "a", email: "a@fixture.invalid" },
    view: "fullCart",
    waitReady: false,
    setupDocument: () => {
      localStorage.setItem("rdk_cart_user_a", " ".repeat(2000001));
      localStorage.setItem("rdk_cart_user_b", "preserve-other-owner");
    },
    route: offline,
  });
  t.after(close);
  await page.getByRole("button", { name: "Reset this saved cart" }).click();
  const locker = await context.newPage();
  await locker.route("**/locker", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await locker.goto("https://checkout-fixture.invalid/locker");
  await locker.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((r) => (window.release = r)),
    );
  });
  await locker.waitForFunction(() => window.release);
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await page.waitForFunction(async () =>
    (await navigator.locks.query()).pending.some((l) => l.name === "rdk_cart"),
  );
  await locker.evaluate((row) => {
    localStorage.setItem("rdk_cart_user_a", JSON.stringify([row]));
    window.release();
  }, other);
  await page.getByRole("button", { name: "Retry cart access" }).click();
  await expect(page.getByRole("heading", { name: "Court" })).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() => [
      JSON.parse(localStorage.getItem("rdk_cart_user_a")),
      localStorage.getItem("rdk_cart_user_b"),
    ]),
    [[other], "preserve-other-owner"],
  );
});
test("explicit reset creates new units and preserves the bound association for receipt replay", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    guestItems: [other],
    route: offline,
  });
  t.after(close);
  const proof = await page.evaluate(async (row) => {
    const cart = window.testCart,
      attemptKey = crypto.randomUUID(),
      orderId = crypto.randomUUID(),
      expectedItems = [
        { productId: row.productId, variantId: row.variantId, quantity: 1 },
      ];
    const capture = await cart.captureForCheckout({
      mode: "new",
      attemptKey,
      expectedItems,
    });
    const bound = await cart.bindPreparedOrder(capture.captureId, orderId);
    sessionStorage.setItem("rdk_cart_session", " ".repeat(2000001));
    await window.testCart.recheckAvailability();
    return { attemptKey, orderId, expectedItems, bound };
  }, other);
  assert.equal(proof.bound, true);
  await page.getByRole("button", { name: "Reset this saved cart" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await page.evaluate((row) => window.testCart.addItem(row), other);
  await expect(page.getByRole("heading", { name: "Court" })).toBeVisible();
  const outcome = await page.evaluate(async ({ attemptKey, orderId, expectedItems }) => {
    const cart = window.testCart;
    const resume = await cart.captureForCheckout({
      attemptKey,
      expectedItems,
      mode: "resume",
    });
    return {
      resume,
      consumed: await cart.consumeConfirmedPurchase(orderId, expectedItems),
      items: cart.items,
    };
  }, proof);
  assert.equal(outcome.resume.status, "captured");
  assert.equal(outcome.consumed.status, "matched");
  assert.deepEqual(outcome.items, [other]);
});
test("reset retires an unbound start, refuses its late bind and permits a fresh capture after deliberate re-add", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    guestItems: [other],
    route: offline,
  });
  t.after(close);
  const proof = await page.evaluate(async (row) => {
    const attemptKey = crypto.randomUUID(),
      expectedItems = [
        { productId: row.productId, variantId: row.variantId, quantity: 1 },
      ];
    const capture = await window.testCart.captureForCheckout({
      mode: "new",
      attemptKey,
      expectedItems,
    });
    sessionStorage.setItem("rdk_cart_session", " ".repeat(2000001));
    await window.testCart.recheckAvailability();
    return { attemptKey, expectedItems, captureId: capture.captureId };
  }, other);
  await page.getByRole("button", { name: "Reset this saved cart" }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await page.evaluate((row) => window.testCart.addItem(row), other);
  await expect(page.getByRole("heading", { name: "Court" })).toBeVisible();
  const result = await page.evaluate(async ({ attemptKey, expectedItems, captureId }) => {
    const cart = window.testCart;
    const resume = await cart.captureForCheckout({
      mode: "resume",
      attemptKey,
      expectedItems,
    });
    const bind = await cart.bindPreparedOrder(captureId, crypto.randomUUID());
    const fresh = await cart.captureForCheckout({
      mode: "new",
      attemptKey: crypto.randomUUID(),
      expectedItems,
    });
    return { resume, bind, fresh };
  }, proof);
  assert.equal(result.resume.status, "stale");
  assert.equal(result.bind, false);
  assert.equal(result.fresh.status, "captured");
  assert.notEqual(result.fresh.captureId, proof.captureId);
});
test("conditional scope release cannot clear a newer registration and fences its outstanding response", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    guestItems: [other],
    setupDocument: () => {
      window.seen = [];
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) =>
        input === "/api/cart/validate"
          ? new Promise((resolve) =>
              window.seen.push({ order: JSON.parse(init.body).order, resolve }),
            )
          : fetch(input, init);
    },
    route: offline,
  });
  t.after(close);
  await page.waitForFunction(() => window.seen.length === 1);
  const order = {
    orderId: "44444444-4444-4444-8444-444444444444",
    guestAccessToken: "old-proof",
  };
  const returnsRelease = await page.evaluate((order) => {
    window.oldRelease = window.testCart.scopeValidationToOrder(order);
    return typeof window.oldRelease === "function";
  }, order);
  assert.equal(returnsRelease, true);
  await page.waitForFunction(() => window.seen.length === 2);
  await page.evaluate((order) => {
    window.newRelease = window.testCart.scopeValidationToOrder({
      ...order,
      guestAccessToken: "new-proof",
    });
    window.oldRelease();
  }, order);
  await page.waitForFunction(() => window.seen.length === 3);
  await page.evaluate(() => {
    void window.testCart.recheckAvailability();
  });
  await page.waitForFunction(() => window.seen.length === 4);
  assert.equal(
    await page.evaluate(() => window.seen[3].order?.guestAccessToken),
    "new-proof",
  );
  const saved = await page.evaluate(() => sessionStorage.getItem("rdk_cart_session"));
  await page.evaluate((row) => {
    window.newRelease();
    window.seen[3].resolve(
      Response.json({
        items: [],
        removed: [
          { productId: row.productId, variantId: row.variantId, reason: "not_found" },
        ],
      }),
    );
  }, other);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("rdk_cart_session")),
    saved,
  );
  await page.evaluate(() => {
    void window.testCart.recheckAvailability();
  });
  await page.waitForFunction(() => window.seen.length === 5);
  assert.equal(await page.evaluate(() => window.seen[4].order), undefined);
});
test("late unscoped and superseded-order validation cannot overwrite a restored stock-zero hold", async (t) => {
  const current = { orderId: "44444444-4444-4444-8444-444444444444" },
    prior = { orderId: "55555555-5555-4555-8555-555555555555" };
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    initialUser: { id: "a", email: "a@fixture.invalid" },
    accountItems: { a: [other] },
    setupDocument: () => {
      window.pendingChecks = [];
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) =>
        input === "/api/cart/validate"
          ? new Promise((resolve) =>
              window.pendingChecks.push({ payload: JSON.parse(init.body), resolve }),
            )
          : fetch(input, init);
    },
    route: offline,
  });
  t.after(close);
  await page.waitForFunction(() => window.pendingChecks.length === 1);
  await page.evaluate((order) => window.testCart.scopeValidationToOrder(order), prior);
  await page.waitForFunction(() => window.pendingChecks.length === 2);
  await page.evaluate((order) => window.testCart.scopeValidationToOrder(order), current);
  await page.waitForFunction(() => window.pendingChecks.length === 3);
  assert.deepEqual(
    await page.evaluate(() => window.pendingChecks.map((r) => r.payload.order ?? null)),
    [null, prior, current],
  );
  const reply = async (index, owns) =>
    page.evaluate(
      ({ index, owns, row }) => {
        const pair = { productId: row.productId, variantId: row.variantId };
        const availability = owns ? "available" : "unavailable";
        window.pendingChecks[index].resolve(
          Response.json({
            contractVersion: 2,
            items: [],
            removed: [{ ...pair, reason: "out_of_stock" }],
            lineState: [
              {
                ...pair,
                requestedQuantity: 1,
                availableQuantity: owns ? 1 : 0,
                availability,
                reason: availability,
                facts: row,
                ...(owns ? { orderScoped: true } : {}),
              },
            ],
          }),
        );
      },
      { index, owns, row: other },
    );
  await reply(2, true);
  await expect
    .poll(() => page.evaluate(() => window.testCart.items[0].orderScoped))
    .toBe(true);
  const version = () =>
    page.evaluate(() => [
      localStorage.getItem("rdk_cart_user_a"),
      localStorage.getItem("rdk_cart_user_a:revision"),
    ]);
  const saved = await version();
  await reply(1, false);
  await reply(0, false);
  await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
  assert.deepEqual(await version(), saved);
  assert.equal(await page.evaluate(() => window.testCart.items[0].maxStock), 1);
});
test("same verified guest keeps its scoped stock-zero hold across visibility and a new owner never inherits it", async (t) => {
  const order = {
    orderId: "44444444-4444-4444-8444-444444444444",
    guestAccessToken: "synthetic-private-order-proof",
  };
  const seen = [];
  let user = null;
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    guestItems: [other],
    accountItems: { b: [other] },
    sessionRoute: (route) =>
      route.fulfill({ json: { user, role: user ? "customer" : null } }),
    route: async (route, url) => {
      if (url.pathname !== "/api/cart/validate") return offline(route);
      const request = route.request().postDataJSON();
      seen.push(request.order);
      const authorized =
        request.order?.orderId === order.orderId &&
        request.order.guestAccessToken === order.guestAccessToken;
      return route.fulfill({
        json: {
          contractVersion: 2,
          items: [],
          removed: [
            {
              productId: other.productId,
              variantId: other.variantId,
              reason: "out_of_stock",
            },
          ],
          lineState: [
            {
              productId: other.productId,
              variantId: other.variantId,
              requestedQuantity: 1,
              availableQuantity: authorized ? 1 : 0,
              availability: authorized ? "available" : "unavailable",
              reason: authorized ? "available" : "unavailable",
              facts: other,
              ...(authorized ? { orderScoped: true } : {}),
            },
          ],
        },
      });
    },
  });
  t.after(close);
  await expect
    .poll(() => page.evaluate(() => window.testCart.items[0]?.availability))
    .toBe("unavailable");
  await page.evaluate((order) => {
    window.oldScope = window.testCart.scopeValidationToOrder;
    window.oldRelease = window.oldScope(order);
    return window.testCart.recheckAvailability();
  }, order);
  await expect
    .poll(() => page.evaluate(() => window.testCart.items[0]?.maxStock))
    .toBe(1);
  const verify = async () => {
    const start = seen.length;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => seen.length).toBeGreaterThan(start);
    await page.waitForFunction(() => window.testCart.isReady);
  };
  await verify();
  await expect.poll(() => seen.at(-1)).toEqual(order);
  await page.evaluate(() => {
    window.oldScope({ orderId: "wrong-old-scope", guestAccessToken: "stale" });
    return window.testCart.recheckAvailability();
  });
  assert.deepEqual(seen.at(-1), order);
  await expect
    .poll(() => page.evaluate(() => window.testCart.items[0]?.maxStock))
    .toBe(1);
  user = { id: "b", email: "b@fixture.invalid" };
  await verify();
  await expect.poll(() => page.evaluate(() => window.testSession.user?.id)).toBe("b");
  await page.evaluate(() => window.testCart.recheckAvailability());
  assert.equal(seen.at(-1), undefined);
  const accountOrder = { orderId: "66666666-6666-4666-8666-666666666666" };
  await page.evaluate((order) => {
    window.testCart.scopeValidationToOrder(order);
    window.oldRelease();
    return window.testCart.recheckAvailability();
  }, accountOrder);
  assert.deepEqual(seen.at(-1), accountOrder);
  user = null;
  await verify();
  await expect
    .poll(() => page.evaluate(() => window.testSession.user?.id ?? null))
    .toBe(null);
  await page.evaluate(() => window.testCart.recheckAvailability());
  assert.equal(seen.at(-1), undefined);
  assert.equal(
    await page.evaluate(
      (token) =>
        [localStorage, sessionStorage].some((area) =>
          Object.keys(area).some((k) => area.getItem(k)?.includes(token)),
        ),
      order.guestAccessToken,
    ),
    false,
  );
});
const offline = (route) => route.fulfill({ status: 503, body: "offline" });
for (const mixed of [false, true])
  test("full page has one notice for unreadable rows " + mixed, async (t) => {
    const { page, close } = await mountCheckoutBrowser({
      view: "fullCart",
      guestItems: mixed ? [{}, other] : [{}],
      route: offline,
    });
    t.after(close);
    await expect(
      page.getByText("Some saved cart items could not be read.", { exact: false }),
    ).toHaveCount(1);
  });
test("explicit reset clears just the observed oversized basket and preserves order credentials", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "fullCart",
    waitReady: false,
    setupDocument: () => {
      sessionStorage.setItem("rdk_cart_session", " ".repeat(2000001));
      sessionStorage.setItem("rdk_guest_order_token", "keep");
    },
    route: offline,
  });
  t.after(close);
  await page
    .getByRole("button", { name: "Reset this saved cart" })
    .click({ timeout: 2000 });
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  assert.deepEqual(
    await page.evaluate(() => [
      sessionStorage.getItem("rdk_cart_session"),
      sessionStorage.getItem("rdk_guest_order_token"),
    ]),
    ["[]", "keep"],
  );
});
const productId = "11111111-1111-4111-8111-111111111111",
  variantId = "22222222-2222-4222-8222-222222222222";
const runner = {
  productId,
  variantId,
  name: "Air Runner",
  titleDisplay: "Air Runner",
  brand: "",
  sizeLabel: "10",
  quantity: 1,
  priceCents: 3500,
  imageUrl: "/placeholder.png",
  maxStock: 1,
};
const other = {
  ...runner,
  variantId: "33333333-3333-4333-8333-333333333333",
  name: "Court",
  titleDisplay: "Court",
  imageUrl: "/images/logo.png",
};
for (const [state, timing] of [
  ["not_submitted", "immediate"],
  ["unknown", "immediate"],
  ["submitted", "immediate"],
  ["unknown", "reverified"],
  ["submitted", "denied cart write"],
  ["submitted", "locked cart write"],
  ["unknown", "superseded key"],
  ["submitted", "superseded fingerprint"],
  ["unknown", "superseded owner"],
]) {
  test(
    "same-attempt stock conflict " +
      state +
      " / " +
      timing +
      " shows truthful feedback and blocks a mixed-basket charge",
    async (t) => {
      const totals = {
        subtotalCents: 7000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 7000,
      };
      const address = {
        name: "Shopper A",
        phone: "3025550100",
        line1: "10 A St",
        line2: "",
        city: "Wilmington",
        state: "DE",
        postalCode: "19801",
        country: "US",
      };
      const user = { id: "account-a", email: "a@fixture.invalid" };
      const calls = [];
      let releasePrepare;
      const delayed = new Promise((resolve) => {
        releasePrepare = resolve;
      });
      let sessionUser = user;
      const { page, close } = await mountCheckoutBrowser({
        view: "checkout",
        initialUser: user,
        accountItems: { "account-a": [runner, other], "account-b": [other] },
        sessionRoute: (route) =>
          route.fulfill({ json: { user: sessionUser, role: "customer" } }),
        documentData: {
          ownerId: user.id,
          isGuest: false,
          customer: { email: user.email, address },
          paymentConfig: {
            applicationId: "fixture-square",
            locationId: "fixture-location",
            environment: "sandbox",
          },
        },
        setupDocument: (data) => {
          window.fixtureInitialCheckout = data;
        },
        route: async (route, url) => {
          calls.push(url.pathname);
          if (url.pathname === "/api/cart/validate") return offline(route);
          if (url.pathname === "/api/checkout/quote")
            return route.fulfill({
              json: { completeness: "exact", quoteFingerprint: "a".repeat(64), totals },
            });
          if (url.pathname === "/api/checkout/prepare") {
            if (timing !== "immediate") await delayed;
            return route.fulfill({
              status: 409,
              json: {
                code: "INVENTORY_CONFLICT",
                paymentState: state,
                conflicts: [
                  {
                    productId,
                    variantId,
                    requestedQuantity: 1,
                    availableQuantity: 0,
                    reason: "reserved_by_other",
                  },
                ],
              },
            });
          }
          return offline(route);
        },
      });
      t.after(close);
      await page.getByLabel("Name on card", { exact: true }).fill("Shopper A");
      await page.getByRole("button", { name: /Pay .* now/i }).click();
      if (timing !== "immediate") {
        await expect.poll(() => calls.includes("/api/checkout/prepare")).toBe(true);
        if (timing === "reverified" || timing === "superseded owner") {
          await page.evaluate(() => {
            window.oldApply = window.testCart.applyStockConflicts;
          });
          if (timing === "superseded owner")
            sessionUser = { id: "account-b", email: "b@fixture.invalid" };
          await page.evaluate(() => window.testSession.refreshSession());
          await page.waitForFunction(
            (id) =>
              window.testSession.user?.id === id &&
              window.testCart.isReady &&
              window.testCart.applyStockConflicts !== window.oldApply,
            sessionUser.id,
          );
        }
        if (timing === "superseded key" || timing === "superseded fingerprint") {
          await page.evaluate(
            (timing) =>
              sessionStorage.setItem(
                timing === "superseded key"
                  ? "checkout_idempotency_key"
                  : "checkout_cart_fingerprint",
                "replacement-pair",
              ),
            timing,
          );
        }
        if (timing === "locked cart write") {
          await page.evaluate(() => {
            void navigator.locks.request(
              "rdk_cart",
              () => new Promise((r) => (window.releaseProjectionLock = r)),
            );
          });
          await page.waitForFunction(() => window.releaseProjectionLock);
        }
        if (timing === "denied cart write")
          await page.evaluate(() => {
            const write = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
              if (this === localStorage && k === "rdk_cart_user_account-a") {
                Storage.prototype.setItem = write;
                throw new DOMException("Controlled quota failure", "QuotaExceededError");
              }
              write.call(this, k, v);
            };
          });
        const handled = page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/checkout/prepare",
        );
        releasePrepare();
        await handled;
        if (timing === "denied cart write") {
          await page.waitForFunction(() => !window.testCart.isReady);
          await page.evaluate(() => window.testCart.retryAccess());
          await page.waitForFunction(() => window.testCart.isReady);
        }
      }
      const proof =
        "Someone else just reserved the last pair of Air Runner, size 10. You haven't been charged.";
      if (timing.startsWith("superseded")) {
        if (timing === "superseded owner")
          await expect(
            page.getByRole("textbox", { name: "Email", exact: true }),
          ).toHaveValue("b@fixture.invalid");
        else {
          await expect(
            page.getByText("Your cart changed. Review your items before paying.", {
              exact: true,
            }),
          ).toBeVisible({ timeout: 2500 });
          assert.equal(
            await page.evaluate(
              (timing) =>
                sessionStorage.getItem(
                  timing === "superseded key"
                    ? "checkout_idempotency_key"
                    : "checkout_cart_fingerprint",
                ),
              timing,
            ),
            "replacement-pair",
          );
        }
        await expect(page.getByText(/check your order status/i)).toHaveCount(0);
        assert.ok(
          await page.evaluate(() =>
            window.testCart.items.every((row) => !row.orderScoped && !row.availability),
          ),
        );
      } else if (state === "not_submitted") {
        await expect(page.getByText(proof, { exact: true })).toBeVisible({
          timeout: 2500,
        });
        const result = await page.evaluate(async () => {
          const cart = window.testCart;
          const capture = await cart.captureForCheckout({
            mode: "new",
            attemptKey: crypto.randomUUID(),
            expectedItems: cart.items.map(({ productId, variantId, quantity }) => ({
              productId,
              variantId,
              quantity,
            })),
          });
          return { total: cart.total, other: cart.items[1], capture };
        });
        assert.equal(result.total, 3500);
        assert.deepEqual(result.other, other);
        assert.notEqual(result.capture.status, "captured");
      } else {
        await expect(page.getByText(/check.*order status/i).first()).toBeVisible({
          timeout: 2500,
        });
        await expect(page.getByText(/haven't been charged/i)).toHaveCount(0);
        await expect
          .poll(() => page.evaluate(() => window.testCart.total))
          .toBe(timing === "immediate" ? 3500 : 7000);
        assert.equal(await page.evaluate(() => window.testCart.items[0].quantity), 1);
        if (timing !== "immediate") {
          await expect(
            page
              .getByRole("status")
              .getByText("Check your order status before trying another payment.", {
                exact: true,
              }),
          ).toBeAttached();
          assert.ok(
            await page.evaluate(
              () =>
                sessionStorage.getItem("checkout_idempotency_key") &&
                sessionStorage.getItem("checkout_cart_fingerprint"),
            ),
          );
          if (timing === "locked cart write") {
            await page.waitForFunction(async () =>
              (await navigator.locks.query()).pending.some((l) => l.name === "rdk_cart"),
            );
            // A previously accepted recovery notice belongs to this form. Its
            // queued cart edit must not stamp a successor financial pair.
            await page.evaluate(() => {
              sessionStorage.setItem("checkout_idempotency_key", "next-attempt");
              window.releaseProjectionLock();
              return navigator.locks.request("rdk_cart", () => {});
            });
            assert.equal(
              await page.evaluate(() => window.testCart.items[0].orderScoped),
              undefined,
            );
            assert.equal(
              await page.evaluate(
                () =>
                  JSON.parse(localStorage.getItem("rdk_cart_user_account-a"))[0]
                    .availability,
              ),
              undefined,
            );
          }
          const dismiss = page.getByRole("button", { name: "Return to checkout" });
          if (await dismiss.isVisible()) await dismiss.click();
          await expect(
            page.getByRole("button", { name: "Pay now", exact: true }),
          ).toBeDisabled();
        }
      }
      assert.equal(calls.filter((p) => p === "/api/checkout/prepare").length, 1);
      assert.equal(
        calls.includes("/api/checkout/payment-permit") ||
          calls.includes("/api/checkout/pay"),
        false,
      );
    },
  );
}
test("stock loss keeps the requested row, excludes it from the total, and offers recheck and remove", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    guestItems: [runner, other],
    route: async (route, url) => {
      if (url.pathname === "/api/cart/validate")
        return route.fulfill({
          json: {
            items: [other],
            removed: [{ productId, variantId, reason: "out_of_stock" }],
            contractVersion: 2,
            lineState: [
              {
                productId,
                variantId,
                requestedQuantity: 1,
                availableQuantity: 0,
                availability: "reserved_by_other",
                reason: "reserved_by_other",
              },
              {
                productId,
                variantId: other.variantId,
                requestedQuantity: 1,
                availableQuantity: 1,
                availability: "available",
                reason: "available",
                facts: other,
              },
            ],
          },
        });
      return route.fulfill({ status: 503, body: "offline" });
    },
  });
  t.after(close);
  await expect(page.getByText(/Air Runner, size 10.*available/)).toBeVisible({
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.testCart.total), 3500);
  assert.deepEqual(await page.evaluate(() => window.testCart.items[1]), other);
  await expect(page.getByText(/haven't been charged/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Recheck availability" }).click();
  await page.getByRole("button", { name: "Remove Air Runner from cart" }).click();
  await expect(page.getByRole("heading", { name: "Air Runner" })).toHaveCount(0);
});

for (const change of [
  "later edit",
  "identical replacement",
  "new capture",
  "queued supersession",
]) {
  test("post-capture conflict writer preserves " + change, async (t) => {
    const user = { id: "owner", email: "owner@example.test" };
    const { page, close } = await mountCheckoutBrowser({
      initialUser: user,
      accountItems: { owner: [runner] },
      route: offline,
    });
    t.after(close);
    const result = await page.evaluate(
      async ({ change, runner }) => {
        const cart = window.testCart;
        const capture = await cart.captureForCheckout({
          mode: "new",
          attemptKey: crypto.randomUUID(),
          expectedItems: [runner],
        });
        if (capture.status !== "captured") throw Error(capture.status);
        let current = true;
        const write = () =>
          capture.applyStockConflicts(
            [
              {
                productId: runner.productId,
                variantId: runner.variantId,
                requestedQuantity: runner.quantity,
                availableQuantity: 0,
                reason: "unavailable",
              },
            ],
            true,
            () => current,
          );
        if (change === "later edit")
          await cart.addItem({
            ...runner,
            variantId: "99999999-9999-4999-8999-999999999999",
          });
        if (change === "identical replacement") {
          await cart.removeItem(runner.productId, runner.variantId);
          await cart.addItem(runner);
        }
        if (change === "new capture") {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const next = await window.testCart.captureForCheckout({
            mode: "new",
            attemptKey: crypto.randomUUID(),
            expectedItems: [runner],
          });
          if (next.status !== "captured") throw Error(next.status);
        }
        let pending;
        if (change === "queued supersession") {
          await navigator.locks.request("rdk_cart", async () => {
            pending = write();
            current = false;
          });
        }
        const raw = localStorage.getItem("rdk_cart_user_owner");
        const saved = await (pending ?? write());
        return [saved.status, raw === localStorage.getItem("rdk_cart_user_owner")];
      },
      { change, runner },
    );
    assert.deepEqual(result, ["stale", true]);
  });
}
