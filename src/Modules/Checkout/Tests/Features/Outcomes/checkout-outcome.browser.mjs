import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const origin = "http://127.0.0.1:43871";
const order = "10000000-0000-4000-8000-000000000001";
const shoe = {
  productId: "20000000-0000-4000-8000-000000000001",
  variantId: "30000000-0000-4000-8000-000000000001",
  quantity: 2,
  priceCents: 1000,
  sizeLabel: "10",
  name: "Shoe",
  titleDisplay: "Shoe",
  brand: "Sole",
  imageUrl: "/shoe.jpg",
};
const line = { productId: shoe.productId, variantId: shoe.variantId, quantity: 2 };
const receipt = {
  id: order,
  status: "shipped",
  subtotal: 20,
  total: 20,
  tax: 0,
  shipping: 0,
  fulfillment: "ship",
  updatedAt: "2026-11-24T00:00:00Z",
  events: [],
  financial: { source: "legacy" },
  supportEmail: "support@example.test",
  purchasedLines: [line],
};
const totals = { subtotalCents: 2000, totalCents: 2000, taxCents: 0, shippingCents: 0 };
const address = {
  name: "Test Buyer",
  phone: "2025550100",
  line1: "1 Market St",
  line2: "",
  city: "Washington",
  state: "DC",
  postalCode: "20001",
  country: "US",
};
let browser, script;
before(async () => {
  const result = await build({
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `
 import {createRoot} from "react-dom/client";
 import {useLayoutEffect,useSyncExternalStore} from "react";
 import {CartProvider,useCart} from "@/Modules/Cart/Source/Client";
 import {SessionProvider,useSession} from "@/contexts/SessionContext";
 import {CheckoutClient} from "@/components/checkout/CheckoutClient";
 import Layout from "./src/app/checkout/layout";
 import {observeStoredGuestAccess} from "@/Modules/Checkout/Source/Features/Outcomes/client-session";
 import {useOutcomeAccess} from "@/Modules/Checkout/Source/Features/Outcomes/CheckoutOutcomeProvider";
 function ObserveGrant(){const session=useSession();useLayoutEffect(()=>{window.fixtureSessionStatus=session.status;},[session.status]);const {credential}=useOutcomeAccess();useLayoutEffect(()=>{window.fixtureGuestCredential=credential;window.fixtureGuestObservation=observeStoredGuestAccess;},[credential]);return null;}
 import Processing from "./src/app/checkout/processing/page";
 import Receipt from "./src/app/checkout/success/page";
 import Cancel from "./src/app/checkout/cancel/page";
 import {usePathname} from "next/navigation";
 function App(){const path=usePathname();const cart=useCart();useLayoutEffect(()=>{window.cart=cart});return <Layout><ObserveGrant/>{path.endsWith("processing")?<Processing/>:path.endsWith("success")?<Receipt/>:path.endsWith("cancel")?<Cancel/>:<CheckoutClient initialData={{ownerId:window.fixtureOwner??null,isGuest:!window.fixtureOwner,customer:{email:sessionStorage.getItem("fixtureEmail")??"buyer@example.test",address:${JSON.stringify(address)}},paymentConfig:{applicationId:"test",locationId:"test",environment:"sandbox"}}}/>}</Layout>}
 const user=window.fixtureOwner?{id:window.fixtureOwner,email:"buyer@example.test"}:null;
 createRoot(document.getElementById("root")).render(<SessionProvider initialUser={user} initialRole={user?"customer":null}><CartProvider userId={user?.id}><App/></CartProvider></SessionProvider>);
 `,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "transport",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^next\/navigation$|^@\/lib\/measurement\/client$|^@\/config\/client-env$/,
            },
            (args) => ({ path: args.path, namespace: "stub" }),
          );
          b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            resolveDir: process.cwd(),
            contents:
              args.path === "next/navigation"
                ? `
 import {useSyncExternalStore} from "react"; const sub=fn=>{window.addEventListener("popstate",fn);return ()=>window.removeEventListener("popstate",fn)};const href=()=>location.href;
 export const usePathname=()=>new URL(useSyncExternalStore(sub,href)).pathname;export const useSearchParams=()=>new URL(useSyncExternalStore(sub,href)).searchParams;
 window.navigate=url=>{history.replaceState({},"",url);window.dispatchEvent(new PopStateEvent("popstate"))};
 const router={refresh:()=>{},replace:url=>{if(window.holdSuccess && url.startsWith("/checkout/success"))window.nextSuccess=url;else window.navigate(url)},push:url=>window.navigate(url)};export const useRouter=()=>router;`
                : args.path.endsWith("client-env")
                  ? 'export const clientEnv={NEXT_PUBLIC_TURNSTILE_SITE_KEY:"fixture"};'
                  : "export const captureCheckoutStarted=()=>{};export const captureProductAddedToCart=()=>{};",
          }));
        },
      },
    ],
  });
  script = result.outputFiles[0].text;
  browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND"] });
});
after(async () => browser?.close());
async function fixture(
  t,
  { owner = "buyer", pay = "accepted", initialStatus = receipt } = {},
) {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.routeWebSocket("**/*", (socket) => socket.close());
  t.after(() => ctx.close());
  const flow = {
    status: initialStatus,
    holdPrepare: false,
    holdStatus: false,
    prepares: [],
    reservations: new Map(),
    pays: 0,
    permits: 0,
    quotes: 0,
    gets: [],
    user: owner,
    unexpected: [],
  };
  await ctx.addInitScript(
    ({ owner, shoe }) => {
      window.fixtureOwner = owner;
      const area = owner ? localStorage : sessionStorage;
      const key = owner ? "rdk_cart_user_" + owner : "rdk_cart_session";
      if (area.getItem(key) === null) area.setItem(key, JSON.stringify([shoe]));
      if (!sessionStorage.getItem("rdk_guest_shipping_address_v1"))
        sessionStorage.setItem("rdk_guest_shipping_address_v1", "untouched");
      window.turnstile = {
        render: (el, options) => {
          options.callback("controlled-token");
          return "widget";
        },
        remove() {},
        reset() {},
      };
      const walletContact = {
        givenName: "Test",
        familyName: "Buyer",
        phone: "2025550100",
        email: "buyer@example.test",
        addressLines: ["1 Market St"],
        city: "Washington",
        state: "DC",
        postalCode: "20001",
        countryCode: "US",
      };
      window.fixtureCardTokens = 0;
      const approved = async () => ({
        status: "OK",
        token: "fixture-wallet",
        details: { billing: walletContact, shipping: { contact: walletContact } },
      });
      window.fixtureSdkStarts = 0;
      window.Square = {
        payments: () => {
          window.fixtureSdkStarts++;
          return {
            applePay: async () => ({ tokenize: approved, destroy: async () => true }),
            afterpayClearpay: async () => ({
              attach: async () => {},
              tokenize: approved,
              destroy: async () => true,
            }),
            cashAppPay: async (_r, options) => ({
              attach: async () => {},
              destroy: async () => true,
              addEventListener(_e, cb) {
                window.payCash = () => {
                  if (!options.shouldTokenize()) throw Error("Cash App unavailable");
                  cb({
                    detail: { tokenResult: { status: "OK", token: "fixture-cash" } },
                  });
                };
              },
            }),
            card: async () => ({
              attach: async () => {},
              tokenize: async () => {
                window.fixtureCardTokens++;
                return { status: "OK", token: "fixture" };
              },
            }),
            paymentRequest: () => ({
              addEventListener() {},
              update() {
                return true;
              },
            }),
          };
        },
      };
    },
    { owner, shoe },
  );
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      flow.unexpected.push(url.origin);
      return route.abort();
    }
    if (url.pathname === "/app.js")
      return route.fulfill({ contentType: "application/javascript", body: script });
    if (url.pathname.startsWith("/checkout"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div><script src="/app.js"></script>',
      });
    if (url.pathname === "/api/auth/session" && flow.sessionFailure)
      return route.fulfill({ status: 503, json: {} });
    if (url.pathname === "/api/auth/session")
      return route.fulfill({
        json: {
          user: flow.user ? { id: flow.user, email: "buyer@example.test" } : null,
          role: flow.user ? "customer" : null,
        },
      });
    if (url.pathname === "/api/account/access")
      return route.fulfill({ status: 401, json: {} });
    if (url.pathname === "/api/cart/validate" && flow.ownHold) {
      const posted = route.request().postDataJSON();
      if (posted.order?.orderId === order) {
        flow.holdValidated = true;
        return route.fulfill({
          json: {
            contractVersion: 2,
            items: [],
            removed: [
              {
                productId: shoe.productId,
                variantId: shoe.variantId,
                reason: "out_of_stock",
              },
            ],
            lineState: [
              {
                productId: shoe.productId,
                variantId: shoe.variantId,
                requestedQuantity: 2,
                availableQuantity: 2,
                availability: "available",
                reason: "available",
                orderScoped: true,
                facts: shoe,
              },
            ],
          },
        });
      }
    }
    if (
      url.pathname === "/api/cart/validate" ||
      url.pathname === "/shoe.jpg" ||
      url.pathname.startsWith("/images/") ||
      url.pathname === "/_next/image"
    )
      return route.abort();
    if (url.pathname === "/api/checkout/quote") {
      flow.quotes++;
      return route.fulfill({
        json: { completeness: "exact", quoteFingerprint: "a".repeat(64), totals },
      });
    }
    if (url.pathname === "/api/checkout/prepare") {
      flow.prepares.push(route.request().postDataJSON());
      if (flow.holdPrepare) await new Promise((r) => (flow.releasePrepare = r));
      const key = flow.prepares.at(-1).idempotencyKey;
      if (!flow.prepareFailure && !flow.reservations.has(key))
        flow.reservations.set(
          key,
          flow.reservations.size === 0 ? order : "10000000-0000-4000-8000-000000000002",
        );
      if (flow.dropPrepare) {
        flow.dropPrepare = false;
        return route.abort();
      }
      if (flow.terminalOriginal)
        return route.fulfill({
          status: flow.prepares.at(-1).recoveryOnly ? 200 : 409,
          json: {
            code: "CHECKOUT_RECOVERY_REQUIRED",
            orderId: flow.reservations.get(key),
            totals,
            guestAccessToken: "from-prepare",
          },
        });
      if (flow.prepareFailure)
        return route.fulfill({
          status: flow.prepareFailure,
          json: { error: "Retry preparation" },
        });
      return route.fulfill({
        json: {
          orderId: flow.reservations.get(key),
          guestAccessToken: "from-prepare",
          totals,
        },
      });
    }
    if (url.pathname === "/api/checkout/payment-permit") {
      flow.permits++;
      if (flow.holdPermit) await new Promise((resolve) => (flow.releasePermit = resolve));
      flow.permitBody = route.request().postDataJSON();
      if (pay === "terminal-review")
        return route.fulfill({
          status: 409,
          json: {
            code: "CHECKOUT_RECOVERY_REQUIRED",
            orderId: order,
            error: "This payment needs review. Check the original order status.",
          },
        });
      return route.fulfill({ json: { permit: "permit" } });
    }
    if (url.pathname === "/api/checkout/pay") {
      flow.pays++;
      if (flow.holdPay) await new Promise((resolve) => (flow.releasePay = resolve));
      if (pay === "lost") return route.abort();
      if (pay === "timeout")
        return route.fulfill({ status: 408, json: { error: "Gateway timeout" } });
      if (pay === "decline")
        return route.fulfill({
          status: 402,
          json: { error: "Payment declined by provider" },
        });
      if (pay === "pre-provider" || pay === "gateway")
        return route.fulfill({
          status: 503,
          json:
            pay === "pre-provider"
              ? {
                  code: "PAYMENT_NOT_SUBMITTED",
                  error: "Address verification is temporarily unavailable.",
                }
              : { error: "Unavailable" },
        });
      if (pay === "wrong")
        return route.fulfill({
          json: { statusUrl: "/checkout/processing?orderId=wrong" },
        });
      return route.fulfill({
        status: 202,
        json: { status: "UNKNOWN", statusUrl: "/checkout/processing?orderId=" + order },
      });
    }
    if (url.pathname.startsWith("/api/orders/")) {
      assert.equal(route.request().method(), "GET");
      flow.gets.push(url.search);
      const status = typeof flow.status === "function" ? flow.status(url) : flow.status;
      if (flow.holdStatus) await new Promise((r) => (flow.releaseStatus = r));
      return typeof status === "number"
        ? route.fulfill({ status, json: {} })
        : route.fulfill({ json: status });
    }
    flow.unexpected.push(url.pathname);
    return route.abort();
  });
  const open = async (path = "/checkout") => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(5500);
    await page.goto(origin + path);
    return page;
  };
  return { ctx, flow, open };
}
async function submit(page) {
  await page.getByLabel("Name on card", { exact: true }).fill("Test Buyer");
  await page.getByRole("button", { name: "Pay $20.00 now" }).click();
}
async function state(page) {
  return page.evaluate(() => ({
    items: window.cart.items.map((x) => x.quantity),
    key: sessionStorage.getItem("checkout_idempotency_key"),
    fingerprint: sessionStorage.getItem("checkout_cart_fingerprint"),
    address: sessionStorage.getItem("rdk_guest_shipping_address_v1"),
    token: sessionStorage.getItem("rdk_guest_order_token"),
    device: sessionStorage.getItem("rdk_checkout_device_session_id"),
  }));
}
test("actual submit retains original capture and dialog through an unresolved payment and authorized receipt", async (t) => {
  const { flow, open } = await fixture(t);
  flow.holdPay = true;
  flow.holdStatus = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releasePay)).toBe(true);
  assert.deepEqual(flow.prepares[0].items, [line]);
  const initial = await state(page);
  assert.equal(initial.key, flow.prepares[0].idempotencyKey);
  await page.evaluate(async (shoe) => {
    window.spinner = document.querySelector("dialog .animate-spin");
    window.host = window.spinner.closest("dialog");
    await window.cart.removeItem(shoe.productId, shoe.variantId);
    await window.cart.addItem(shoe);
  }, shoe);
  flow.releasePay();
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  assert.deepEqual(
    (await state(page)).items,
    [1],
    "202 must preserve units added while payment was pending",
  );
  assert.equal((await state(page)).key, initial.key);
  assert.equal(
    await page.evaluate(
      () =>
        window.spinner === document.querySelector("dialog .animate-spin") &&
        window.host.open,
    ),
    true,
  );
  flow.holdStatus = false;
  flow.releaseStatus();
  await page.getByRole("heading", { name: "Order Confirmed!" }).waitFor();
  await expect.poll(async () => (await state(page)).key).toBe(null);
  assert.equal(
    await page.evaluate(
      () =>
        window.host === document.querySelector("dialog") &&
        window.spinner === window.host.querySelector(".animate-spin") &&
        !window.host.open,
    ),
    true,
  );
  assert.equal(
    await page.evaluate(
      () => performance.getEntriesByName("checkout-click-to-confirmed").length,
    ),
    1,
  );
  assert.deepEqual((await state(page)).items, [1]);
  assert.equal((await state(page)).token, null);
  assert.equal((await state(page)).address, "untouched");
  assert.equal((await state(page)).device, initial.device);
  assert.deepEqual(
    [flow.prepares.length, flow.permits, flow.pays, flow.gets.length],
    [1, 1, 1, 1],
  );
  await page.evaluate(async (shoe) => window.cart.addItem(shoe), shoe);
  flow.holdStatus = true;
  flow.releaseStatus = undefined;
  await page.reload();
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  flow.releaseStatus();
  await page.getByText("Order Confirmed!").waitFor();
  assert.deepEqual((await state(page)).items, [2]);
  assert.deepEqual(flow.unexpected, []);
});

