// Actual Next/Redis/PostgREST/PostgreSQL. Auth/address providers are explicit fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium, expect as baseExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const expect = baseExpect.configure({ timeout: 30000 });
import {
  startBrowserTestApp,
  stopBrowserTestApp,
  seedBrowserPrize,
  readBrowserRunState,
  addFixtureBrowserCookies,
  fixtureEligibilityResponse,
} from "./fixtures/specialty-claims.mjs";
const origin = "http://localhost:3000";
const address = {
  line1: "123 FIXTURE ST",
  line2: "APT 3",
  city: "COLUMBIA",
  state: "SC",
  postalCode: "29201",
  country: "US",
};
let app,
  browser,
  stage = "setup";
async function customer(role = "guest") {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.25" },
  });
  const browserId = await addFixtureBrowserCookies(context, role);
  await context.route("https://example.invalid/**", (route) => route.abort());
  return { context, browserId };
}
async function checkHeaderLayout(page) {
  const nav = page.getByRole("navigation");
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const status = nav.getByRole("button", {
      name: "Check giveaway status",
      exact: true,
    });
    const cart = nav.getByRole("button", { name: /^Cart \(/ });
    await expect(status).toBeVisible();
    await expect(cart).toBeVisible();
    const statusBox = await status.boundingBox(),
      cartBox = await cart.boundingBox();
    assert.ok(
      statusBox.x >= cartBox.x + cartBox.width,
      "status is to the right of Cart at " + width,
    );
    assert.ok(
      Math.abs(statusBox.y + statusBox.height / 2 - cartBox.y - cartBox.height / 2) < 2,
      "Cart and status share a row at " + width,
    );
    const logo = await nav.getByRole("link", { name: "Home", exact: true }).boundingBox();
    const actions = [
      status,
      cart,
      nav.getByRole("button", { name: "Search", exact: true }),
    ];
    const account = nav.getByRole("button", { name: "Account", exact: true });
    if (await account.isVisible()) actions.push(account);
    for (const action of actions) {
      const box = await action.boundingBox();
      assert.ok(
        box.x + box.width <= logo.x ||
          box.x >= logo.x + logo.width ||
          box.y >= logo.y + logo.height ||
          box.y + box.height <= logo.y,
        "header actions clear the logo at " + width,
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "no horizontal overflow at " + width,
    );
  }
}
async function submitPrepared(prize, handle, unit) {
  const actor = await customer();
  try {
    const details = {
      productId: prize.productId,
      instagramHandle: handle,
      address: { ...address, line2: "APT " + unit },
    };
    const validation = await fixtureEligibilityResponse(details, actor.browserId);
    assert.equal(validation.status, 200);
    const proof = await validation.json();
    const response = await actor.context.request.post(origin + "/api/specialty/claims", {
      headers: { Origin: origin },
      data: {
        ...details,
        address: proof.address,
        validationToken: proof.validationToken,
        attemptId: randomUUID(),
        recoverySecret: randomBytes(32).toString("hex"),
      },
    });
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).result.status, "won");
  } finally {
    await actor.context.close();
  }
}
try {
  app = await startBrowserTestApp(origin);
  browser = await chromium.launch({ headless: true });
  const winner = await customer(),
    page = await winner.context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  await page.route("**/api/specialty/eligibility", async (route) => {
    const response = await fixtureEligibilityResponse(
      route.request().postDataJSON(),
      winner.browserId,
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  stage = "open available prize";
  assert.equal((await page.goto(origin + "/store/" + app.probe.productId)).status(), 200);
  await expect(
    page.getByRole("button", { name: "Check giveaway status", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(page.getByText(/Opening this form does not reserve/)).toBeVisible();
  await page.getByLabel("Instagram handle", { exact: true }).fill("confirmed.fixture");
  await page.getByLabel("Street address", { exact: true }).fill(address.line1);
  await page
    .getByLabel("Apartment / unit (optional)", { exact: true })
    .fill(address.line2);
  await page.getByLabel("City", { exact: true }).fill(address.city);
  await page.getByLabel("State", { exact: true }).fill(address.state);
  await page.getByLabel("ZIP code", { exact: true }).fill(address.postalCode);
  stage = "winner confirmation";
  await page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Congrats!", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your claim is confirmed. This prize is yours.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Opening this form does not reserve/)).toHaveCount(0);
  stage = "header status placement and one-click recovery";
  await page.keyboard.press("Escape");
  await checkHeaderLayout(page);
  await expect(
    page.locator("footer").getByRole("button", { name: /giveaway/i }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Check giveaway status", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Congrats!", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Check giveaway status", exact: true }),
  ).toBeFocused();
  await mkdir(".superpowers/sdd/specialty-claim-result-clarity/browser", {
    recursive: true,
  });
  await page.screenshot({
    path: ".superpowers/sdd/specialty-claim-result-clarity/browser/status-header-mobile.png",
  });
  const savedAttempts = await page.evaluate(() =>
    sessionStorage.getItem("sole:specialty:attempts:v1"),
  );
  const signedIn = await customer("customer");
  await signedIn.context.addInitScript((saved) => {
    sessionStorage.setItem("sole:specialty:attempts:v1", saved);
  }, savedAttempts);
  const signedInPage = await signedIn.context.newPage();
  signedInPage.setDefaultNavigationTimeout(60000);
  await signedInPage.setViewportSize({ width: 1280, height: 900 });
  await signedInPage.goto(origin + "/store/" + app.probe.productId);
  await expect(signedInPage.getByTestId("navbar-user-menu")).toBeVisible();
  await checkHeaderLayout(signedInPage);
  await signedInPage.setViewportSize({ width: 1280, height: 900 });
  await signedInPage.screenshot({
    path: ".superpowers/sdd/specialty-claim-result-clarity/browser/status-header-desktop.png",
  });
  await signedIn.context.close();
  stage = "winner refresh uses current stock and retains receipt recovery";
  assert.equal((await page.reload()).status(), 200);
  await expect(
    page.getByRole("heading", { name: "Already claimed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You submitted a claim. Check your claim result below to see your confirmation.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/by another customer/)).toHaveCount(0);
  await page.getByRole("button", { name: "Check claim result", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Congrats!", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Opening this form does not reserve/)).toHaveCount(0);
  await winner.context.close();
  stage = "new visitor sees claimed page instead of 404";
  const visitor = await customer(),
    otherPage = await visitor.context.newPage();
  assert.equal(
    (
      await otherPage.goto(origin + "/store/" + app.probe.productId.toUpperCase())
    ).status(),
    200,
  );
  await expect(
    otherPage.getByText("This product has already been claimed.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    otherPage.getByRole("button", { name: "Unavailable", exact: true }),
  ).toBeDisabled();
  assert.match(
    await otherPage.locator('meta[name="robots"]').getAttribute("content"),
    /noindex/,
  );
  stage = "quantity greater than one stays available until the last award";
  const runId = randomUUID(),
    prize = await seedBrowserPrize(runId, 2);
  await submitPrepared(prize, "quantity.first", 1);
  assert.equal(
    (await otherPage.goto(origin + "/store/" + prize.productId)).status(),
    200,
  );
  await expect(
    otherPage.getByRole("button", { name: "Claim", exact: true }),
  ).toBeEnabled();
  await submitPrepared(prize, "quantity.second", 2);
  assert.equal((await otherPage.reload()).status(), 200);
  await expect(
    otherPage.getByRole("heading", { name: "Already claimed", exact: true }),
  ).toBeVisible();
  const pool = await visitor.context.request.get(origin + "/api/specialty/discovery");
  assert.equal(pool.status(), 200);
  assert.equal(
    (await pool.json()).products.some((product) => product.id === prize.productId),
    false,
  );
  assert.deepEqual(await readBrowserRunState(runId), {
    winningClaims: 2,
    remainingStock: 0,
    ordinaryPrizeOrderItems: 0,
  });
  stage = "missing ordinary product retains 404";
  assert.equal((await otherPage.goto(origin + "/store/" + randomUUID())).status(), 404);
  await visitor.context.close();
  console.log(
    "PASS: actual Next header status beside Cart at 320/390/768/1280/1440px (guest and signed-in), one-click winner recovery, claimed-prize HTTP 200/noindex, fresh stock, quantity-two availability and unknown-product 404; real PostgreSQL, fixture Auth/address and development BotID.",
  );
} catch (error) {
  console.error("FAIL at " + stage + ": " + String(error.message).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stopBrowserTestApp();
}
