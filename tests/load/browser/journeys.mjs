import { expect } from "@playwright/test";
export async function applyConsentChoice(page, choice) {
  const button = page.getByRole("button", {
    name:
      choice === "accept"
        ? /^(accept all|accept optional cookies)$/i
        : /^(reject optional|reject all|necessary only)$/i,
  });
  if (await button.count()) {
    await button.first().click();
    return { choice, status: "pass" };
  }
  return {
    choice,
    status: "unmet",
    reason: "No exposed optional-analytics consent control",
  };
}
async function goto(page, baseUrl, path) {
  const response = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded" });
  if (
    !response?.ok() ||
    new URL(page.url()).origin !== baseUrl ||
    new URL(page.url()).pathname !== new URL(baseUrl + path).pathname
  )
    throw Error("Rendered route or perimeter admission failed");
  await expect(page.locator("body")).toBeVisible();
  await page.keyboard.press("Tab");
}
export function readCart(page, accountId) {
  return page.evaluate((id) => {
    const raw = id
      ? localStorage.getItem(`rdk_cart_user_${id}`)
      : sessionStorage.getItem("rdk_cart_session");
    return raw ? JSON.parse(raw) : [];
  }, accountId ?? null);
}
async function addProduct(page, baseUrl, product) {
  await goto(page, baseUrl, `/store/${product.id}`);
  const add = page.getByRole("button", { name: /^(Add to Cart|Add Another)/i });
  await expect(add).toBeEnabled();
  await add.click();
  await page.keyboard.press("Escape");
}
export async function emptyOwnedCart(page, baseUrl, identity, fixtures) {
  await goto(page, baseUrl, "/cart");
  const items = await readCart(page, identity.accountId);
  if (
    items.some(
      (item) => !fixtures.products.some((product) => product.id === item.productId),
    )
  )
    throw Error("Browser cart contains an unowned fixture");
  await expect
    .poll(
      async () =>
        (await readCart(page, identity.accountId)).length === 0 ||
        (await page.getByRole("button", { name: /^Remove .+ from cart$/i }).count()) > 0,
    )
    .toBe(true);
  for (let index = 0; index < 30; index++) {
    const remove = page.getByRole("button", { name: /^Remove .+ from cart$/i });
    if (!(await remove.count())) break;
    await remove.first().click();
  }
  await expect
    .poll(async () => (await readCart(page, identity.accountId)).length)
    .toBe(0);
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export async function validationRace(page, options, product) {
  await addProduct(page, options.baseUrl, product);
  await goto(page, options.baseUrl, "/cart");
  await page.waitForLoadState("networkidle");
  const fetched = deferred(),
    release = deferred();
  let intercepted = false;
  const handler = async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    try {
      const response = await route.fetch();
      fetched.resolve();
      await release.promise;
      await route.fulfill({ response });
    } catch {
      fetched.resolve();
    }
  };
  await page.route("**/api/cart/validate", handler);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await Promise.race([
      fetched.promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Cart validation did not start")), 10000),
      ),
    ]);
    await page
      .getByRole("button", { name: /^Remove .+ from cart$/i })
      .first()
      .click();
    release.resolve();
    await page.waitForLoadState("networkidle");
    await expect
      .poll(async () =>
        (await readCart(page, options.identity.accountId)).some(
          (x) => x.variantId === product.variantId,
        ),
      )
      .toBe(false);
  } finally {
    release.resolve();
    await page.unroute("**/api/cart/validate", handler);
  }
}
async function loginMerge(page, context, options, product) {
  await context.clearCookies();
  await goto(page, options.baseUrl, "/store");
  await addProduct(page, options.baseUrl, product);
  const guest = await readCart(page, null);
  if (!guest.some((x) => x.variantId === product.variantId))
    throw Error("Guest cart fixture was not added");
  await context.addCookies(
    options.identity.cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: options.baseUrl,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    })),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
  await expect
    .poll(async () =>
      (await readCart(page, options.identity.accountId)).some(
        (x) => x.variantId === product.variantId,
      ),
    )
    .toBe(true);
}
async function twoTabs(page, context, options, product) {
  await emptyOwnedCart(page, options.baseUrl, options.identity, options.fixtures);
  await addProduct(page, options.baseUrl, product);
  await goto(page, options.baseUrl, "/cart");
  const other = await context.newPage();
  try {
    await goto(other, options.baseUrl, "/cart");
    await expect(
      other.getByRole("heading", { name: /Shopping Cart \(1\)/i }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^Increase quantity for /i })
      .first()
      .click();
    await expect(
      other.getByRole("heading", { name: /Shopping Cart \(2\)/i }),
    ).toBeVisible({ timeout: 5000 });
  } finally {
    await other.close();
  }
}
async function fillCheckout(page, options) {
  const { identity } = options,
    address = options.fixtures.addresses[0],
    pickup = identity.slot % 5 === 0;
  const email = page.getByLabel("Email", { exact: true });
  if (!identity.accountId) await email.fill(identity.email);
  else await expect(email).toHaveValue(identity.email);
  await page
    .getByRole("button", { name: pickup ? "Pickup" : "Ship", exact: true })
    .click();
  for (const [label, value] of [
    ["First name", "Load"],
    ["Last name", "Buyer"],
    ["Phone", address.phone],
    ...(!pickup
      ? [
          ["Address", address.line1],
          ["City", address.city],
          ["ZIP code", address.postalCode],
        ]
      : []),
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  if (!pickup)
    await page.getByLabel("State", { exact: true }).selectOption(address.state);
  for (const [label, value] of [
    ["Billing first name", "Load"],
    ["Billing last name", "Buyer"],
    ["Billing address", address.line1],
    ["Billing city", address.city],
    ["Billing ZIP code", address.postalCode],
    ["Billing phone", address.phone],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    if (await field.count()) await field.fill(value);
  }
  const state = page.getByLabel("Billing state", { exact: true });
  if (await state.count()) await state.selectOption(address.state);
  await page.getByLabel("Name on card", { exact: true }).fill("Load Buyer");
  for (const [label, value] of [
    ["Simulated card number", "4111111111111111"],
    ["Simulated expiry", "12/30"],
    ["Simulated CVV", "123"],
    ["Simulated card ZIP", "29201"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
}
async function checkoutWithReceipt(page, context, options, unrelated) {
  await goto(page, options.baseUrl, "/checkout");
  await fillCheckout(page, options);
  const paid = deferred(),
    release = deferred();
  let other;
  const handler = async (route) => {
    try {
      const response = await route.fetch();
      paid.resolve(response.status());
      await release.promise;
      await route.fulfill({ response });
    } catch {
      paid.resolve(0);
    }
  };
  await page.route("**/api/checkout/pay", handler);
  const clickAt = Date.now();
  try {
    await page.getByRole("button", { name: /^Pay \$[\d,.]+ now$/i }).click();
    const status = await Promise.race([
      paid.promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Payment did not reach the real pay route")),
          15000,
        ),
      ),
    ]);
    if (status !== 202) throw Error("Real payment route did not accept checkout");
    await expect(page.getByRole("dialog")).toBeVisible();
    if (options.identity.accountId) {
      other = await context.newPage();
      await addProduct(other, options.baseUrl, unrelated);
    }
    release.resolve();
    await page.waitForURL((url) => url.pathname === "/checkout/success", {
      timeout: 30000,
    });
    await expect(
      page.getByText(/order is confirmed|thank you|order confirmed/i).first(),
    ).toBeVisible();
    if (options.identity.accountId)
      await expect
        .poll(async () =>
          (await readCart(page, options.identity.accountId)).some(
            (x) => x.variantId === unrelated.variantId,
          ),
        )
        .toBe(true);
    options.emit({
      type: "case",
      name: "pending-feedback-and-receipt-preserves-additions",
      status: "pass",
      viewport: options.viewport,
      at: Date.now(),
      durationMs: Date.now() - clickAt,
      controlledResponseDelay: true,
    });
  } finally {
    release.resolve();
    await page.unroute("**/api/checkout/pay", handler);
    await other?.close();
  }
}
export async function runRenderedJourney(page, context, options) {
  const products = options.fixtures.products.filter((x) => !x.hot),
    product = products[options.identity.slot % products.length],
    unrelated = products[(options.identity.slot + 1) % products.length];
  async function runCase(name, work) {
    try {
      await work();
      options.emit({
        type: "case",
        name,
        status: "pass",
        viewport: options.viewport,
        at: Date.now(),
      });
    } catch {
      options.emit({
        type: "case",
        name,
        status: "fail",
        viewport: options.viewport,
        at: Date.now(),
      });
    }
  }
  if (options.mode !== "perimeter")
    for (const [operation, path, method, body] of [
      ["catalog", "/api/store/products?page=1&limit=20", "GET"],
      [
        "cart_validate",
        "/api/cart/validate",
        "POST",
        { items: [{ productId: product.id, variantId: product.variantId, quantity: 1 }] },
      ],
    ]) {
      const at = Date.now();
      let outcome = "technical";
      try {
        const response = await context.request.fetch(options.baseUrl + path, {
          method,
          data: body,
          maxRedirects: 0,
          timeout: 15000,
        });
        const value = await response.json();
        if (
          response.ok() &&
          (operation === "catalog"
            ? Array.isArray(value.products)
            : Array.isArray(value.items))
        )
          outcome = "success";
      } catch {
        /* Recorded as an unexpected technical outcome. */
      }
      options.emit({ operation, outcome, at, durationMs: Date.now() - at });
    }
  await goto(page, options.baseUrl, "/store");
  await goto(page, options.baseUrl, `/store?q=${encodeURIComponent(product.name)}`);
  await goto(page, options.baseUrl, `/store/${product.id}`);
  if (options.mode === "perimeter" || options.mode === "discovery") {
    options.emit({
      type: "case",
      name: "normal-perimeter-navigation",
      status: "pass",
      at: Date.now(),
    });
    return;
  }
  await runCase("cart-edit-during-real-validation", () =>
    validationRace(page, options, product),
  );
  if (options.identity.accountId) {
    await runCase("login-cart-merge", () => loginMerge(page, context, options, product));
    await runCase("two-tab-cart-visibility", () =>
      twoTabs(page, context, options, product),
    );
  }
  await emptyOwnedCart(page, options.baseUrl, options.identity, options.fixtures);
  await addProduct(page, options.baseUrl, product);
  await goto(page, options.baseUrl, "/cart");
  await checkoutWithReceipt(page, context, options, unrelated);
}