test("actual lost pay reply checks original order once without submitting another payment", async (t) => {
  const { open, flow } = await fixture(t, {
    pay: "lost",
    initialStatus: { ...receipt, status: "paid", total: 0, fulfillment: "pickup" },
  });
  const page = await open();
  await submit(page);
  await page.getByRole("heading", { name: "Local pickup" }).waitFor();
  assert.equal((await page.getByText("$0.00", { exact: true }).count()) >= 1, true);
  await expect.poll(async () => (await state(page)).items).toEqual([]);
  assert.deepEqual(
    [flow.prepares.length, flow.permits, flow.pays, flow.gets.length],
    [1, 1, 1, 1],
  );
});
test("actual pending reaches 60s, closes the host, and retries only the status GET", async (t) => {
  const { open, flow } = await fixture(t, {
    initialStatus: { ...receipt, status: "pending", purchasedLines: null },
  });
  const page = await open();
  await page.clock.install();
  await submit(page);
  await expect.poll(() => flow.gets.length).toBeGreaterThan(0);
  await page.clock.fastForward(60000);
  await page.getByRole("heading", { name: "Still confirming your order" }).waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.deepEqual((await state(page)).items, [2]);
  const counts = [flow.prepares.length, flow.permits, flow.pays];
  flow.status = receipt;
  await page.getByRole("button", { name: "Check order status" }).click();
  await page.getByText("Order Confirmed!").waitFor();
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], counts);
});
test("receipt denial and newly supplied guest token isolate separate tabs and preserve active credentials", async (t) => {
  const { open, flow } = await fixture(t, {
    owner: null,
    initialStatus: (url) =>
      url.searchParams.get("token") === "historical" ? receipt : 403,
  });
  const page = await open("/checkout/success?orderId=" + order);
  await page.getByText("Order details unavailable").waitFor();
  await page.evaluate((order) => {
    sessionStorage.setItem(
      "checkout:confirmed:" + order,
      JSON.stringify({ id: order, status: "paid" }),
    );
    sessionStorage.setItem("rdk_guest_order_id", "newer");
    sessionStorage.setItem("rdk_guest_order_token", "keep-me");
    sessionStorage.setItem("checkout_idempotency_key", "new-attempt");
    sessionStorage.setItem("checkout_cart_fingerprint", "new-cart");
  }, order);
  await page.reload();
  await page.getByText("Order details unavailable").waitFor();
  assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  await page.evaluate(
    (order) =>
      window.navigate(
        "/checkout/success?orderId=" + order + "&token=historical&fulfillment=pickup",
      ),
    order,
  );
  await page.getByText("Order Confirmed!").waitFor();
  assert.equal(await page.getByText("Local pickup").count(), 0);
  const other = await open("/checkout/success?orderId=" + order + "&token=historical");
  await other.getByText("Order Confirmed!").waitFor();
  for (const tab of [page, other]) {
    await tab.waitForFunction(() => window.cart?.isReady);
    assert.deepEqual((await state(tab)).items, [2]);
  }
  assert.equal((await state(page)).token, "keep-me");
  assert.equal((await state(page)).key, "new-attempt");
  assert.equal((await state(other)).token, null);
  await page.evaluate(
    (order) => window.navigate("/checkout/success?orderId=" + order + "&token=bad"),
    order,
  );
  await page.getByText("Order details unavailable").waitFor();
  assert.equal(await page.getByText("Order Details", { exact: true }).count(), 0);
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], [0, 0, 0]);
});
test("receipt on changing account ignores an old GET and clears order facts for invalid new replies", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdStatus = true;
  const page = await open("/checkout/success?orderId=" + order);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  const old = flow.releaseStatus;
  flow.user = "other";
  flow.status = 403;
  flow.holdStatus = false;
  await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
  await page.getByText("Order details unavailable").waitFor();
  old();
  assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  flow.status = receipt;
  await page.getByText("Check order status").click();
  await page.getByText("Order Confirmed!").waitFor();
  const different = "10000000-0000-4000-8000-000000000002";
  await page.evaluate(
    (id) => window.navigate("/checkout/success?orderId=" + id),
    different,
  );
  await page.getByText("We could not confirm the order").waitFor();
  assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  flow.status = { ...receipt, id: different, total: "20" };
  await page.getByText("Check order status").click();
  await page.getByText("We could not confirm the order").waitFor();
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], [0, 0, 0]);
});
test("receipt cancel entry verifies terminal states and never clears shopping on navigation", async (t) => {
  const { open, flow } = await fixture(t, { initialStatus: 401 });
  const page = await open("/checkout/cancel");
  await page.getByText("Order status unverified").waitFor();
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(flow.gets.length, 0);
  for (const [status, title] of [
    ["canceled", "Order canceled"],
    ["declined", "Payment declined"],
    ["failed", "Payment failed"],
    ["review", "Payment under review"],
    ["unknown", "We could not confirm the order"],
    [401, "Order details unavailable"],
    [404, "We could not confirm the order"],
  ]) {
    flow.status = typeof status === "number" ? status : { ...receipt, status };
    await page.evaluate(
      ([order, status]) =>
        window.navigate("/checkout/cancel?orderId=" + order + "&token=" + status),
      [order, status],
    );
    await page.getByRole("heading", { name: title }).waitFor();
    assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  }
  assert.deepEqual((await state(page)).items, [2]);
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], [0, 0, 0]);
});
test("actual late prepare cannot issue a permit or overwrite a newer attempt", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdPrepare = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releasePrepare)).toBe(true);
  await page.evaluate(() => {
    sessionStorage.setItem("checkout_idempotency_key", "newer");
    sessionStorage.setItem("checkout_cart_fingerprint", "newer-cart");
    sessionStorage.setItem("rdk_guest_order_token", "keep");
  });
  flow.releasePrepare();
  await page.getByText(/Your checkout changed/).waitFor();
  assert.equal((await state(page)).key, "newer");
  assert.equal((await state(page)).token, "keep");
  assert.equal(flow.permits, 0);
});
test("actual prepare ignores 409 after a newer financial key was published", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdPrepare = true;
  flow.prepareFailure = 409;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releasePrepare)).toBe(true);
  await page.evaluate(() => {
    sessionStorage.setItem("checkout_idempotency_key", "newer");
    sessionStorage.setItem("checkout_cart_fingerprint", "newer-cart");
  });
  flow.releasePrepare();
  await page.getByText(/Your checkout changed/).waitFor();
  assert.equal((await state(page)).key, "newer");
  assert.equal(flow.permits, 0);
});
test("actual identity switch during prepare keeps financial key and blocks permit", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdPrepare = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releasePrepare)).toBe(true);
  flow.user = "other";
  await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
  await expect.poll(async () => (await state(page)).items).toEqual([]);
  flow.releasePrepare();
  await page.waitForTimeout(100);
  assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
  assert.equal(flow.permits, 0);
  assert.equal((await state(page)).token, null);
});

