import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function checkLocalInventoryReads(app, page, productId) {
  const cases = [
    ["/admin/inventory", "products", "Inventory"],
    ["/admin/inventory/create", "tag_brands", "Create product"],
    ["/admin/inventory/" + productId + "/edit", "products", "Edit product"],
  ];
  for (const [path, table, heading] of cases) {
    const url = app.origin + path;
    const warm = await page.context().request.get(url);
    assert.equal(warm.status(), 200);
    const first = Promise.withResolvers();
    const repeat = Promise.withResolvers();
    let phase = "initial",
      firstReads = 0,
      repeatReads = 0;
    app.intercept(async (req) => {
      const target = new URL(req.url, app.backend);
      if (target.pathname !== "/rest/v1/" + table) return false;
      if (phase === "initial") {
        firstReads++;
        await first.promise;
      } else {
        repeatReads++;
        await repeat.promise;
      }
      return false;
    });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      const retry = page.getByRole("button", { name: "Try again" });
      await expect(
        retry,
        "The held " + heading + " read must reach the recoverable staff error boundary",
      ).toBeVisible({ timeout: 25000 });
      assert.ok(firstReads > 0);
      await page.keyboard.press("Escape");
      phase = "retry";
      // Keep the original dependency held until recovery so only a fresh call can supply data.
      await retry.press("Enter");
      await expect
        .poll(() => repeatReads, {
          timeout: 10000,
          message: "The " + heading + " boundary must reissue the staff read",
        })
        .toBeGreaterThan(0);
      const pending = page.getByRole("button", { name: /retrying/i }).or(
        page
          .locator("[aria-busy=true]")
          .filter({ has: page.locator("[data-ui-skeleton]") })
          .first(),
      );
      await expect(
        pending.first(),
        "Retry of " + heading + " must remain visible while held",
      ).toBeVisible();
      repeat.resolve();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }).first(),
        "The authorized " + heading + " view must recover",
      ).toBeVisible({ timeout: 30000 });
      assert.equal(page.url(), url);
      console.log(
        "PASS real authorized " +
          heading +
          " cold read deadline, fresh retry and recovery",
      );
    } finally {
      first.resolve();
      repeat.resolve();
      app.intercept(undefined);
    }
  }
  await page.close();
}
