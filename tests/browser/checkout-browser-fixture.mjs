import assert from "node:assert/strict";
import { after, before } from "node:test";
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
    if (url.pathname === "/api/cart/validate")
      return route.fulfill({
        json: {
          removed: [],
          items: route
            .request()
            .postDataJSON()
            .items.map((row) => ({ ...shoe, maxStock: 10, ...row })),
        },
      });
    if (
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
    if (url.pathname === "/api/checkout/review") {
      return route.fulfill({ json: { reviewed: true, totals } });
    }
    if (["/api/checkout/prepare", "/api/checkout/submit"].includes(url.pathname)) {
      const combined = url.pathname.endsWith("/submit");
      const posted = route.request().postDataJSON();
      const prepare = combined ? posted.preparation : posted;
      flow.prepares.push(prepare);
      if (flow.holdPrepare) await new Promise((r) => (flow.releasePrepare = r));
      const { idempotencyKey: key, recoveryOnly } = prepare;
      if (!flow.prepareFailure && !recoveryOnly && !flow.reservations.has(key))
        flow.reservations.set(
          key,
          flow.reservations.size === 0 ? order : "10000000-0000-4000-8000-000000000002",
        );
      if (flow.dropPrepare) {
        flow.dropPrepare = false;
        return route.abort();
      }
      if (flow.prepareFailure)
        return route.fulfill({
          status: flow.prepareFailure,
          json: { error: "Retry preparation" },
        });
      const orderId = flow.reservations.get(key);
      if (recoveryOnly && !orderId)
        return route.fulfill({
          status: 409,
          json: { code: "CHECKOUT_RECOVERY_REQUIRED" },
        });
      if (recoveryOnly || flow.terminalOriginal)
        return route.fulfill({
          status: recoveryOnly ? 200 : 409,
          json: {
            code: "CHECKOUT_RECOVERY_REQUIRED",
            orderId,
            totals,
            guestAccessToken: "from-prepare",
          },
        });
      let paymentResult;
      if (combined) {
        flow.permits++;
        flow.permitBody = {
          orderId,
          deviceSessionId: prepare.deviceSessionId,
          method: prepare.paymentMethod,
          turnstileToken: posted.turnstileToken,
          guestAccessToken: "from-prepare",
        };
        if (flow.holdPermit) await new Promise((r) => (flow.releasePermit = r));
        if (pay === "terminal-review")
          paymentResult = { status: 409, body: { status: "UNKNOWN" } };
        else {
          flow.pays++;
          if (flow.holdPay) await new Promise((r) => (flow.releasePay = r));
          paymentResult =
            pay === "decline"
              ? { status: 402, body: { error: "Payment declined by provider" } }
              : pay === "pre-provider"
                ? {
                    status: 503,
                    body: {
                      code: "PAYMENT_NOT_SUBMITTED",
                      error: "Address verification is temporarily unavailable.",
                    },
                  }
                : { status: 202, body: { status: "UNKNOWN" } };
        }
      }
      return route.fulfill({
        json: {
          orderId,
          guestAccessToken: "from-prepare",
          totals,
          ...(paymentResult ? { paymentResult } : {}),
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
  const recover = page.getByRole("button", { name: "Check original order" });
  await expect
    .poll(
      async () =>
        (await recover.isVisible()) ||
        (await page.getByRole("button", { name: "Pay $20.00 now" }).isVisible()),
    )
    .toBe(true);
  if (await recover.isVisible()) {
    await recover.press("Enter");
    return;
  }
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

export {
  fixture,
  submit,
  state,
  origin,
  order,
  shoe,
  line,
  receipt,
  totals,
  address,
  browser,
};