for (const missing of [false, true])
  test(
    "actual lost prepare response reuses original key with " +
      (missing ? "missing" : "intact") +
      " capture",
    async (t) => {
      const { flow, open } = await fixture(t);
      flow.dropPrepare = true;
      const page = await open();
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      const key = (await state(page)).key;
      assert.equal(flow.permits, 0);
      if (missing)
        await page.evaluate(() =>
          localStorage.removeItem("rdk_cart_user_buyer:purchase-v1"),
        );
      await page.reload();
      await submit(page);
      await page.getByText("Order Confirmed!").waitFor();
      assert.deepEqual(
        flow.prepares.map((p) => p.idempotencyKey),
        [key, key],
      );
      await expect
        .poll(async () => (await state(page)).items)
        .toEqual(missing ? [2] : []);
      assert.equal((await state(page)).key, missing ? key : null);
      assert.equal(flow.pays, missing ? 0 : 1);
      assert.equal(flow.permits, missing ? 0 : 1);
      assert.equal(flow.prepares[1].recoveryOnly, missing ? true : undefined);
    },
  );
test("actual capture write failure never persists a fresh financial key", async (t) => {
  const { open, flow } = await fixture(t);
  const page = await open();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.endsWith(":purchase-v1")) throw Error("storage unavailable");
      return set.call(this, k, v);
    };
  });
  await submit(page);
  await page.getByText("Retry cart access").waitFor();
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "storage recovery must dismiss checkout progress",
  );
  assert.equal((await state(page)).key, null);
  assert.equal(flow.prepares.length, 0);
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rdk_cart_user_buyer")).map((x) => x.quantity),
    ),
    [2],
  );
});
test("permit review after binding observes the original order without submitting a payment", async (t) => {
  const { open, flow } = await fixture(t, {
    pay: "terminal-review",
    initialStatus: {
      ...receipt,
      status: "review",
      financial: {
        source: "ledger",
        snapshot: {
          orderId: order,
          revision: "2",
          capturedCents: 2000,
          refundedCents: 0,
          financialState: "paid",
          fulfillmentStatus: "unfulfilled",
          reviewReason: "square_terminal_capture_conflict",
        },
      },
      purchasedLines: null,
    },
  });
  const page = await open();
  await submit(page);
  await page.getByText("Payment under review", { exact: true }).first().waitFor();
  assert.equal(flow.permits, 1);
  assert.equal(flow.pays, 0);
  assert.equal(flow.reservations.size, 1);
  assert.ok(flow.gets.length > 0);
  assert.equal(new URL(page.url()).searchParams.get("orderId"), order);
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rdk_cart_user_buyer")).map((i) => i.quantity),
    ),
    [2],
  );
  assert.equal(await page.getByText(/payment was declined|no charge/i).count(), 0);
});
test("actual malformed pay handoff checks only the original ID", async (t) => {
  const { open, flow } = await fixture(t, { pay: "wrong" });
  const page = await open();
  await submit(page);
  await page.getByText("Order Confirmed!").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("orderId"), order);
  assert.equal(flow.pays, 1);
  assert.equal(flow.gets.length, 1);
});
test("actual 402 retains the basket and shows the provider decline", async (t) => {
  const { open, flow } = await fixture(t, { pay: "decline" });
  const page = await open();
  await submit(page);
  await page.getByText("Payment declined by provider").waitFor();
  assert.deepEqual((await state(page)).items, [2]);
  assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
  assert.deepEqual([flow.pays, flow.gets.length], [1, 0]);
});
test("receipt in another account tab consumes just the original cart and origin replays its own housekeeping", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdStatus = true;
  const first = await open();
  await submit(first);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  const release = flow.releaseStatus;
  flow.holdStatus = false;
  const second = await open("/checkout/success?orderId=" + order);
  await second.getByText("Order Confirmed!").waitFor();
  await expect.poll(async () => (await state(second)).items).toEqual([]);
  assert.equal((await state(first)).key, flow.prepares[0].idempotencyKey);
  await second.evaluate((item) => window.cart.addItem(item), shoe);
  release();
  await first.getByText("Order Confirmed!").waitFor();
  await expect.poll(async () => (await state(first)).key).toBe(null);
  assert.deepEqual((await state(first)).items, [1]);
  assert.deepEqual((await state(second)).items, [1]);
  assert.equal(flow.pays, 1);
});

