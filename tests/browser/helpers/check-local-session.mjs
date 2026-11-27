import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function checkLocalLogout(app, shopper) {
  const authPath = "/api/auth/session";
  assert.ok((await (await shopper.request.get(app.origin + authPath)).json()).user);
  await shopper.addCookies([{ name: "ux-preference", value: "keep", url: app.origin }]);
  const gate = Promise.withResolvers();
  let revocations = 0;
  let sawSettings = false;
  app.intercept(async (req, res) => {
    if (req.url.startsWith("/rest/v1/tenants?")) {
      sawSettings = true;
      await gate.promise;
      return false;
    }
    if (req.url.startsWith("/auth/v1/user")) {
      await gate.promise;
      return false;
    }
    if (!req.url.startsWith("/auth/v1/logout")) return false;
    revocations++;
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Local authorization service unavailable" }));
    return true;
  });
  const storeRead = Promise.allSettled([
    fetch(app.origin + "/store", {
      headers: { Accept: "text/html" },
    }),
  ]);
  try {
    await expect.poll(() => sawSettings, { timeout: 12000 }).toBe(true);
    const response = await shopper.request.post(app.origin + "/api/auth/logout", {
      headers: { Origin: app.origin },
      timeout: 30000,
    });
    assert.equal(
      response.status(),
      200,
      "Logout must clear this browser during a provider outage",
    );
    assert.ok(revocations > 0);
    const [read] = await storeRead;
    assert.equal(read.status, "fulfilled", "Local store-access request failed");
    const unavailable = read.value;
    assert.equal(unavailable.status, 503);
    assert.match(await unavailable.text(), /Could not load store access settings/);
    console.log(
      "PASS real held store-access settings return a retryable 503 while logout remains reachable",
    );
  } finally {
    app.intercept(undefined);
    gate.resolve();
    await storeRead;
  }
  const cookies = await shopper.cookies();
  assert.equal(
    cookies.some((cookie) => cookie.name.startsWith("sb-127-auth-token")),
    false,
  );
  assert.ok(cookies.some((cookie) => cookie.name === "ux-preference"));
  assert.deepEqual(await (await shopper.request.get(app.origin + authPath)).json(), {
    user: null,
    role: null,
  });
  console.log(
    "PASS real same-browser outage logout clears local auth, retains unrelated cookie and confirms guest",
  );
}

async function navigateDocument(page, url) {
  const options = { waitUntil: "domcontentloaded", timeout: 45000 };
  try {
    return await page.goto(url, options);
  } catch (error) {
    // Next dev may replace a document while compiling another route. Retry only that interruption.
    if (!String(error).includes("net::ERR_ABORTED")) throw error;
    return page.goto(url, options);
  }
}

export async function checkLocalSession(app, shopper, admin, page) {
  const readyCheckout = await shopper.newPage();
  await readyCheckout.goto(app.origin + "/checkout");
  await expect(
    readyCheckout.getByRole("heading", { name: "Your cart is empty" }),
  ).toBeVisible({ timeout: 30000 });
  await readyCheckout.close();
  const dashboard = app.origin + "/admin/dashboard";
  assert.equal((await admin.request.get(dashboard)).status(), 200);
  // Hold profile responses after the real authenticated GoTrue exchange.
  let gate = Promise.withResolvers();
  app.intercept(async (req) => {
    if (!req.url.startsWith("/rest/v1/profiles?")) return false;
    await gate.promise;
    return false;
  });
  try {
    const checkout = await shopper.newPage();
    const [guard, store, checkoutNavigation] = await Promise.allSettled([
      admin.request.get(dashboard, { timeout: 45000 }),
      navigateDocument(page, app.origin + "/store"),
      navigateDocument(checkout, app.origin + "/checkout"),
    ]);
    for (const result of [guard, store, checkoutNavigation]) {
      if (result.status === "rejected")
        throw Error(
          "Local session navigation failed: " + String(result.reason).split("\n")[0],
        );
    }
    assert.equal(guard.value.status(), 503);
    await expect(page.locator("[data-session-recovery]")).toBeVisible({ timeout: 25000 });
    await expect(page.getByRole("link", { name: "Login", exact: true })).toHaveCount(0);
    await expect(
      checkout.getByRole("heading", { name: /checkout is temporarily unavailable/i }),
    ).toBeVisible({ timeout: 25000 });
    await checkout.close();
  } finally {
    app.intercept(undefined);
    gate.resolve();
  }
  await page
    .locator("[data-session-recovery]")
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  gate = Promise.withResolvers();
  app.intercept(async (req) => {
    if (!req.url.startsWith("/auth/v1/user")) return false;
    await gate.promise;
    return false;
  });
  try {
    const observed = await shopper.request.get(app.origin + "/api/auth/session", {
      timeout: 30000,
    });
    assert.equal(observed.status(), 503);
    assert.match((await observed.json()).error, /session/i);
  } finally {
    app.intercept(undefined);
    gate.resolve();
  }
  console.log(
    "PASS real held server profile and proxy auth reads, unavailable storefront/checkout/admin and session retry",
  );
}
