import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function checkLocalCatalog(app, page) {
  // Only external server-side catalog reads are delayed. RSC, routing, hydration and the page stay real.
  function holdCatalog() {
    let seen = false;
    const gate = Promise.withResolvers();
    app.intercept(async (req, res) => {
      if (!req.url.startsWith("/rest/v1/products?")) return false;
      seen = true;
      const outcome = await gate.promise;
      if (outcome === "fail") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Local catalog read unavailable" }));
        return true;
      }
      return false;
    });
    return {
      wait: () => expect.poll(() => seen, { timeout: 12000 }).toBe(true),
      release(value) {
        if (value !== "fail") app.intercept(undefined);
        gate.resolve(value);
      },
    };
  }
  const region = page.getByRole("region", { name: "Products", exact: true });
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  const modal = page.getByRole("dialog", { name: "Store menu" });
  await page.goto(app.origin + "/store");
  await expect(region).toBeVisible({ timeout: 60000 });
  const original = await region.locator("h2").first().textContent();
  assert.ok(original);
  await page.evaluate(() => {
    window.uxDocument = crypto.randomUUID();
  });
  const documentId = await page.evaluate(() => window.uxDocument);
  let held = holdCatalog();
  try {
    await page.getByRole("button", { name: "List view" }).click();
    await expect(region).toHaveAttribute("aria-busy", "true");
    await expect(region).toContainText(original);
    await menu.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await page.getByRole("button", { name: "Grid view" }).click();
    await held.wait();
  } finally {
    held.release();
  }
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("grid");
  await expect(page.getByRole("button", { name: "Grid view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  held = holdCatalog();
  try {
    await page.getByRole("button", { name: "Date: New to Old" }).click();
    await page.getByRole("option", { name: "Title: A-Z" }).click();
    await held.wait();
  } finally {
    held.release("fail");
  }
  const catalogError = page
    .getByRole("alert")
    .filter({ hasText: /could not (load|update) products/i });
  await expect(catalogError).toBeVisible({ timeout: 25000 });
  await expect(catalogError).toContainText("Showing previous results");
  await expect(region).toContainText(original);
  app.intercept(undefined);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Title: A-Z" })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Showing previous results" }),
  ).toHaveCount(0);
  console.log(
    "PASS actual held and superseded catalog, shell, failed backend read, retained results and retry",
  );
  const search = page.getByRole("button", { name: "Search", exact: true });
  await search.focus();
  await page.keyboard.press("Enter");
  const input = page.getByRole("searchbox");
  await input.fill("local-sneaker-search");
  held = holdCatalog();
  try {
    await input.press("Enter");
    await held.wait();
    await expect(page.getByRole("dialog", { name: "Search products" })).toHaveCount(0);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /updating products|loading search results/i }),
    ).toBeVisible();
  } finally {
    held.release();
  }
  await expect(
    page.getByRole("heading", { name: /Search:.*local-sneaker-search/i }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest("main")).catch(() => false),
    )
    .toBe(true);
  await menu.focus();
  await page.keyboard.press("Enter");
  const shopLink = modal.locator('a[href="/store"]').first();
  const popup = page.context().waitForEvent("page");
  await shopLink.click({ modifiers: ["Control"] });
  const other = await popup;
  await other.close();
  await expect(modal).toBeVisible();
  await shopLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Shop All" })).toBeVisible();
  await expect(modal).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest("main")).catch(() => false),
    )
    .toBe(true);
  assert.equal(await page.evaluate(() => window.uxDocument), documentId);
  console.log(
    "PASS slow open-store search and drawer navigation focus, modifier/new tab",
  );
}