test("actual guest checkout consumes only the originating guest tab", async (t) => {
  const { open, flow } = await fixture(t, {
    owner: null,
    initialStatus: (url) =>
      url.searchParams.get("token") === "from-prepare" ? receipt : 401,
  });
  flow.holdStatus = true;
  const first = await open();
  await submit(first);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  const release = flow.releaseStatus;
  flow.holdStatus = false;
  const second = await open("/checkout/success?orderId=" + order + "&token=from-prepare");
  await second.getByText("Order Confirmed!").waitFor();
  await second.waitForFunction(() => window.cart?.isReady);
  assert.deepEqual((await state(second)).items, [2]);
  assert.equal((await state(second)).token, null);
  release();
  await first.getByText("Order Confirmed!").waitFor();
  await expect.poll(async () => (await state(first)).items).toEqual([]);
  assert.equal((await state(first)).token, "from-prepare");
  assert.deepEqual((await state(second)).items, [2]);
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], [1, 1, 1]);
  assert.deepEqual(flow.unexpected, []);
});

async function holdCartLock(page) {
  await page.evaluate(
    () =>
      new Promise((acquired) => {
        void navigator.locks.request(
          "rdk_cart",
          () =>
            new Promise((release) => {
              window.releaseCartLock = release;
              acquired();
            }),
        );
      }),
  );
}
async function queued(page) {
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await navigator.locks.query()).pending.some((lock) => lock.name === "rdk_cart"),
      ),
    )
    .toBe(true);
}
async function releaseCartLock(page) {
  await page.evaluate(async () => {
    window.releaseCartLock();
    await navigator.locks.request("rdk_cart", () => {});
  });
}
const proofBytes = (page) =>
  page.evaluate(() => localStorage.getItem("rdk_cart_user_buyer:purchase-v1"));

test("actual queued capture loses permission when checkout is left before the Web Lock opens", async (t) => {
  const { open, flow } = await fixture(t);
  const page = await open();
  await page.getByRole("button", { name: "Pay $20.00 now" }).waitFor();
  const before = await proofBytes(page);
  await holdCartLock(page);
  await submit(page);
  await queued(page);
  await page.evaluate(() => window.navigate("/checkout/cancel"));
  await page.getByText("Order status unverified").waitFor();
  await releaseCartLock(page);
  assert.equal(
    await proofBytes(page),
    before,
    "retired checkout must not supersede purchase proof",
  );
  assert.equal((await state(page)).key, null);
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], [0, 0, 0]);
});

test("actual queued bind loses permission when checkout is left before the Web Lock opens", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdPrepare = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releasePrepare)).toBe(true);
  const before = await proofBytes(page);
  assert.ok(before);
  await holdCartLock(page);
  flow.releasePrepare();
  await queued(page);
  await page.evaluate(() => window.navigate("/checkout/cancel"));
  await page.getByText("Order status unverified").waitFor();
  await releaseCartLock(page);
  assert.equal(
    await proofBytes(page),
    before,
    "late order association must not write after navigation",
  );
  assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
  assert.equal((await state(page)).token, null);
  assert.deepEqual([flow.permits, flow.pays], [0, 0]);
});
test("receipt revokes queued consumption when access changes on the same order", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdStatus = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  await holdCartLock(page);
  const before = await proofBytes(page);
  flow.holdStatus = false;
  flow.releaseStatus();
  await page.getByText("Order Confirmed!").waitFor();
  await queued(page);
  flow.status = 403;
  await page.evaluate(
    (order) => window.navigate("/checkout/success?orderId=" + order + "&token=old"),
    order,
  );
  await page.getByText("Order details unavailable").waitFor();
  await releaseCartLock(page);
  assert.equal(
    await proofBytes(page),
    before,
    "a revoked status observation cannot consume a purchase",
  );
  assert.deepEqual((await state(page)).items, [2]);
  assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
  flow.status = receipt;
  await page.getByText("Check order status").click();
  await page.getByText("Order Confirmed!").waitFor();
  await expect.poll(async () => (await state(page)).items).toEqual([]);
  assert.equal(flow.pays, 1);
});
test("receipt keeps eligible queued consumption across the immediate processing handoff", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdStatus = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  await holdCartLock(page);
  flow.holdStatus = false;
  flow.releaseStatus();
  await page.getByText("Order Confirmed!").waitFor();
  await queued(page);
  assert.deepEqual((await state(page)).items, [2]);
  assert.equal(flow.gets.length, 1);
  await releaseCartLock(page);
  await expect.poll(async () => (await state(page)).items).toEqual([]);
  await expect.poll(async () => (await state(page)).key).toBe(null);
});

test("receipt cannot transfer account A's verified handoff to account B", async (t) => {
  const { open, flow } = await fixture(t);
  const page = await open();
  await page.evaluate(() => (window.holdSuccess = true));
  await submit(page);
  await page.waitForFunction(() => window.nextSuccess);
  assert.deepEqual((await state(page)).items, [2]);
  flow.user = "other";
  flow.status = 403;
  await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
  await page.getByText("Order details unavailable").waitFor();
  flow.holdStatus = true;
  flow.releaseStatus = undefined;
  await page.evaluate(() => window.navigate(window.nextSuccess));
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  flow.releaseStatus();
  await page.getByText("Order details unavailable").waitFor();
  assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rdk_cart_user_buyer")).map(
        (line) => line.quantity,
      ),
    ),
    [2],
  );
});

for (const purchasedLines of [
  null,
  [{ ...line, variantId: "30000000-0000-4000-8000-000000000003" }],
])
  test(
    "actual receipt preserves shopping with " +
      (purchasedLines ? "unknown purchased pair" : "unavailable projection"),
    async (t) => {
      const { open, flow } = await fixture(t, {
        initialStatus: { ...receipt, purchasedLines },
      });
      const page = await open();
      await submit(page);
      await page.getByText("Order Confirmed!").waitFor();
      await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
      assert.deepEqual((await state(page)).items, [2]);
      assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
      assert.equal((await state(page)).token, null);
    },
  );

