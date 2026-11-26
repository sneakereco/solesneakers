import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const row = {
  productId: "p",
  variantId: "v",
  name: "Shoes",
  brand: "Brand",
  sizeLabel: "10",
  titleDisplay: "Shoes",
  priceCents: 200,
  imageUrl: "/x",
  quantity: 1,
};
const order = {
  id: "order",
  status: "paid",
  subtotal: 2,
  total: 2,
  tax: 0,
  shipping: 0,
  fulfillment: "ship",
  updatedAt: "yesterday",
  events: [],
  supportEmail: "help@example.test",
  customerId: null,
  purchasedItems: [{ productId: "p", variantId: "v", quantity: 1 }],
};
const bundle = await compileUxHarness(
  `
import {useState} from "react";
import {createRoot} from "react-dom/client";
import {CartProvider,useCart} from "./src/components/cart/CartProvider";
import {SessionProvider,useSession} from "./src/contexts/SessionContext";
import {CartFeedback} from "./src/components/cart/CartFeedback";
import Receipt from "./src/app/checkout/success/page";
function App(){
 const [receipt,show]=useState(location.pathname==="/checkout/success"); window.showReceipt=()=>show(true);
 const cart=useCart(); window.cart=cart; window.session=useSession();
 return <><CartFeedback/><output>{cart.isReady ? cart.items.map(x=>x.quantity).join(","):"unready"}</output>{receipt&&<Receipt/>}</>;
}
if(!sessionStorage.getItem("seeded")){
 sessionStorage.setItem("seeded","1");
 sessionStorage.setItem("rdk_cart_session",JSON.stringify([${JSON.stringify(row)}]));
 sessionStorage.setItem("checkout:confirmed:order",JSON.stringify(${JSON.stringify(order)}));
}
const owner=new URLSearchParams(location.search).get("fixtureOwner");
createRoot(document.getElementById("root")).render(<SessionProvider initialUser={owner?{id:owner,email:"buyer@example.test"}:null} initialRole={owner?"customer":null}><CartProvider userId="stale-server-prop"><App/></CartProvider></SessionProvider>);
`,
  {
    define: { "process.env": "{}" },
    plugins: [
      {
        name: "router",
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "router",
            namespace: "boundary",
          }));
          build.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({
            contents:
              "const router={push:()=>{}}; export const useRouter=()=>router; export const useSearchParams=()=>new URLSearchParams(location.search)",
          }));
        },
      },
    ],
  },
);
async function checkColdReceipt(browser, owner) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ownerParam = owner ? "fixtureOwner=" + owner : "";
  let orderReads = 0;
  try {
    await page.route("**/api/cart/validate", (route) =>
      route.fulfill({
        json: {
          items: route
            .request()
            .postDataJSON()
            .items.map((item) => ({ ...row, ...item })),
        },
      }),
    );
    await page.route("**/api/orders/order*", (route) => {
      orderReads++;
      return route.fulfill({ json: { ...order, customerId: owner } });
    });
    await openUxHarness(page, bundle, "https://ux.test/prepare?" + ownerParam);
    await page.waitForFunction(
      () => window.cart?.isReady && window.cart.validationStatus === "idle",
    );
    if (owner) await page.evaluate((item) => window.cart.addItem(item), row);
    await expect(page.locator("output")).toHaveText("1");
    assert.equal(
      await page.evaluate(() =>
        window.cart.bindCheckoutSnapshot("order", window.cart.captureCheckoutSnapshot()),
      ),
      true,
    );
    assert.equal(await page.evaluate((item) => window.cart.addItem(item), row), true);
    const newerRange = await page.evaluate((owner) => {
      const storage = owner ? localStorage : sessionStorage;
      return JSON.parse(
        storage.getItem(owner ? "rdk_cart_user_" + owner : "rdk_cart_session"),
      )[0].unitsV1.at(-1);
    }, owner);

    // The new receipt document starts with an existing binding and cannot hydrate its basket.
    await page.addInitScript((owner) => {
      if (location.pathname !== "/checkout/success") return;
      if (owner) {
        const request = navigator.locks.request.bind(navigator.locks);
        navigator.locks.request = () => Promise.reject(Error("Lock unavailable"));
        window.restoreCartAccess = () => {
          navigator.locks.request = request;
        };
      } else {
        const read = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === "rdk_cart_session") throw Error("Storage unavailable");
          return read.call(this, key);
        };
        window.restoreCartAccess = () => {
          Storage.prototype.getItem = read;
        };
      }
    }, owner);
    await openUxHarness(
      page,
      bundle,
      "https://ux.test/checkout/success?orderId=order&token=test&" + ownerParam,
    );
    const confirmation = page.getByRole("heading", { name: "Order Confirmed!" });
    const retry = page.getByRole("button", { name: "Retry cart update" });
    await expect(confirmation).toBeVisible();
    await expect(page.locator("output")).toHaveText("unready");
    await expect(retry).toBeVisible();
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.evaluate(() => window.restoreCartAccess());
    await retry.click();
    await expect(page.locator("output")).toHaveText("1");
    await expect(retry).toHaveCount(0);
    await expect(confirmation).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    assert.deepEqual(
      await page.evaluate((owner) => {
        const storage = owner ? localStorage : sessionStorage;
        return JSON.parse(
          storage.getItem(owner ? "rdk_cart_user_" + owner : "rdk_cart_session"),
        )[0].unitsV1;
      }, owner),
      [newerRange],
    );
    assert.equal(orderReads, 1);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch();
