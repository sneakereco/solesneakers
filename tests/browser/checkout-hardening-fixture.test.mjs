import test from "node:test";
import { expect } from "@playwright/test";
import { mountCheckoutBrowser } from "./fixtures/checkout-hardening.mjs";

test("closing the fixture cancels pending route work without a false teardown failure", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { page, close } = await mountCheckoutBrowser({
    sessionRoute: async (route, url) => {
      if (!url.searchParams.has("fixture-close-probe"))
        return route.fulfill({ json: { user: null, role: null } });
      entered.resolve();
      await release.promise;
      await route
        .request()
        .frame()
        .page()
        .evaluate(() => window.testSession?.user);
      await route.fulfill({ json: { user: null, role: null } });
    },
  });
  try {
    await page.evaluate(() => {
      void fetch("/api/auth/session?fixture-close-probe=1").catch(() => {});
    });
    await entered.promise;
    page.once("close", () => release.resolve());
    await close();
  } finally {
    release.resolve();
    await close().catch(() => {});
  }
});

test("cleanup does not suppress ordinary route errors that resemble a closed target", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { page, close } = await mountCheckoutBrowser({
    sessionRoute: async (route, url) => {
      if (!url.searchParams.has("fixture-close-probe"))
        return route.fulfill({ json: { user: null, role: null } });
      entered.resolve();
      await release.promise;
      throw Error("Target page, context or browser has been closed");
    },
  });
  try {
    await page.evaluate(() => {
      void fetch("/api/auth/session?fixture-close-probe=1").catch(() => {});
    });
    await entered.promise;
    page.once("close", () => release.resolve());
    await expect(close()).rejects.toThrow(
      "Target page, context or browser has been closed",
    );
  } finally {
    release.resolve();
    await close().catch(() => {});
  }
});

const item = {
  productId: "fixture-product",
  variantId: "fixture-variant",
  titleDisplay: "Fixture sneaker",
  name: "Fixture sneaker",
  brand: "Sole",
  imageUrl: "/images/logo.png",
  sizeLabel: "10",
  priceCents: 1000,
  quantity: 1,
  maxStock: 5,
};

test("mounts the real cart and session providers with the cart drawer", async () => {
  const { page, close } = await mountCheckoutBrowser({
    guestItems: [item],
    route: async (route, url) => {
      expect(url.pathname).toBe("/api/cart/validate");
      expect(route.request().postDataJSON()).toEqual({
        items: [{ productId: item.productId, variantId: item.variantId, quantity: 1 }],
      });
      await route.fulfill({ json: { removed: [], items: [item] } });
    },
  });
  try {
    await expect(page.getByRole("heading", { name: /my cart/i })).toBeVisible();
    await expect(page.getByText(item.titleDisplay, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.testSession.user)).toBeNull();
    await page.evaluate(() =>
      window.testCart.removeItem("fixture-product", "fixture-variant"),
    );
    await expect(page.getByText(item.titleDisplay, { exact: true })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("unexpected external requests are blocked and fail the fixture", async () => {
  let intercepted = false;
  const { page, close } = await mountCheckoutBrowser({
    route: async (route) => {
      intercepted = true;
      await route.fulfill({ body: "fixture response" });
    },
  });
  const outcome = await page.evaluate(() =>
    fetch("https://provider.example.invalid/checkout").then(
      () => "allowed",
      () => "blocked",
    ),
  );
  await expect(close()).rejects.toThrow(
    /Unexpected external request.*provider\.example\.invalid/,
  );
  expect(outcome).toBe("blocked");
  expect(intercepted).toBe(false);
});

test("checkout view keeps the receiving checkout layout and receipt adapter", async () => {
  const { page, close } = await mountCheckoutBrowser({
    path: "/checkout?fixture=1",
    view: "checkout",
    initialUser: { id: "fixture-buyer", email: "buyer@fixture.invalid" },
    accountItems: { "fixture-buyer": [item] },
    route: async (route, url) => {
      if (url.pathname === "/api/cart/validate")
        return route.fulfill({ json: { removed: [], items: [item] } });
      if (url.pathname === "/api/checkout/quote")
        return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } });
      expect(url.pathname).toBe("/api/orders/90111111-1111-4111-8111-111111111111");
      expect(url.searchParams.get("token")).toBe("fixture-access");
      return route.fulfill({
        json: {
          id: "90111111-1111-4111-8111-111111111111",
          status: "paid",
          financial: { source: "legacy" },
          supportEmail: "help@fixture.invalid",
          events: [],
          fulfillment: "ship",
          subtotal: 10,
          shipping: 0,
          tax: 0,
          total: 10,
          updatedAt: "2026-11-25T00:00:00.000Z",
        },
      });
    },
  });
  try {
    await expect(
      page.getByRole("heading", { name: "Checkout", exact: true }),
    ).toBeAttached();
    expect(await page.evaluate(() => window.testSession.user.id)).toBe("fixture-buyer");
    await page.evaluate(() => {
      history.replaceState(
        {},
        "",
        "/checkout/success?orderId=90111111-1111-4111-8111-111111111111&token=fixture-access",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(
      page.getByRole("heading", { name: "Order Confirmed!", exact: true }),
    ).toBeVisible();
  } finally {
    await close();
  }
});

test("two checkout fixture tabs mount real hooks and retain account writes across reload", async () => {
  const initialUser = { id: "two-tab-buyer", email: "buyer@fixture.invalid" };
  const key = "rdk_cart_user_" + initialUser.id;
  const { page, context, close } = await mountCheckoutBrowser({
    initialUser,
    accountItems: { [initialUser.id]: [item] },
    route: async (route, url) => {
      expect(url.pathname).toBe("/api/cart/validate");
      const { items } = route.request().postDataJSON();
      await route.fulfill({
        json: {
          removed: [],
          items: items.map(({ quantity }) => ({ ...item, quantity })),
        },
      });
    },
  });
  try {
    const other = await context.newPage();
    await other.goto(page.url());
    for (const tab of [page, other]) {
      await expect(tab.getByText(item.titleDisplay, { exact: true })).toBeVisible();
      expect(await tab.evaluate(() => window.testSession.user.id)).toBe(initialUser.id);
    }
    await other.evaluate((storageKey) => {
      window.fixtureNativeStorage = new Promise((resolve) => {
        window.addEventListener("storage", (event) => {
          if (event.key === storageKey) resolve(JSON.parse(event.newValue)[0].quantity);
        });
      });
    }, key);
    await page.evaluate(
      ({ productId, variantId }) =>
        window.testCart.updateQuantity(productId, variantId, 2),
      item,
    );
    await expect(other.evaluate(() => window.fixtureNativeStorage)).resolves.toBe(2);
    await other.reload();
    await expect
      .poll(() => other.evaluate(() => window.testCart?.items[0]?.quantity))
      .toBe(2);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.testCart?.items[0]?.quantity))
      .toBe(2);
  } finally {
    await close();
  }
});