for (const pay of ["accepted", "lost"])
  test(
    "actual transient guest token reaches original status after " + pay + " reply",
    async (t) => {
      const { flow, open } = await fixture(t, {
        owner: null,
        pay,
        initialStatus: (url) =>
          url.searchParams.get("token") === "from-prepare" ? receipt : 401,
      });
      flow.holdPrepare = true;
      const page = await open();
      await submit(page);
      await expect.poll(() => Boolean(flow.releasePrepare)).toBe(true);
      await page.evaluate(() => {
        sessionStorage.setItem("rdk_guest_order_id", "newer");
        sessionStorage.setItem("rdk_guest_order_token", "new-token");
      });
      flow.releasePrepare();
      await expect.poll(() => flow.gets.length).toBe(1);
      assert.equal(new URLSearchParams(flow.gets[0]).get("token"), "from-prepare");
      await page.getByText("Order Confirmed!").waitFor();
      assert.equal(flow.permitBody.guestAccessToken, "from-prepare");
      assert.equal((await state(page)).token, "new-token");
      assert.equal(new URL(page.url()).searchParams.get("token"), null);
    },
  );
test("actual definite pre-provider 503 leaves actionable checkout", async (t) => {
  const { flow, open } = await fixture(t, { pay: "pre-provider" });
  const page = await open();
  await submit(page);
  await expect.poll(() => flow.pays).toBe(1);
  await page.getByText("Address verification is temporarily unavailable.").waitFor();
  assert.equal(flow.gets.length, 0);
  await page.getByRole("button", { name: "Return to checkout" }).click();
  await submit(page);
  await expect.poll(() => flow.pays).toBe(2);
  assert.equal(flow.prepares[1].idempotencyKey, flow.prepares[0].idempotencyKey);
});
test("actual generic gateway 503 checks the original order without resubmission", async (t) => {
  const { flow, open } = await fixture(t, { pay: "gateway" });
  const page = await open();
  await submit(page);
  await page.getByText("Order Confirmed!").waitFor();
  assert.deepEqual(
    [flow.prepares.length, flow.permits, flow.pays, flow.gets.length],
    [1, 1, 1, 1],
  );
});
test("receipt renders null legacy fulfillment without delivery claims", async (t) => {
  const { open } = await fixture(t, { initialStatus: { ...receipt, fulfillment: null } });
  const page = await open("/checkout/success?orderId=" + order);
  await page.getByText("Order Confirmed!").waitFor();
  assert.equal(await page.getByText("Shipping:", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Local pickup").count(), 0);
});
test("receipt rejects HTTP 400 immediately for an invalid order link", async (t) => {
  const { open, flow } = await fixture(t, { initialStatus: 400 });
  const page = await open("/checkout/processing?orderId=never-verified");
  await page.getByText("We could not confirm the order").waitFor();
  assert.equal(flow.gets.length, 1);
  assert.equal(await page.locator("dialog[open]").count(), 0);
});

test("actual failed switch after a lost prepare reloads original A with its issued key", async (t) => {
  const { flow, open } = await fixture(t);
  flow.dropPrepare = true;
  const page = await open();
  await submit(page);
  await page.getByText("Return to checkout").waitFor();
  const first = flow.prepares[0];
  await page.evaluate(() =>
    sessionStorage.setItem("fixtureEmail", "buyer-b@example.test"),
  );
  await page.reload();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "checkout_cart_fingerprint") {
        Storage.prototype.setItem = set;
        throw Error("quota switch B");
      }
      return set.call(this, key, value);
    };
  });
  await submit(page);
  await page.getByText("quota switch B").waitFor();
  assert.equal(flow.prepares.length, 1);
  await page.evaluate(() => sessionStorage.removeItem("fixtureEmail"));
  await page.reload();
  await submit(page);
  await expect.poll(() => flow.prepares.length).toBe(2);
  assert.equal(flow.prepares[1].idempotencyKey, first.idempotencyKey);
  assert.equal(flow.reservations.size, 1);
  await page.getByText("Order Confirmed!").waitFor();
  assert.deepEqual((await state(page)).items, [2]);
  assert.equal(flow.pays, 0);
  assert.equal(flow.permits, 0);
});

async function replaceStoredGuest(page) {
  await page.evaluate(() => {
    sessionStorage.setItem("rdk_guest_order_id", "newer");
    sessionStorage.setItem("rdk_guest_order_token", "new-token");
    window.dispatchEvent(new Event("checkout-guest-access"));
  });
}

test("actual withdrawn stored guest access retires the original in-flight status", async (t) => {
  const { open, flow } = await fixture(t, { owner: null });
  flow.holdStatus = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  const initial = await state(page);
  assert.equal(initial.token, "from-prepare");
  const readProof = () =>
    page.evaluate(() => sessionStorage.getItem("rdk_cart_session:purchase-v1"));
  const proof = await readProof();
  assert.ok(proof);
  flow.status = 401;
  flow.holdStatus = false;
  await replaceStoredGuest(page);
  flow.releaseStatus();
  await expect.poll(() => flow.gets.length).toBe(2);
  await page.getByText("Order details unavailable").waitFor();
  assert.deepEqual(
    flow.gets.map((query) => new URLSearchParams(query).get("token")),
    ["from-prepare", null],
  );
  assert.equal(await page.getByText("Order Confirmed!").count(), 0);
  assert.deepEqual(await state(page), { ...initial, token: "new-token" });
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("rdk_guest_order_id")),
    "newer",
  );
  assert.equal(await readProof(), proof);
  assert.deepEqual([flow.prepares.length, flow.permits, flow.pays], [1, 1, 1]);
});

test("receipt withdrawn stored guest access revokes queued account Cart consumption", async (t) => {
  const { open, flow } = await fixture(t);
  flow.holdStatus = true;
  const page = await open();
  await page.evaluate((order) => {
    sessionStorage.setItem("rdk_guest_order_id", order);
    sessionStorage.setItem("rdk_guest_order_token", "from-prepare");
  }, order);
  await submit(page);
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  await holdCartLock(page);
  const initial = await state(page);
  const proof = await proofBytes(page);
  assert.ok(proof);
  assert.equal(initial.token, "from-prepare");
  flow.holdStatus = false;
  flow.releaseStatus();
  await page.getByText("Order Confirmed!").waitFor();
  await queued(page);
  flow.status = 401;
  await replaceStoredGuest(page);
  await expect.poll(() => flow.gets.length).toBe(2);
  await page.getByText("Order details unavailable").waitFor();
  await releaseCartLock(page);
  assert.deepEqual(await state(page), { ...initial, token: "new-token" });
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("rdk_guest_order_id")),
    "newer",
  );
  assert.equal(await proofBytes(page), proof);
});

test("actual partial gateway 503 body recovers the original order within two seconds", async (t) => {
  const { flow, open } = await fixture(t, { pay: "gateway" });
  const page = await open();
  const orders = [];
  page.on("request", (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith("/api/orders/")) orders.push(pathname);
  });
  await page.clock.install();
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const response = await originalFetch(url, options);
      if (url !== "/api/checkout/pay") return response;
      const encode = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encode.encode("{"));
          window.completePayBody = () => {
            controller.enqueue(
              encode.encode('"code":"PAYMENT_NOT_SUBMITTED","error":"Late marker"}'),
            );
            controller.close();
          };
        },
      });
      await new Promise((resolve) => {
        window.deliverPayHeaders = resolve;
      });
      return new Response(body, { status: response.status, headers: response.headers });
    };
  });
  await submit(page);
  await page.waitForFunction(() => Boolean(window.deliverPayHeaders));
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await page.evaluate(() => window.deliverPayHeaders());
  await page.clock.fastForward(2000);
  await expect.poll(() => orders).toEqual(["/api/orders/" + order]);
  await page.getByText("Order Confirmed!").waitFor();
  await page.evaluate(() => window.completePayBody());
  await page.clock.fastForward(5000);
  await page.getByText("Order Confirmed!").waitFor();
  assert.equal(await page.getByText("Late marker").count(), 0);
  assert.deepEqual(
    [flow.prepares.length, flow.permits, flow.pays, flow.gets.length],
    [1, 1, 1, 1],
  );
});

