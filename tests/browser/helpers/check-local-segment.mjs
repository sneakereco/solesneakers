import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// The fresh product ID bypasses any prior product cache. Next renders both the
// metadata and detail page; only the exact product dependency is faulted.
export async function checkLocalSegment(app, page, url) {
  const productId = new URL(url).pathname.split("/").at(-1);
  let phase = "fail",
    failedReads = 0,
    retryReads = 0;
  const held = Promise.withResolvers();
  app.intercept(async (req, res) => {
    const target = new URL(req.url, app.backend);
    if (
      target.pathname !== "/rest/v1/products" ||
      target.searchParams.get("id") !== "eq." + productId
    )
      return false;
    if (phase === "fail") {
      failedReads++;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Temporary local product read failure" }));
      return true;
    }
    retryReads++;
    await held.promise;
    return false;
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const retry = page.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible({ timeout: 30000 });
    assert.ok(failedReads > 0);
    await page.evaluate(() => {
      window.segmentDocument = crypto.randomUUID();
    });
    const documentId = await page.evaluate(() => window.segmentDocument);
    // Dismiss Next's development error panel if it is open; the app owns the retry below.
    await page.keyboard.press("Escape");
    phase = "retry";
    await retry.press("Enter");
    await expect
      .poll(() => retryReads, {
        timeout: 8000,
        message: "Try again must issue a new product read",
      })
      .toBeGreaterThan(0);
    const retrying = page.getByRole("button", { name: /retrying/i });
    const loading = page
      .locator("[aria-busy=true]")
      .filter({ has: page.locator("[data-ui-skeleton]") })
      .first();
    await expect(
      retrying.or(loading).first(),
      "The retried segment must expose pending feedback",
    ).toBeVisible();
    console.log(
      "Pending real segment surface:",
      (await retrying.isVisible()) ? "retrying control" : "destination skeleton",
    );
    held.resolve();
    await expect(
      page.getByRole("heading", { name: /find this page/i }),
      "Resumed dependency should confirm the product is missing",
    ).toBeVisible({
      timeout: 25000,
    });
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => window.segmentDocument), documentId);
    console.log(
      "PASS real Next segment failure, pending retry, fresh metadata/detail read and confirmed missing product at the same URL",
    );
  } finally {
    app.intercept(undefined);
    held.resolve();
  }
}
