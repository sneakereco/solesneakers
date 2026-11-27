import assert from "node:assert/strict";
import test from "node:test";
import { mountCheckoutBrowser } from "../../../../../../tests/browser/fixtures/checkout-hardening.mjs";

test("an unconfirmed basket retains its original row", async () => {
  const row = {
    productId: "fixture-product",
    variantId: "fixture-variant",
    titleDisplay: "Checkout gate shoe",
    name: "Checkout gate shoe",
    brand: "Sole",
    imageUrl: "/images/logo.png",
    sizeLabel: "10",
    priceCents: 1000,
    quantity: 1,
    maxStock: 2,
  };
  const { page, close } = await mountCheckoutBrowser({
    guestItems: [row],
    route: async (route, url) => {
      assert.equal(url.pathname, "/api/cart/validate");
      await route.fulfill({ json: { items: [row] } });
    },
  });
  try {
    const original = page.getByText(row.titleDisplay, { exact: true });
    await original.waitFor();
    if (process.env.CHECKOUT_GATE_FAULT === "cart") {
      await page.evaluate(() =>
        window.testCart.removeItem("fixture-product", "fixture-variant"),
      );
      await original.waitFor({ state: "detached" });
    }
    assert.equal(
      await original.count(),
      1,
      "original basket row disappeared before confirmation",
    );
  } finally {
    await close();
  }
});