test("actual transient guest access retires when its stored replacement is withdrawn", async (t) => {
  const { flow, open } = await fixture(t, { owner: null });
  flow.holdPrepare = true;
  flow.holdStatus = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => Boolean(flow.releasePrepare)).toBe(true);
  await replaceStoredGuest(page);
  flow.releasePrepare();
  await expect.poll(() => Boolean(flow.releaseStatus)).toBe(true);
  await page.evaluate(async (orderId) => {
    sessionStorage.setItem("rdk_guest_order_id", orderId);
    sessionStorage.setItem("rdk_guest_order_token", "from-prepare");
    window.dispatchEvent(new Event("checkout-guest-access"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, order);
  flow.holdStatus = false;
  flow.status = 401;
  await replaceStoredGuest(page);
  flow.releaseStatus();
  await page.getByText("Order details unavailable").waitFor();
  assert.equal(new URLSearchParams(flow.gets.at(-1)).get("token"), null);
  assert.deepEqual((await state(page)).items, [2]);
  assert.equal((await state(page)).key, flow.prepares[0].idempotencyKey);
});

import { mountCheckoutBrowser } from "../../../../../../tests/browser/fixtures/checkout-hardening.mjs";
const orderId = "10000000-0000-4000-8000-000000000001";
const fixtureShoe = {
  productId: "20000000-0000-4000-8000-000000000001",
  variantId: "30000000-0000-4000-8000-000000000001",
  quantity: 2,
  priceCents: 1000,
  sizeLabel: "10",
  name: "Shoe",
  titleDisplay: "Shoe",
  brand: "Sole",
  imageUrl: "",
};
test("invalid_receipt_and_deadline_never_clear_or_assert_paid", async (t) => {
  const requests = [];
  const fixture = await mountCheckoutBrowser({
    view: "receipt",
    path: "/checkout/success?orderId=" + orderId + "&token=invalid",
    guestItems: [fixtureShoe],
    route: async (r, u) => {
      requests.push([r.request().method(), u.pathname]);
      if (u.pathname.startsWith("/api/orders/"))
        return r.fulfill({ status: 403, json: { error: "Unauthorized" } });
      if (u.pathname.includes("validate")) return r.fulfill({ status: 503, json: {} });
      throw Error(u.pathname);
    },
  });
  t.after(fixture.close);
  await expect
    .poll(() => requests.filter(([, p]) => p.startsWith("/api/orders/")).length)
    .toBe(1);
  await expect(
    fixture.page.getByRole("heading", { name: "Order Confirmed!" }),
  ).toHaveCount(0);
  assert.equal(await fixture.page.evaluate(() => window.testCart.items[0]?.quantity), 2);
  await expect(
    fixture.page.getByText("Order details unavailable", { exact: true }),
  ).toBeVisible();
});

for (const method of ["card", "applePay", "cashAppPay", "afterpay"]) {
  test(
    "actual " + method + " observes its own verified hold before completing one payment",
    async (t) => {
      const { open, flow } = await fixture(t);
      flow.ownHold = true;
      flow.holdPermit = true;
      const page = await open();
      await page.waitForFunction(() => typeof window.payCash === "function");
      if (method === "card") await submit(page);
      if (method === "applePay")
        await page
          .getByRole("button", { name: "Pay with Apple Pay" })
          .evaluate((el) => el.click());
      if (method === "afterpay") {
        await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
        await page.getByRole("button", { name: "Continue with Afterpay" }).click();
      }
      if (method === "cashAppPay") {
        await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
        await page.evaluate(() => window.payCash());
      }
      await expect
        .poll(async () =>
          flow.releasePermit ? "permit" : await page.locator("main").innerText(),
        )
        .toBe("permit");
      await expect
        .poll(() => page.evaluate(() => window.cart.items[0]?.orderScoped))
        .toBe(true);
      assert.equal(flow.pays, 0);
      flow.releasePermit();
      await page.getByRole("heading", { name: "Order Confirmed!" }).waitFor();
      await expect.poll(async () => (await state(page)).items).toEqual([]);
      assert.deepEqual(
        [flow.prepares.length, flow.permits, flow.pays, flow.gets.length],
        [1, 1, 1, 1],
      );
    },
  );
}

test("actual pending order restores only its current scope after document reload and terminal observation closes it", async (t) => {
  const { open, flow } = await fixture(t, {
    initialStatus: { ...receipt, status: "pending", purchasedLines: null },
  });
  flow.ownHold = true;
  const page = await open();
  await submit(page);
  await expect.poll(() => flow.gets.length).toBeGreaterThan(0);
  flow.holdValidated = false;
  await page.reload();
  await expect.poll(() => flow.holdValidated).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.cart.items[0]?.orderScoped))
    .toBe(true);
  flow.status = { ...receipt, status: "refunded" };
  await page.getByRole("heading", { name: "Order refund recorded" }).waitFor();
  assert.deepEqual((await state(page)).items, [2]);
  flow.holdValidated = false;
  const reads = flow.gets.length;
  await page.reload();
  await expect.poll(() => flow.gets.length).toBeGreaterThan(reads);
  await page.getByRole("heading", { name: "Order refund recorded" }).waitFor();
  assert.equal(flow.holdValidated, false);
});
test("actual pay with stalled response headers enters original GET-only recovery", async (t) => {
  const { open, flow } = await fixture(t, {
    initialStatus: { ...receipt, status: "pending" },
  });
  flow.holdPay = true;
  const page = await open();
  await page.clock.install();
  await submit(page);
  await expect.poll(() => !!flow.releasePay).toBe(true);
  await page.clock.fastForward(10001);
  await expect.poll(() => flow.gets.length).toBeGreaterThan(0);
  assert.equal(flow.pays, 1);
  assert.deepEqual((await state(page)).items, [2]);
  flow.releasePay();
});

test("actual gateway timeout checks the prepared order without another payment", async (t) => {
  const { open, flow } = await fixture(t, { pay: "timeout" });
  const page = await open();
  await submit(page);
  await page.getByRole("heading", { name: "Order Confirmed!" }).waitFor();
  assert.deepEqual(
    [flow.prepares.length, flow.permits, flow.pays, flow.gets.length],
    [1, 1, 1, 1],
  );
});

for (const missing of [false, true])
  test(
    "actual recovery-only rejection retains the original key across repeated checkout and reload missing=" +
      missing,
    async (t) => {
      const { open, flow } = await fixture(t);
      flow.dropPrepare = true;
      const page = await open();
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      const key = (await state(page)).key;
      if (missing)
        await page.evaluate(() =>
          localStorage.removeItem("rdk_cart_user_buyer:purchase-v1"),
        );
      await page.reload();
      flow.prepareFailure = 409;
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      await page.getByText("Return to checkout").click();
      assert.equal((await state(page)).key, key);
      await expect(
        page.getByRole("button", { name: /^Pay(?: .*?)? now$/ }),
      ).toBeDisabled();
      await page.reload();
      await expect(
        page.getByRole("button", { name: /^Pay(?: .*?)? now$/ }),
      ).toBeDisabled();
      assert.deepEqual(
        flow.prepares.map((p) => p.idempotencyKey),
        [key, key],
      );
      assert.deepEqual([flow.reservations.size, flow.permits, flow.pays], [1, 0, 0]);
    },
  );
for (const previousId of ["prior", order])
  test(
    "actual guest binding and credential writes denied still use the returned grant for one GET previous=" +
      previousId,
    async (t) => {
      const { open, flow } = await fixture(t, {
        owner: null,
        initialStatus: (url) =>
          url.searchParams.get("token") === "from-prepare" ? receipt : 403,
      });
      const page = await open();
      await page.evaluate((id) => {
        sessionStorage.setItem("rdk_guest_order_id", id);
        sessionStorage.setItem("rdk_guest_order_token", "prior-grant");
      }, previousId);
      flow.holdPrepare = true;
      await submit(page);
      await expect.poll(() => !!flow.releasePrepare).toBe(true);
      await page.evaluate(() => {
        window.credentialAttempts = 0;
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === "rdk_guest_order_token") window.credentialAttempts++;
          if (
            k.endsWith(":purchase-v1") ||
            k === "checkout_original_recovery_v1" ||
            k === "rdk_guest_order_token"
          )
            throw new DOMException("denied", "QuotaExceededError");
          return set.call(this, k, v);
        };
      });
      flow.releasePrepare();
      await page.getByText("Order Confirmed!").waitFor();
      assert.ok(await page.evaluate(() => window.credentialAttempts > 0));
      assert.equal((await state(page)).token, "prior-grant");
      assert.deepEqual([flow.gets.length, flow.permits, flow.pays], [1, 0, 0]);
      assert.deepEqual(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem("rdk_cart_session")).map(
            (row) => row.quantity,
          ),
        ),
        [2],
      );
    },
  );