try {
  for (const owner of [null, "cold-buyer"]) await checkColdReceipt(browser, owner);
  for (const scenario of [
    "read-failure",
    "save-failure",
    "denied",
    "forged",
    "pending",
    "review",
    "failed",
    "unbound",
    "bound",
    "missing",
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let reads = 0,
      release;
    await page.route("**/api/cart/validate", (route) =>
      route.fulfill({ json: { items: [row] } }),
    );
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { user: null, role: null } }),
    );
    await page.route("**/api/orders/order*", async (route) => {
      reads++;
      if (scenario === "forged")
        await new Promise((r) => {
          release = r;
        });
      await route.fulfill(
        scenario === "denied"
          ? { status: 401, json: { error: "Unauthorized" } }
          : {
              json: {
                ...order,
                status: ["pending", "review", "failed"].includes(scenario)
                  ? scenario
                  : "paid",
              },
            },
      );
    });
    const url =
      scenario === "missing"
        ? "https://ux.test/"
        : "https://ux.test/?orderId=order" +
          (scenario === "unbound" ? "" : "&token=test");
    await openUxHarness(page, bundle, url);
    await page.waitForFunction(() => window.cart?.isReady);
    await expect(page.locator("output")).toHaveText("1");
    if (
      [
        "read-failure",
        "save-failure",
        "bound",
        "denied",
        "pending",
        "review",
        "failed",
      ].includes(scenario)
    )
      await page.evaluate(() =>
        window.cart.bindCheckoutSnapshot("order", window.cart.captureCheckoutSnapshot()),
      );
    if (scenario === "save-failure")
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "rdk_cart_session") throw Error("Quota");
          return original.call(this, key, value);
        };
        window.restoreWrites = () => {
          Storage.prototype.setItem = original;
        };
      });
    if (scenario === "read-failure")
      await page.evaluate(() => {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === "rdk_cart_session") throw Error("Storage unavailable");
          return original.call(this, key);
        };
        window.restoreWrites = () => {
          Storage.prototype.getItem = original;
        };
      });
    await page.evaluate(() => window.showReceipt());
    if (scenario === "forged") {
      await expect.poll(() => Boolean(release)).toBe(true);
      await expect(page.getByText("Order Confirmed!")).toHaveCount(0);
      release();
    }
    if (scenario === "save-failure" || scenario === "read-failure") {
      await expect(page.getByText("Order Confirmed!")).toBeVisible();
      const retry = page.getByRole("button", { name: "Retry cart update" });
      await expect(retry).toBeVisible();
      await expect(page.locator("output")).toHaveText("1");
      await page.evaluate(() => window.restoreWrites());
      const requests = [];
      page.on("request", (request) => requests.push(request.url()));
      await retry.click();
      await expect(page.locator("output")).toHaveText("");
      await expect(retry).toHaveCount(0);
      await expect(page.getByText("Order Confirmed!")).toBeVisible();
      assert.deepEqual(requests, [], "cart recovery only writes local storage");
      assert.equal(reads, 1);
    } else if (scenario === "missing") {
      await expect(page.locator("output")).toHaveText("1");
      assert.equal(reads, 0);
    } else if (scenario === "unbound") {
      await expect(page.getByRole("heading", { name: /verify|access/i })).toBeVisible();
      assert.equal(reads, 0);
    } else if (scenario === "denied") {
      await expect(
        page.getByRole("heading", { name: /unable to verify/i }),
      ).toBeVisible();
      await expect.poll(() => reads).toBe(1);
      await expect(page.locator("output")).toHaveText("1", { timeout: 2000 });
      await expect(page.getByText("Order Confirmed!")).toHaveCount(0);
    } else if (scenario === "bound") {
      await expect(page.getByText("Order Confirmed!")).toBeVisible();
      await expect(page.locator("output")).toHaveText("");
    } else if (scenario === "forged") {
      await expect(page.getByText("Order Confirmed!")).toBeVisible();
      await expect(page.locator("output")).toHaveText("1");
    } else {
      await expect.poll(() => reads).toBeGreaterThan(0);
      if (scenario === "review" || scenario === "failed")
        await expect(
          page.getByRole("heading", { name: /unable to verify/i }),
        ).toBeVisible();
      await expect(page.getByText("Order Confirmed!")).toHaveCount(0);
      await expect(page.locator("output")).toHaveText("1");
    }
    await expect(page.getByRole("button", { name: "Retry cart update" })).toHaveCount(0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const context = await browser.newContext();
  const first = await context.newPage(),
    second = await context.newPage();
  let responseStatus = 200,
    hold = false,
    releaseSession,
    sessionUser = null,
    releaseValidation,
    holdValidation = false;
  await context.route("**/api/auth/session", async (route) => {
    if (hold)
      await new Promise((r) => {
        releaseSession = r;
      });
    await route.fulfill({
      status: responseStatus,
      json: { user: sessionUser, role: sessionUser ? "customer" : null },
    });
  });
  await context.route("**/api/cart/validate", async (route) => {
    const items = route
      .request()
      .postDataJSON()
      .items.map((x) => ({ ...row, ...x }));
    if (holdValidation) {
      holdValidation = false;
      await new Promise((r) => {
        releaseValidation = r;
      });
    }
    await route.fulfill({ status: 200, json: { items } });
  });
  for (const page of [first, second]) {
    await openUxHarness(page, bundle);
    await expect(page.locator("output")).toHaveText("1");
  }
  await first.waitForFunction(() => window.cart.validationStatus === "idle");
  holdValidation = true;
  await first.evaluate(() => window.cart.retryValidation());
  await expect.poll(() => Boolean(releaseValidation)).toBe(true);
  await expect(
    first.getByRole("status").filter({ hasText: "Checking item availability" }),
  ).toBeVisible();
  await first.evaluate((row) => window.cart.addItem(row), row);
  releaseValidation();
  await first.waitForFunction(() => window.cart.validationStatus === "idle");
  await expect(first.locator("output")).toHaveText("2");
  // A response for guest must never write the newly active account, even if the fetch has already started.
  holdValidation = true;
  releaseValidation = null;
  await first.evaluate(() => window.cart.retryValidation());
  await expect.poll(() => Boolean(releaseValidation)).toBe(true);
  hold = true;
  sessionUser = { id: "buyer", email: "buyer@example.test" };
  const duringRefresh = await first.evaluate(async (row) => {
    void window.session.refreshSession();
    const write = window.cart.addItem(row);
    let captured = false;
    try {
      window.cart.captureCheckoutSnapshot();
      captured = true;
    } catch {}
    return { captured, saved: await write };
  }, row);
  assert.deepEqual(
    duringRefresh,
    { captured: false, saved: false },
    "a session refresh blocks old commands synchronously",
  );
  await expect.poll(() => Boolean(releaseSession)).toBe(true);
  await expect(first.locator("output")).toHaveText("unready");
  assert.equal(
    await first.evaluate(() => {
      try {
        window.cart.captureCheckoutSnapshot();
        return true;
      } catch {
        return false;
      }
    }),
    false,
  );
  releaseSession();
  hold = false;
  await expect(first.locator("output")).toHaveText("");
  releaseValidation();
  await second.evaluate(() => window.session.refreshSession());
  await expect(second.locator("output")).toHaveText("");
  await Promise.all(
    [first, second].map((page) => page.evaluate((row) => window.cart.addItem(row), row)),
  );
  for (const page of [first, second])
    await expect(page.locator("output")).toHaveText("2");
  await first.evaluate(() => {
    window.previousEdit = window.cart.updateQuantity;
  });
  await second.evaluate((row) => window.cart.addItem(row), row);
  await expect(first.locator("output")).toHaveText("3");
  assert.equal(await first.evaluate(() => window.previousEdit("p", "v", 1)), false);
  await expect(first.getByRole("alert")).toContainText(/cart changed.*review/i);
  await expect(first.locator("output")).toHaveText("3");
  assert.equal(await first.evaluate(() => window.cart.updateQuantity("p", "v", 2)), true);
  await expect(first.getByRole("alert")).toHaveCount(0);
  // Both documents share one account basket and must agree on the first order binding.
  const firstBound = await first.evaluate(() =>
    window.cart.bindCheckoutSnapshot("shared", window.cart.captureCheckoutSnapshot()),
  );
  assert.equal(firstBound, true);
  await second.evaluate(() => window.cart.clearCart());
  await second.evaluate((row) => window.cart.addItem(row), row);
  const secondBound = await second.evaluate(() =>
    window.cart.bindCheckoutSnapshot("shared", window.cart.captureCheckoutSnapshot()),
  );
  assert.equal(
    secondBound,
    false,
    "account order binding must stay immutable across tabs",
  );
  const receipt = { ...order, id: "shared", customerId: "buyer" };
  await second.evaluate((order) => window.cart.consumeConfirmedOrder(order), receipt);
  await expect(second.locator("output")).toHaveText("1");
  await first.route("**/api/cart/validate", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await first.evaluate(() => window.cart.retryValidation());
  await expect(first.getByRole("alert")).toContainText(
    "Could not load or check your cart",
  );
  await expect(first.locator("output")).toHaveText("1");
  await first.unroute("**/api/cart/validate");
  await first.getByRole("button", { name: "Try again" }).click();
  await first.waitForFunction(() => window.cart.validationStatus === "idle");
  responseStatus = 503;
  await first.evaluate(() => window.session.refreshSession());
  await expect(first.locator("output")).toHaveText("unready");
  await expect(first.getByRole("alert")).toBeVisible();
  responseStatus = 200;
  sessionUser = null;
  await first.getByRole("button", { name: "Try again" }).click();
  await expect(first.locator("output")).toHaveText("2");
  // Account edits can wait for another page to release a Web Lock.
  await second.evaluate(async () => {
    const acquired = Promise.withResolvers();
    void navigator.locks.request("rdk_cart_user_buyer", async () => {
      window.releaseCartLock = () => release();
      let release;
      const held = new Promise((r) => {
        release = r;
      });
      acquired.resolve();
      await held;
    });
    await acquired.promise;
  });
  await second.evaluate(() => {
    window.writeResult = window.cart.updateQuantity("p", "v", 2);
  });
  await expect(second.getByText("Saving your cart…")).toBeVisible();
  await second.evaluate(() => window.releaseCartLock());
  assert.equal(await second.evaluate(() => window.writeResult), true);
  await second.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreWrites = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (k, v) {
      if (k === "rdk_cart_user_buyer") throw Error("Quota");
      return original.call(this, k, v);
    };
  });
  assert.equal(await second.evaluate(() => window.cart.clearCart()), false);
  await expect(second.getByRole("alert")).toContainText("Could not save your cart");
  await expect(second.locator("output")).toHaveText("2");
  await second.evaluate(() => window.restoreWrites());
  await context.close();
  console.log("PASS receipt authority, cache, confirmed and preserved baskets");
} finally {
  await browser.close();
}