for (const [pay, change] of [
  ["decline", "pair"],
  ["pre-provider", "credential"],
  ["decline", "owner"],
]) {
  test(
    "actual delayed " + pay + " body retires after " + change + " changes",
    async (t) => {
      const { open, flow } = await fixture(t, {
        owner: change === "credential" ? null : "buyer",
        pay,
      });
      const page = await open();
      await page.evaluate(() => {
        const old = window.fetch.bind(window);
        window.fetch = async (path, init) => {
          const response = await old(path, init);
          if (path === "/api/checkout/pay") {
            const json = response.json.bind(response);
            response.json = async () => {
              await new Promise((r) => (window.releaseErrorBody = r));
              return json();
            };
          }
          return response;
        };
      });
      await submit(page);
      await page.waitForFunction(() => !!window.releaseErrorBody);
      if (change === "pair")
        await page.evaluate(() => {
          sessionStorage.setItem("checkout_cart_fingerprint", "new purchase");
          window.releaseErrorBody();
        });
      if (change === "credential")
        await page.evaluate(() => {
          sessionStorage.setItem("rdk_guest_order_token", "new grant");
          window.dispatchEvent(new Event("checkout-guest-access"));
          window.releaseErrorBody();
        });
      if (change === "owner") {
        flow.user = "other";
        await page.evaluate(() => {
          window.dispatchEvent(new Event("sessionUpdate"));
          window.releaseErrorBody();
        });
      }
      if (change !== "owner") await page.getByText(/Your checkout changed/).waitFor();
      else await expect.poll(async () => (await state(page)).items).toEqual([]);
      assert.equal(
        await page
          .getByText(
            /Payment declined by provider|Address verification is temporarily unavailable/,
          )
          .count(),
        0,
      );
      assert.equal(flow.gets.length, 0);
      assert.equal(flow.pays, 1);
    },
  );
}
for (const notify of [false, true])
  test(
    "receipt pair-only replacement revokes visible facts and a queued consumption notify=" +
      notify,
    async (t) => {
      const { open, flow } = await fixture(t);
      flow.holdStatus = true;
      const page = await open();
      await submit(page);
      await expect.poll(() => !!flow.releaseStatus).toBe(true);
      await holdCartLock(page);
      const before = await proofBytes(page);
      flow.holdStatus = false;
      flow.releaseStatus();
      await page.getByText("Order Confirmed!").waitFor();
      await queued(page);
      flow.status = 403;
      await page.evaluate((notify) => {
        sessionStorage.setItem("checkout_cart_fingerprint", "replaced");
        if (notify)
          window.dispatchEvent(
            new StorageEvent("storage", {
              key: "checkout_cart_fingerprint",
              storageArea: sessionStorage,
            }),
          );
        window.releaseCartLock();
      }, notify);
      await page.getByText("Order details unavailable").waitFor();
      assert.equal(await proofBytes(page), before);
      assert.deepEqual((await state(page)).items, [2]);
      assert.equal((await state(page)).fingerprint, "replaced");
    },
  );

for (const missing of [false, true])
  test(
    "actual settled original goes directly to verified GET with missing proof " + missing,
    async (t) => {
      const { open, flow } = await fixture(t);
      flow.dropPrepare = true;
      const page = await open();
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      const key = (await state(page)).key;
      if (missing)
        await page.evaluate(() =>
          localStorage.removeItem("rdk_cart_user_buyer:purchase-v1"),
        );
      await page.reload();
      flow.terminalOriginal = true;
      await submit(page);
      await page.getByText("Order Confirmed!").waitFor();
      assert.deepEqual(
        flow.prepares.map((p) => p.idempotencyKey),
        [key, key],
      );
      assert.deepEqual(
        [flow.reservations.size, flow.gets.length, flow.permits, flow.pays],
        [1, 1, 0, 0],
      );
      assert.deepEqual((await state(page)).items, [2]);
    },
  );

async function denyFreshGuestGrant(page) {
  await page.evaluate(() => {
    sessionStorage.setItem("rdk_guest_order_id", "order-b");
    sessionStorage.setItem("rdk_guest_order_token", "grant-b");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "rdk_guest_order_token" && value === "from-prepare")
        throw new DOMException("denied", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
}
async function supersedeUnrelatedGrant(page, change) {
  if (change === "read ABA") {
    const checks = await page.evaluate((id) => {
      const observer = window.fixtureGuestObservation();
      const originalGuest = window.fixtureGuestCredential.read(id);
      const before = observer();
      sessionStorage.setItem("rdk_guest_order_id", "order-c");
      sessionStorage.setItem("rdk_guest_order_token", "grant-c");
      const during = observer();
      const duringGuest = window.fixtureGuestCredential.read(id);
      sessionStorage.setItem("rdk_guest_order_id", "order-b");
      sessionStorage.setItem("rdk_guest_order_token", "grant-b");
      const afterGuest = window.fixtureGuestCredential.read(id);
      window.fixtureGuestCredential.retain(id);
      window.releaseErrorBody?.();
      window.releaseGuestConsume?.();
      return {
        before,
        during,
        after: observer(),
        expectedInitialGrant:
          originalGuest === (window.releaseGuestConsume ? "from-prepare" : null),
        grantRevived: afterGuest !== null,
        withheld: duringGuest === null,
        retired: window.fixtureGuestCredential.read(id) === null,
      };
    }, order);
    assert.deepEqual(checks, {
      before: true,
      during: false,
      after: false,
      expectedInitialGrant: true,
      grantRevived: false,
      withheld: true,
      retired: true,
    });
    return;
  }
  await page.evaluate((change) => {
    if (change === "replace" || change === "ABA") {
      sessionStorage.setItem("rdk_guest_order_id", "order-c");
      sessionStorage.setItem("rdk_guest_order_token", "grant-c");
    } else {
      sessionStorage.removeItem("rdk_guest_order_id");
      sessionStorage.removeItem("rdk_guest_order_token");
    }
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "rdk_guest_order_token",
        storageArea: sessionStorage,
      }),
    );
    if (change === "ABA") {
      sessionStorage.setItem("rdk_guest_order_id", "order-b");
      sessionStorage.setItem("rdk_guest_order_token", "grant-b");
      window.dispatchEvent(new Event("checkout-guest-access"));
    }
    window.releaseErrorBody?.();
    window.releaseGuestConsume?.();
  }, change);
}
for (const change of ["replace", "withdraw", "ABA", "read ABA"]) {
  test(
    "delayed transient guest financial error retires on unrelated grant " + change,
    async (t) => {
      const { open, flow } = await fixture(t, { owner: null, pay: "decline" });
      const page = await open();
      await denyFreshGuestGrant(page);
      await page.evaluate(() => {
        const get = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const response = await get(...args);
          if (args[0] === "/api/checkout/pay") {
            const json = response.json.bind(response);
            response.json = async () => {
              await new Promise((r) => (window.releaseErrorBody = r));
              return json();
            };
          }
          return response;
        };
      });
      await submit(page);
      await page.waitForFunction(() => !!window.releaseErrorBody);
      assert.equal((await state(page)).token, "grant-b");
      await supersedeUnrelatedGrant(page, change);
      await page.getByText(/Your checkout changed/).waitFor();
      assert.equal(await page.getByText("Payment declined by provider").count(), 0);
      assert.deepEqual([flow.pays, flow.gets.length], [1, 0]);
    },
  );
  test(
    "confirmed transient receipt and deferred guest consumption retire on unrelated grant " +
      change,
    async (t) => {
      const { open, flow } = await fixture(t, {
        owner: null,
        initialStatus: (url) =>
          url.searchParams.get("token") === "from-prepare" ? receipt : 403,
      });
      flow.holdStatus = true;
      const page = await open();
      await denyFreshGuestGrant(page);
      await submit(page);
      await expect.poll(() => !!flow.releaseStatus).toBe(true);
      const prior = await page.evaluate(() => {
        const consume = window.cart.consumeConfirmedPurchase;
        window.cart.consumeConfirmedPurchase = async (...args) => {
          await new Promise((resolve) => (window.releaseGuestConsume = resolve));
          return consume(...args);
        };
        return sessionStorage.getItem("rdk_cart_session:purchase-v1");
      });
      flow.holdStatus = false;
      flow.releaseStatus();
      await page.getByText("Order Confirmed!").waitFor();
      await page.waitForFunction(() => !!window.releaseGuestConsume);
      await supersedeUnrelatedGrant(page, change);
      await page.getByText("Order details unavailable").waitFor();
      assert.deepEqual((await state(page)).items, [2]);
      assert.equal(
        await page.evaluate(() => sessionStorage.getItem("rdk_cart_session:purchase-v1")),
        prior,
      );
      assert.equal(await page.getByText("Order Confirmed!").count(), 0);
      assert.deepEqual(
        flow.gets.map((q) => new URLSearchParams(q).get("token")),
        ["from-prepare", null],
      );
    },
  );
}
for (const reload of [false, true])
  test(
    "lost recovery-only response retries strictly same original guest lookup reload=" +
      reload,
    async (t) => {
      const { open, flow } = await fixture(t, {
        owner: null,
        initialStatus: (url) =>
          url.searchParams.get("token") === "from-prepare" ? receipt : 403,
      });
      const page = await open();
      flow.dropPrepare = true;
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      const issued = (await state(page)).key;
      await page.evaluate(() =>
        sessionStorage.removeItem("rdk_cart_session:purchase-v1"),
      );
      await page.reload();
      flow.dropPrepare = true;
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      if (reload) {
        await page.evaluate(() =>
          sessionStorage.setItem("fixtureEmail", "changed@example.test"),
        );
        await page.reload();
      } else await page.getByText("Return to checkout").click();
      assert.equal((await state(page)).token, null);
      await expect(
        page.getByRole("button", { name: /^Pay(?: .*?)? now$/ }),
      ).toBeDisabled();
      const check = page.getByRole("button", { name: "Check original order" });
      await expect(check).toBeVisible();
      await expect(check).toBeEnabled();
      const cardTokens = await page.evaluate(() => window.fixtureCardTokens);
      if (reload) {
        flow.prepareFailure = 409;
        await check.press("Enter");
        await page.getByText(/We could not find your original order/).waitFor();
        flow.prepareFailure = null;
      }
      flow.terminalOriginal = true;
      await page.evaluate(() => {
        window.cart.captureForCheckout = () => {
          throw Error("recovery re-entered capture");
        };
      });
      await check.press("Enter");
      await page.getByText("Order Confirmed!").waitFor();
      assert.equal(await page.evaluate(() => window.fixtureCardTokens), cardTokens);
      assert.equal(flow.prepares[0].shippingAddressOverride, false);
      assert.equal(flow.prepares.length, reload ? 4 : 3);
      assert.equal(flow.prepares[0].idempotencyKey, issued);
      assert.equal(flow.prepares[1].recoveryOnly, true);
      for (const input of flow.prepares.slice(2))
        assert.deepEqual(input, flow.prepares[1]);
      assert.deepEqual(
        [flow.reservations.size, flow.permits, flow.pays, flow.gets.length],
        [1, 0, 0, 1],
      );
      assert.equal((await state(page)).key, issued);
      assert.deepEqual((await state(page)).items, [2]);
      const count = flow.prepares.length;
      await page.goto(origin + "/checkout");
      await check.press("Enter");
      await page.getByText("Order Confirmed!").waitFor();
      assert.deepEqual(
        [flow.prepares.length, flow.gets.length, flow.pays],
        [count, 2, 0],
      );
    },
  );

for (const known of [false, true])
  test(
    "verified account recovers with unwritable Cart after reload, known reference=" +
      known,
    async (t) => {
      const { open, flow } = await fixture(t);
      const page = await open();
      flow.dropPrepare = true;
      await submit(page);
      await page.getByText("Return to checkout").waitFor();
      const key = (await state(page)).key;
      await page.evaluate(() =>
        localStorage.removeItem("rdk_cart_user_buyer:purchase-v1"),
      );
      await page.reload();
      flow.terminalOriginal = known;
      flow.dropPrepare = !known;
      await submit(page);
      if (known) await page.getByText("Order Confirmed!").waitFor();
      else await page.getByText("Return to checkout").waitFor();
      const seen = {
        prepares: flow.prepares.length,
        gets: flow.gets.length,
        quotes: flow.quotes,
      };
      const basket = await page.evaluate(() => {
        const raw = localStorage.getItem("rdk_cart_user_buyer");
        localStorage.setItem("rdk_cart", raw);
        return raw;
      });
      // The real connect path tries to remove migrated legacy bytes. Deny only Cart writes;
      // account session verification and the tab's original financial pair remain available.
      await page.addInitScript(() => {
        const remove = Storage.prototype.removeItem,
          set = Storage.prototype.setItem;
        window.fixtureDeniedWrites = 0;
        Storage.prototype.removeItem = function (k) {
          if (this === localStorage && k.startsWith("rdk_cart")) {
            window.fixtureDeniedWrites++;
            throw new DOMException("denied", "QuotaExceededError");
          }
          return remove.call(this, k);
        };
        Storage.prototype.setItem = function (k, v) {
          if (this === localStorage && k.startsWith("rdk_cart")) {
            window.fixtureDeniedWrites++;
            throw new DOMException("denied", "QuotaExceededError");
          }
          return set.call(this, k, v);
        };
      });
      await page.goto(origin + "/checkout");
      await expect
        .poll(() =>
          page.evaluate(() => [
            window.cart?.access,
            window.cart?.isReady,
            window.fixtureDeniedWrites > 0,
          ]),
        )
        .toEqual(["unavailable", false, true]);
      flow.terminalOriginal = true;
      const check = page.getByRole("button", { name: "Check original order" });
      await expect(check).toBeVisible();
      await expect(page.getByRole("button", { name: /^Pay(?: .*?)? now$/ })).toHaveCount(
        0,
      );
      if (known) {
        flow.user = "other";
        await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
        await page.getByText("Updating your checkout details…").waitFor();
        await expect(check).toHaveCount(0);
        flow.user = "buyer";
        await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
      } else {
        flow.sessionFailure = true;
        await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
        await page.waitForFunction(() => window.fixtureSessionStatus === "unavailable");
        await expect(check).toHaveCount(0);
        flow.sessionFailure = false;
        await page.getByRole("button", { name: "Retry cart access" }).press("Enter");
      }
      await expect(check).toBeVisible();
      await page.waitForFunction(
        () =>
          window.cart.access === "unavailable" && window.fixtureSessionStatus === "ready",
      );
      await page.evaluate(() => {
        window.fixtureCaptureCalls = 0;
        window.cart.captureForCheckout = () => {
          window.fixtureCaptureCalls++;
          throw Error("recovery invoked capture");
        };
      });
      await check.press("Enter");
      await page.getByText("Order Confirmed!").waitFor();
      assert.equal(flow.quotes, seen.quotes);
      assert.equal(await page.evaluate(() => window.fixtureCaptureCalls), 0);
      assert.deepEqual(
        [
          flow.prepares.length,
          flow.gets.length,
          flow.reservations.size,
          flow.permits,
          flow.pays,
        ],
        [seen.prepares + (known ? 0 : 1), seen.gets + 1, 1, 0, 0],
      );
      if (!known) assert.deepEqual(flow.prepares.at(-1), flow.prepares[1]);
      assert.deepEqual(
        await page.evaluate(() => ({
          sdk: window.fixtureSdkStarts,
          tokens: window.fixtureCardTokens,
          ready: window.cart.isReady,
          raw: localStorage.getItem("rdk_cart_user_buyer"),
          legacy: localStorage.getItem("rdk_cart"),
          proof: localStorage.getItem("rdk_cart_user_buyer:purchase-v1"),
        })),
        { sdk: 0, tokens: 0, ready: false, raw: basket, legacy: basket, proof: null },
      );
      assert.equal((await state(page)).key, key);
    },
  );
