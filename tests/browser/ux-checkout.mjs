import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const item = {
  productId: "p",
  variantId: "v",
  name: "Runner",
  titleDisplay: "Runner",
  brand: "Brand",
  sizeLabel: "10",
  quantity: 1,
  priceCents: 200,
  imageUrl: "/shoe.jpg",
};
const buyer = { id: "buyer", email: "buyer@example.test" };
const totals = { subtotalCents: 200, shippingCents: 20, taxCents: 10, totalCents: 230 };
const order = {
  id: "order",
  status: "paid",
  fulfillment: "ship",
  subtotal: 2,
  shipping: 0.2,
  tax: 0.1,
  total: 2.3,
  customerId: "buyer",
  purchasedItems: [{ productId: "p", variantId: "v", quantity: 1 }],
  events: [],
  supportEmail: "support@example.test",
  updatedAt: "2026-11-25",
};
const bundle = await compileUxHarness(
  `
import {createRoot} from "react-dom/client";
import {useState} from "react";
import {CartProvider,useCart} from "./src/components/cart/CartProvider";
import {SessionProvider,useSession} from "./src/contexts/SessionContext";
import {CheckoutPaymentProvider} from "./src/components/checkout/CheckoutPaymentDialog";
import {CheckoutClient} from "./src/components/checkout/CheckoutClient";
import Processing from "./src/app/checkout/processing/page";
import Success from "./src/app/checkout/success/page";
import OrderStatus from "./src/app/(store)/order-status/[orderId]/page";
const cfg=new URLSearchParams(location.search), guest=cfg.has("guest"), user=guest?null:${JSON.stringify(buyer)};
const storage=guest?sessionStorage:localStorage, key=guest?"rdk_cart_session":"rdk_cart_user_buyer";
if(!storage.getItem(key)) storage.setItem(key,JSON.stringify([${JSON.stringify(item)}]));
function Outlet({seed=user}){
 const [path,route]=useState(location.pathname);
 window.navigate=url=>{history.pushState({},'',url);route(location.pathname)};
 window.cart=useCart();window.session=useSession();
 return path.includes("processing")?<Processing/>:path.includes("order-status")?<OrderStatus/>:path.includes("success")?<Success/>:<CheckoutClient initialData={{isGuest:guest,customer:{ownerId:seed?.id??null,email:seed?.email??"",address:{name:"Test Buyer",phone:"3025550100",line1:seed?.id==="second"?"2 Second St":"1 Test St",line2:"",city:"Wilmington",state:"DE",postalCode:"19801",country:"US"}}, paymentConfig:{applicationId:"test",locationId:"test",environment:"sandbox"}}}/>;
}
function Root(){const [seed,change]=useState(user);window.reseed=change;return <SessionProvider initialUser={seed} initialRole={guest?null:"customer"} initialUnavailable={cfg.has("unavailable")}><CartProvider userId={user?.id}><CheckoutPaymentProvider><Outlet seed={seed}/></CheckoutPaymentProvider></CartProvider></SessionProvider>};createRoot(document.getElementById("root")).render(<Root/>);
`,
  {
    plugins: [
      {
        name: "boundaries",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(next\/navigation|@\/config\/client-env|@\/lib\/measurement\/client)$/,
            },
            (args) => ({ path: args.path, namespace: "boundary" }),
          );
          b.onLoad({ filter: /.*/, namespace: "boundary" }, (args) => ({
            contents:
              args.path === "next/navigation"
                ? "const router={replace:u=>window.navigate(u),push:u=>window.navigate(u)};export const useRouter=()=>router,useParams=()=>({orderId:'order'}),useSearchParams=()=>new URLSearchParams(location.search);"
                : args.path.includes("client-env")
                  ? "export const clientEnv={NEXT_PUBLIC_TURNSTILE_SITE_KEY:location.search.includes('guestKey')?'fixture':undefined};"
                  : "export const captureCheckoutStarted=()=>{},captureProductAddedToCart=()=>{};",
          }));
        },
      },
    ],
  },
);

const sdk = `window.Square={payments:()=>({
  async card(){const m={async attach(selector){const host=document.querySelector(selector);if(window.hangAttach){window.hangAttach=false;window.retiredCard=m;m.attaching=true;await new Promise(r=>window.releaseAttach=r);m.attaching=false;m.resource=true;}host.textContent="Secure fields ready";m.host=host;},async destroy(){if(m.attaching)return false;m.resource=false;m.host?.replaceChildren();window.destroyed=(window.destroyed||0)+1;return true;},async tokenize(){window.tokenCalls=(window.tokenCalls||0)+1;if(window.holdToken)await new Promise(r=>window.releaseToken=r);return {status:"OK",token:"synthetic"}}};
    if(window.hangCreate){window.hangCreate=false;await new Promise(r=>window.releaseCreate=r)}
    return m;},
  paymentRequest(){return {update:()=>true,addEventListener(){}}},
  async applePay(){window.appleCount=(window.appleCount||0)+1;return {async tokenize(){return window.walletResult??{status:"CANCEL"}}}},
  async afterpayClearpay(){return {async attach(){}}},
  async cashAppPay(request,options){const entry={options};(window.cashMethods??=[]).push(entry);return {async attach(){},addEventListener(type,listener){entry.complete=listener},async destroy(){entry.destroyed=true;return true}}}
})};`;
const prepared = (reused) => ({ orderId: "order", totals, reused });
const gate = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.process = { env: {} };
  });
  const f = {
    ctx,
    quoteCalls: 0,
    prepareCalls: [],
    payCalls: 0,
    scriptCalls: 0,
    statusCalls: 0,
    session: { user: buyer, role: "customer" },
    errors: [],
  };
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url()),
      path = u.pathname;
    if (u.hostname === "sandbox.web.squarecdn.com") {
      f.scriptCalls++;
      if (f.scriptError) {
        f.scriptError = false;
        return route.abort();
      }
      if (f.scriptHold) await f.scriptHold.promise;
      return route.fulfill({
        contentType: "text/javascript",
        body: sdk + (f.sdkExtra ?? ""),
      });
    }
    if (u.hostname !== "ux.test") return route.abort();
    if (path === "/api/cart/validate")
      return route.fulfill({
        json: {
          items: route
            .request()
            .postDataJSON()
            .items.map((x) => ({ ...item, ...x })),
        },
      });
    if (path === "/api/auth/session") {
      if (f.sessionHold) await f.sessionHold.promise;
      return route.fulfill({ status: f.sessionStatus ?? 200, json: f.session });
    }
    if (path === "/api/checkout/quote") {
      f.quoteCalls++;
      if (f.quoteHold) await f.quoteHold.promise;
      return route.fulfill({
        status: f.quoteError ? 503 : 200,
        json: f.quoteError
          ? { error: "Totals unavailable" }
          : {
              completeness: "exact",
              quoteFingerprint: (f.fingerprint ?? "a").repeat(64),
              totals: f.invalidTotals ? { ...totals, taxCents: null } : totals,
            },
      });
    }
    if (path === "/api/checkout/prepare") {
      const n = f.prepareCalls.push(route.request().postDataJSON());
      if (n === 1 && f.prepareHold) await f.prepareHold.promise;
      return route.fulfill({
        status: f.suggestion ? 422 : (f.prepareStatus ?? 200),
        json: f.suggestion
          ? {
              code: "SHIPPING_ADDRESS_SUGGESTION",
              error: "Review address",
              suggestedAddress: {
                ...f.prepareCalls[n - 1].shippingAddress,
                line1: "Private Suggested Street",
              },
              shippingConfirmation: "fixture",
            }
          : f.omitReused
            ? { orderId: "order", totals }
            : prepared(n > 1),
      });
    }
    if (path === "/api/checkout/payment-permit")
      return route.fulfill({ json: { permit: "fixture" } });
    if (path === "/api/checkout/pay") {
      f.payCalls++;
      return route.fulfill({ json: { statusUrl: "/checkout/success?orderId=order" } });
    }
    if (path === "/api/orders/order") {
      (f.statusQueries ??= []).push(u.search);
      f.statusCalls++;
      const ownerTag = f.statusOwner ?? "buyer";
      // A signed-in buyer can authorize the first read even with an invalid URL token.
      const responseStatus =
        f.sessionStatus === 503 && f.outageToken
          ? u.searchParams.get("token") === f.outageToken
            ? 200
            : 403
          : (f.orderStatus ?? 200);
      if (f.orderHold) await f.orderHold.promise;
      await route.fulfill({
        status: responseStatus,
        json: {
          ...order,
          supportEmail: ownerTag + "@example.test",
          status: f.firstPending && f.statusCalls === 1 ? "pending" : "paid",
        },
      });
      (f.finishedStatus ??= []).push(ownerTag);
      return;
    }
    return route.fulfill({ status: 404, body: "" });
  });
  f.open = async (path = "/checkout", init) => {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => f.errors.push(e.message));
    if (init) await page.addInitScript(init);
    await openUxHarness(page, bundle, "https://ux.test" + path);
    return page;
  };
  return f;
}
async function pay(page) {
  await page.getByRole("textbox", { name: "Name on card" }).fill("Buyer");
  await page.getByRole("button", { name: "Pay $2.30 now", exact: true }).click();
}
async function controlledPost(f, stage, mode) {
  const p = await f.ctx.newPage();
  p.on("pageerror", (e) => f.errors.push(e.message));
  await p.clock.install();
  await p.addInitScript(
    ({ stage, mode }) => {
      localStorage.removeItem("rdk_cart_user_buyer");
      const real = window.fetch;
      window.fetch = async (url, options) => {
        if (url !== "/api/checkout/" + stage) return real(url, options);
        window.postCount = (window.postCount || 0) + 1;
        if (window.postCount > 1) return real(url, options);
        if (mode === "drop") throw new TypeError("Failed to fetch");
        if (mode === "decline")
          return Response.json({ error: "Payment was declined." }, { status: 402 });
        if (mode === "unreadable") return new Response("<html>");
        const held = new Promise((r) => (window.releasePost = r));
        const body =
          stage === "payment-permit"
            ? { permit: "fixture" }
            : stage === "prepare"
              ? {
                  orderId: "order",
                  reused: false,
                  totals: {
                    subtotalCents: 200,
                    shippingCents: 20,
                    taxCents: 10,
                    totalCents: 230,
                  },
                }
              : { statusUrl: "/checkout/success?orderId=order" };
        if (mode === "headers") {
          await held;
          return Response.json(body);
        }
        return {
          ok: true,
          status: 200,
          json: async () => {
            await held;
            return body;
          },
        };
      };
    },
    { stage, mode },
  );
  await openUxHarness(p, bundle, "https://ux.test/checkout");
  await pay(p);
  await p.waitForFunction(() => window.postCount === 1);
  return p;
}
function installHeldWallet(name, phase) {
  const original = window.Square.payments;
  window.Square.payments = () => {
    const payments = original();
    window.walletInstances = [];
    payments[name] = async () => {
      const entry = { live: false };
      const first = window.walletInstances.push(entry) === 1;
      const wait = () =>
        new Promise((resolve) => {
          window.releaseWallet = resolve;
        });
      if (first && phase === "create") await wait();
      return {
        async attach(selector) {
          entry.host = document.querySelector(selector);
          if (first && phase === "attach") await wait();
          entry.live = true;
          entry.host.textContent = "Wallet " + window.walletInstances.indexOf(entry);
        },
        async destroy() {
          entry.destroyed = true;
          entry.live = false;
          entry.host?.replaceChildren();
          return true;
        },
        addEventListener() {},
        async tokenize() {
          return { status: "CANCEL" };
        },
      };
    };
    return payments;
  };
}
const cases = {
  async lostPayment(f) {
    for (const mode of ["drop", "headers", "body", "unreadable"]) {
      f.orderHold = gate();
      const p = await controlledPost(f, "pay", mode);
      await p.clock.fastForward(16000);
      await expect(p).toHaveURL(/checkout\/processing\?orderId=order/);
      await expect.poll(() => f.statusQueries?.length ?? 0).toBeGreaterThan(0);
      const key = await p.evaluate(() =>
        sessionStorage.getItem("checkout_idempotency_key"),
      );
      assert.ok(key);
      await p.clock.fastForward(61000);
      await expect(p.getByText(/Do not pay again/)).toBeVisible();
      await p.evaluate(() => window.releasePost?.());
      if (mode === "body")
        await p.evaluate(() =>
          sessionStorage.setItem("checkout_idempotency_key", "new-attempt"),
        );
      await p.getByRole("button", { name: "Check order status" }).click();
      f.orderHold.resolve();
      await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
      assert.equal(
        await p.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")),
        mode === "body" ? "new-attempt" : null,
      );
      assert.equal(await p.evaluate(() => window.postCount), 1);
      await p.close();
    }
  },
  async decline(f) {
    const p = await controlledPost(f, "pay", "decline");
    await expect(p.getByRole("dialog").getByText("Payment was declined.")).toBeVisible();
    assert.equal(f.statusCalls, 0);
  },
  async earlyDeadline(f) {
    for (const stage of ["prepare", "payment-permit"])
      for (const mode of ["headers", "body"]) {
        const p = await controlledPost(f, stage, mode);
        const key = await p.evaluate(() =>
          sessionStorage.getItem("checkout_idempotency_key"),
        );
        await p.clock.fastForward(16000);
        await expect(p.getByRole("dialog").getByRole("alert")).toContainText(
          /try again/i,
        );
        await p.evaluate(() => window.releasePost());
        assert.equal(await p.evaluate(() => window.tokenCalls || 0), 0);
        assert.equal(f.payCalls, 0);
        assert.equal(
          await p.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")),
          key,
        );
        await p.getByRole("dialog").getByRole("button").last().click();
        await expect(p.getByLabel("Name on card")).toHaveValue("Buyer");
        await p.close();
      }
  },
  async walletStartup(f) {
    for (const [name, phase, label] of [
      ["applePay", "create", "Apple Pay"],
      ["afterpayClearpay", "attach", "Afterpay"],
      ["cashAppPay", "attach", "Cash App Pay"],
    ]) {
      f.sdkExtra =
        "(" +
        installHeldWallet.toString() +
        ")(" +
        JSON.stringify(name) +
        "," +
        JSON.stringify(phase) +
        ");";
      const p = await f.ctx.newPage();
      await p.clock.install();
      await openUxHarness(p, bundle, "https://ux.test/checkout");
      if (name !== "applePay") await p.getByRole("radio", { name: label }).click();
      await p.waitForFunction(() => Boolean(window.releaseWallet));
      await p.clock.fastForward(16000);
      const retry = p.getByRole("button", {
        name: name === "applePay" ? "Retry Apple Pay" : "Retry",
        exact: true,
      });
      await expect(retry).toBeVisible();
      await retry.click();
      await p.waitForFunction(() => window.walletInstances.length === 2);
      await p.evaluate(() => window.releaseWallet());
      await p.waitForFunction(
        () => window.walletInstances[0].destroyed && !window.walletInstances[0].live,
      );
      if (name === "applePay")
        await expect(p.getByRole("button", { name: "Pay with Apple Pay" })).toBeEnabled();
      else
        assert.equal(
          await p.evaluate(() => window.walletInstances[1].host.textContent),
          "Wallet 1",
        );
      assert.equal(f.payCalls, 0);
      await p.close();
    }
  },
  async guestVerification(f) {
    f.session = { user: null, role: null };
    for (const failure of ["script", "stalledScript", "widget"]) {
      let scripts = 0;
      const held = gate();
      const p = await f.ctx.newPage();
      await p.clock.install();
      await p.route("https://challenges.cloudflare.com/**", async (r) => {
        scripts++;
        if (scripts === 1 && failure === "script") return r.abort();
        if (scripts === 1 && failure === "stalledScript") {
          await held.promise;
          return r.abort().catch(() => {});
        }
        return r.fulfill({
          contentType: "text/javascript",
          body: "window.widgets=[];window.turnstile={render(el,options){const id=String(window.widgets.length);const node=document.createElement('div');node.dataset.testWidget=id;el.appendChild(node);window.widgets.push({id,options,node});return id;},remove(id){window.widgets[Number(id)].node.remove()},reset(){}};",
        });
      });
      try {
        await openUxHarness(p, bundle, "https://ux.test/checkout?guest&guestKey");
        await expect.poll(() => scripts).toBe(1);
        await p.getByLabel("Email", { exact: true }).fill("guest@example.test");
        await p.getByLabel("Name on card").fill("Saved guest draft");
        if (failure === "widget")
          await p.waitForFunction(() => window.widgets?.length === 1);
        await p.clock.fastForward(16000);
        const retry = p.getByRole("button", { name: "Retry security check" });
        await expect(retry).toBeVisible();
        await expect(p.getByRole("button", { name: /Pay .*now/ })).toBeDisabled();
        await retry.click();
        await expect(
          p.locator("[data-test-widget]"),
          failure + " retry with " + scripts + " script requests",
        ).toHaveCount(1);
        await p.evaluate(() => {
          window.widgets.at(-1).options["before-interactive-callback"]();
        });
        await p.clock.fastForward(30000);
        await expect(retry).toHaveCount(0);
        if (failure === "widget")
          await p.evaluate(() => window.widgets[0].options.callback("retired"));
        await expect(p.getByRole("button", { name: /Pay .*now/ })).toBeDisabled();
        await p.evaluate(() => window.widgets.at(-1).options.callback("verified"));
        await expect(p.getByRole("button", { name: /Pay .*now/ })).toBeEnabled();
        await expect(p.getByLabel("Name on card")).toHaveValue("Saved guest draft");
        assert.equal(f.prepareCalls.length, 0);
      } finally {
        held.resolve();
        await p.close();
      }
    }
  },
  async sdk(f) {
    f.scriptError = true;
    const p = await f.open();
    await p.getByRole("textbox", { name: "Name on card" }).fill("Buyer Draft");
    await p.getByRole("button", { name: "Retry card fields" }).click();
    await expect(p.getByText("Secure fields ready")).toBeVisible();
    assert.equal(f.scriptCalls, 2);
    assert.equal(f.prepareCalls.length, 0);
    await expect(p.getByLabel("Name on card")).toHaveValue("Buyer Draft");
  },
  async malformed(f) {
    f.invalidTotals = true;
    const p = await f.open();
    await expect(p.getByRole("button", { name: "Retry totals" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Pay now", exact: true })).toBeDisabled();
    f.invalidTotals = false;
    await p.getByRole("button", { name: "Retry totals" }).click();
    await expect(p.getByRole("button", { name: "Pay $2.30 now" })).toBeEnabled();
    assert.equal(f.prepareCalls.length, 0);
  },
  async hung(f) {
    for (const phase of ["Create", "Attach"]) {
      const p = await f.ctx.newPage();
      await p.clock.install();
      await p.addInitScript((phase) => {
        window["hang" + phase] = true;
      }, phase);
      await openUxHarness(p, bundle, "https://ux.test/checkout");
      await p.waitForFunction(
        (phase) => Boolean(window["release" + phase]) && window.appleCount === 1,
        phase,
      );
      await p.clock.fastForward(16000);
      await p.getByRole("button", { name: "Retry card fields" }).click();
      await expect(p.getByText("Secure fields ready")).toBeVisible();
      await p.evaluate((phase) => window["release" + phase](), phase);
      if (phase === "Attach") {
        await expect
          .poll(() => p.evaluate(() => window.retiredCard.resource))
          .toBe(false);
      } else await p.waitForFunction(() => window.destroyed >= 1);
      await expect(p.getByText("Secure fields ready")).toBeVisible();
      assert.equal(await p.evaluate(() => window.appleCount), 1);
      await p.close();
    }
  },
  async totals(f) {
    f.quoteHold = gate();
    const p = await f.open();
    await expect(p.getByText("Updating totals", { exact: false })).toBeVisible();
    await expect(p.getByRole("complementary").locator("dd").last()).not.toHaveText(
      "$2.00",
    );
    await p.getByLabel("Name on card").fill("Draft");
    f.quoteHold.resolve();
    await expect(p.getByText("$2.30", { exact: true })).toBeVisible();
    f.quoteError = true;
    await p.getByText("Pickup", { exact: true }).click();
    await expect(p.getByRole("button", { name: "Retry totals" })).toBeVisible();
    await expect(p.getByRole("complementary").locator("dd").last()).not.toHaveText(
      "$2.30",
    );
    f.quoteError = false;
    await p.getByRole("button", { name: "Retry totals" }).click();
    await expect(p.getByText("$2.30", { exact: true })).toBeVisible();
    await p.getByText("Ship", { exact: true }).click();
    await expect(p.getByLabel("Name on card")).toHaveValue("Draft");
  },
  async identity(f) {
    const p = await f.open();
    await p.getByLabel("Name on card").fill("Draft");
    await expect(p.getByText("$2.30", { exact: true })).toBeVisible();
    f.sessionHold = gate();
    await p.evaluate(() => void window.session.refreshSession());
    await expect(p.getByText("Runner", { exact: true })).toBeVisible();
    await expect(p.getByLabel("Name on card")).toHaveValue("Draft");
    f.sessionStatus = 503;
    f.sessionHold.resolve();
    await expect(p.getByRole("button", { name: "Retry checkout" })).toBeVisible();
    const n = f.quoteCalls;
    f.sessionStatus = 200;
    f.session = {
      user: { id: "changed", email: "other@test.invalid" },
      role: "customer",
    };
    await p.getByRole("button", { name: "Retry checkout" }).click();
    await expect(p.getByLabel("Name on card")).toHaveCount(0);
    await expect(p.getByText("buyer@example.test", { exact: true })).toHaveCount(0);
    assert.equal(f.quoteCalls, n);
    const guest = await f.open("/checkout?guest&unavailable");
    await expect(guest.getByRole("button", { name: "Retry checkout" })).toBeVisible();
    await expect(guest.getByLabel("Email")).toHaveCount(0);
  },
  async reseed(f) {
    const p = await f.open();
    await p.getByLabel("Name on card").fill("Original name");
    await p.getByLabel("Address", { exact: true }).fill("Private draft");
    await p.evaluate((item) => {
      localStorage.setItem("rdk_cart_user_second", JSON.stringify([item]));
      window.reseed({ id: "second", email: "second@example.test" });
    }, item);
    await expect(p.getByLabel("Address", { exact: true })).toHaveValue("2 Second St");
    await expect(p.getByLabel("Name on card")).toHaveValue("");
  },
  async challenge(f) {
    const p = await f.open();
    await p.evaluate(() => {
      window.holdToken = true;
    });
    await pay(p);
    await p.waitForFunction(() => Boolean(window.releaseToken));
    await p.evaluate((item) => {
      window.spinner = document.querySelector("dialog .animate-spin");
      localStorage.setItem("rdk_cart_user_second", JSON.stringify([item]));
      window.reseed({ id: "second", email: "second@example.test" });
    }, item);
    await expect(p.getByRole("dialog")).toBeVisible();
    await expect(p.getByLabel("Address", { exact: true })).toBeHidden();
    assert.equal(
      await p.evaluate(
        () =>
          document.querySelector("dialog .animate-spin") === window.spinner &&
          !document.querySelector("dialog").matches(":modal"),
      ),
      true,
    );
    await p.evaluate(() => window.releaseToken());
    await expect.poll(() => f.payCalls).toBe(1);
  },
  async stale(f) {
    const p = await f.open();
    await p.getByLabel("Name on card").fill("Buyer");
    await expect(p.getByRole("button", { name: "Pay $2.30 now" })).toBeEnabled();
    f.sessionHold = gate();
    await p.evaluate(() => {
      void window.session.refreshSession();
      document.querySelector("form").requestSubmit();
    });
    await expect(
      p.getByRole("dialog").getByRole("link", { name: "Review your cart" }),
    ).toBeVisible();
    assert.equal(f.prepareCalls.length, 0);
    f.sessionHold.resolve();
  },
  async omitted(f) {
    f.omitReused = true;
    const p = await f.open();
    await pay(p);
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(await p.evaluate(() => window.cart.itemCount), 1);
    assert.equal(f.payCalls, 1);
  },
  async bindFailure(f) {
    const p = await f.open();
    await p.waitForFunction(
      () => window.cart?.isReady && window.cart.validationStatus === "idle",
    );
    await p.evaluate(() => {
      navigator.locks.request = () => Promise.reject(Error("Fixture lock unavailable"));
    });
    await pay(p);
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(await p.evaluate(() => window.cart.itemCount), 1);
    assert.equal(f.payCalls, 1);
    assert.equal(f.prepareCalls.length, 1);
  },
  async duplicate(f) {
    f.prepareHold = gate();
    const a = await f.open();
    await pay(a);
    await expect.poll(() => f.prepareCalls.length).toBe(1);
    await expect(a.getByRole("heading", { name: "Preparing your order" })).toBeVisible();
    await a.evaluate(() => document.querySelector("form").requestSubmit());
    assert.equal(f.prepareCalls.length, 1);
    const cloned = await a.evaluate(() => ({ ...sessionStorage }));
    const b = await f.ctx.newPage();
    await b.addInitScript((values) => {
      for (const [k, v] of Object.entries(values)) sessionStorage.setItem(k, v);
    }, cloned);
    await openUxHarness(b, bundle, "https://ux.test/checkout");
    await b.waitForFunction(
      () => window.cart?.isReady && window.cart.validationStatus === "idle",
    );
    assert.equal(await b.evaluate(() => window.cart.clearCart()), true);
    assert.equal(await b.evaluate((x) => window.cart.addItem(x), item), true);
    await pay(b);
    await expect(b.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(f.prepareCalls[0].idempotencyKey, f.prepareCalls[1].idempotencyKey);
    assert.equal(
      await b.evaluate(() => window.cart.itemCount),
      1,
      "reused response before original cannot purchase replacement",
    );
    f.prepareHold.resolve();
    await expect(a.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(
      await a.evaluate(() => window.cart.itemCount),
      1,
      "original binding covers only original units",
    );
    assert.equal(f.payCalls, 2);
  },
  async fresh(f) {
    f.orderHold = gate();
    const p = await f.open();
    await pay(p);
    await expect.poll(() => f.statusCalls).toBe(1);
    assert.equal(await p.evaluate(() => window.cart.itemCount), 1);
    f.orderHold.resolve();
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    await p.waitForFunction(() => window.cart.itemCount === 0);
    assert.equal(f.payCalls, 1);
  },
  async conflict(f) {
    f.prepareHold = gate();
    f.prepareStatus = 409;
    const p = await f.open();
    await pay(p);
    await expect.poll(() => f.prepareCalls.length).toBe(1);
    await p.evaluate(() => {
      sessionStorage.setItem("checkout_idempotency_key", "newer");
      sessionStorage.setItem("checkout_cart_fingerprint", "newer");
    });
    f.prepareHold.resolve();
    await expect(p.getByRole("alert").first()).toBeVisible();
    assert.equal(
      await p.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")),
      "newer",
    );
    assert.equal(f.payCalls, 0);
  },
  async deadline(f) {
    f.orderHold = gate();
    const p = await f.ctx.newPage();
    await p.clock.install();
    await openUxHarness(
      p,
      bundle,
      "https://ux.test/checkout/success?orderId=order&token=fixture",
    );
    await expect.poll(() => f.statusCalls).toBe(1);
    await p.clock.fastForward(61000);
    await expect(p.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toHaveCount(0);
    f.orderHold.resolve();
    await p.getByRole("button", { name: "Check again" }).click();
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(f.statusCalls, 2);
  },
  async receiptRead(f) {
    f.firstPending = true;
    const p = await f.open("/checkout/success?orderId=order&token=fixture");
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(f.statusCalls, 2);
    assert.equal(
      f.statusQueries.some((q) => q.includes("reconcile")),
      false,
      "receipt read preserves historical read-only verification",
    );
  },
  async privateOpen(f) {
    f.suggestion = true;
    const p = await f.open();
    await pay(p);
    await expect(p.getByText("Private Suggested Street")).toBeVisible();
    f.session = {
      user: { id: "second", email: "second@example.test" },
      role: "customer",
    };
    await p.evaluate(() => window.session.refreshSession());
    await expect(p.getByText("Private Suggested Street")).toHaveCount(0);
    await expect(p.getByRole("link", { name: "Reload checkout" })).toBeVisible();
    assert.equal(f.prepareCalls.length, 1);
    assert.equal(f.payCalls, 0);
  },
  async privateWallet(f) {
    const p = await f.open();
    await p.evaluate(() => {
      window.walletResult = {
        status: "OK",
        token: "synthetic",
        details: {
          billing: { givenName: "Private Wallet Name" },
          shipping: {
            contact: {
              givenName: "Wallet",
              familyName: "Buyer",
              addressLines: ["1 Test St"],
              city: "Wilmington",
              state: "DE",
              postalCode: "19801",
              countryCode: "US",
            },
          },
        },
      };
    });
    await p.getByRole("button", { name: "Pay with Apple Pay" }).click();
    await expect(
      p.getByRole("heading", { name: "Complete your checkout details" }),
    ).toBeVisible();
    await expect(
      p.getByRole("dialog").locator('input[value="Private Wallet Name"]'),
    ).toBeVisible();
    f.session = { user: null, role: null };
    await p.evaluate(() => window.session.refreshSession());
    await expect(p.getByRole("link", { name: "Reload checkout" })).toBeVisible();
    await expect(p.locator('input[value="Private Wallet Name"]')).toHaveCount(0);
    assert.equal(f.prepareCalls.length, 0);
  },
  async privateLate(f) {
    f.suggestion = true;
    f.prepareHold = gate();
    const p = await f.open();
    await pay(p);
    await expect.poll(() => f.prepareCalls.length).toBe(1);
    f.session = { user: null, role: null };
    await p.evaluate(() => window.session.refreshSession());
    f.prepareHold.resolve();
    await expect(p.getByRole("link", { name: "Reload checkout" })).toBeVisible();
    await expect(p.getByText("Private Suggested Street")).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Accept suggested address" })).toHaveCount(
      0,
    );
    assert.equal(f.prepareCalls.length, 1);
    assert.equal(f.payCalls, 0);
  },
  async cashChange(f) {
    const p = await f.open();
    await p.getByRole("radio", { name: "Cash App Pay" }).click();
    await p.waitForFunction(() => window.cashMethods?.[0]?.complete);
    assert.equal(
      await p.evaluate(() => window.cashMethods[0].options.shouldTokenize()),
      true,
    );
    await expect(p.getByRole("heading", { name: "Loading Cash App Pay…" })).toBeVisible();
    f.fingerprint = "b";
    const hadQuotes = f.quoteCalls;
    assert.equal(await p.evaluate((item) => window.cart.addItem(item), item), true);
    await expect.poll(() => f.quoteCalls).toBeGreaterThan(hadQuotes);
    await p.waitForFunction(
      () =>
        !document.querySelector("aside dl")?.getAttribute("aria-busy")?.includes("true"),
    );
    assert.equal(await p.evaluate(() => Boolean(window.cashMethods[0].destroyed)), false);
    assert.equal(
      await p.evaluate(() => document.querySelector("dialog").matches(":modal")),
      false,
    );
    await p.evaluate(() =>
      window.cashMethods[0].complete({
        detail: { tokenResult: { status: "OK", token: "expired-approval" } },
      }),
    );
    await expect(p.getByRole("button", { name: "Return to checkout" })).toBeVisible();
    await p.getByRole("button", { name: "Return to checkout" }).click();
    assert.equal(f.prepareCalls.length, 0);
    await p.waitForFunction(
      () => window.cashMethods.length >= 2 && window.cashMethods.at(-1).complete,
    );
    assert.equal(
      await p.evaluate(() => window.cashMethods.at(-1).options.shouldTokenize()),
      true,
    );
    await p.evaluate(() =>
      window.cashMethods
        .at(-1)
        .complete({ detail: { tokenResult: { status: "CANCEL" } } }),
    );
    await expect(p.getByRole("dialog")).toHaveCount(0);
    assert.equal(f.payCalls, 0);
  },
  async orderOwner(f) {
    const p = await f.open("/order-status/order?token=fixture");
    await expect(p.getByText("buyer@example.test")).toBeVisible();
    f.sessionHold = gate();
    await p.evaluate(() => void window.session.refreshSession());
    await expect(p.getByText("buyer@example.test")).toHaveCount(0);
    await expect(p.locator("[aria-busy=true] [data-ui-skeleton]").first()).toBeVisible();
    f.sessionStatus = 503;
    f.outageToken = "fixture";
    f.statusOwner = "secure-token";
    f.sessionHold.resolve();
    await expect(p.getByText("secure-token@example.test")).toBeVisible();
    await expect(p.getByText("buyer@example.test")).toHaveCount(0);
    assert.equal(await p.evaluate(() => window.session.isSessionUnavailable), true);
    assert.equal(f.statusCalls, 2);
    assert.deepEqual(f.statusQueries, ["?token=fixture", "?token=fixture"]);
  },
  async orderOutageDenied(f) {
    f.orderHold = gate();
    const old = f.orderHold;
    const p = await f.open("/order-status/order?token=invalid");
    await expect.poll(() => f.statusCalls).toBe(1);
    try {
      f.orderHold = null;
      f.sessionStatus = 503;
      f.outageToken = "fixture";
      f.statusOwner = "denied";
      await p.evaluate(() => window.session.refreshSession());
      await expect(
        p.getByText("Open the secure order link from your email."),
      ).toBeVisible();
      old.resolve();
      await expect.poll(() => f.finishedStatus).toContain("buyer");
      await expect(
        p.getByText("Open the secure order link from your email."),
      ).toBeVisible();
      await expect(
        p.getByRole("heading", { name: "Order status", exact: true }),
      ).toHaveCount(0);
      await expect(p.getByText("buyer@example.test")).toHaveCount(0);
      await expect(p.getByText("denied@example.test")).toHaveCount(0);
      assert.equal(await p.evaluate(() => window.session.isSessionUnavailable), true);
      assert.deepEqual(f.statusQueries, ["?token=invalid", "?token=invalid"]);
    } finally {
      old.resolve();
    }
  },
  async orderOutageGuest(f) {
    f.sessionStatus = 503;
    f.outageToken = "fixture";
    f.statusOwner = "outage";
    const p = await f.open("/order-status/order?guest&unavailable&token=fixture");
    await expect(p.getByText("outage@example.test")).toBeVisible();
    assert.equal(await p.evaluate(() => window.session.isSessionUnavailable), true);
    f.statusOwner = "confirmed-guest";
    f.sessionStatus = 200;
    f.session = { user: null, role: null };
    await p.evaluate(() => window.session.refreshSession());
    await expect(p.getByText("confirmed-guest@example.test")).toBeVisible();
    await expect(p.getByText("outage@example.test")).toHaveCount(0);
    assert.equal(f.statusCalls, 2);
  },
  async orderOwnerLate(f) {
    f.orderHold = gate();
    const old = f.orderHold;
    const p = await f.open("/order-status/order?token=fixture");
    await expect.poll(() => f.statusCalls).toBe(1);
    f.orderHold = gate();
    f.statusOwner = "second";
    f.session = {
      user: { id: "second", email: "second@example.test" },
      role: "customer",
    };
    await p.evaluate(() => window.session.refreshSession());
    await expect.poll(() => f.statusCalls).toBe(2);
    old.resolve();
    await expect.poll(() => f.finishedStatus).toContain("buyer");
    await expect(p.getByText("buyer@example.test")).toHaveCount(0);
    await expect(p.locator("[aria-busy=true] [data-ui-skeleton]").first()).toBeVisible();
    f.orderHold.resolve();
    await expect(p.getByText("second@example.test")).toBeVisible();
    await expect(p.getByText("buyer@example.test")).toHaveCount(0);
    assert.equal(f.statusCalls, 2);
  },
  async orderStatus(f) {
    f.orderStatus = 503;
    const p = await f.open("/order-status/order?token=fixture");
    await expect(p.getByRole("button", { name: "Retry" })).toBeVisible();
    f.orderStatus = 200;
    f.orderHold = gate();
    await p.getByRole("button", { name: "Retry" }).click();
    await expect(p.locator("[aria-busy=true] [data-ui-skeleton]").first()).toBeVisible();
    f.orderHold.resolve();
    await expect(
      p.getByRole("heading", { name: "Order status", exact: true }),
    ).toBeVisible();
  },
};
const browser = await chromium.launch();
const failures = [];
try {
  for (const [name, test] of Object.entries(cases)) {
    if (process.argv[2] && !process.argv.slice(2).includes(name)) continue;
    const f = await fixture(browser);
    f.ctx.setDefaultTimeout(4500);
    try {
      await test(f);
      assert.deepEqual(f.errors, []);
      console.log("PASS", name);
    } catch (e) {
      failures.push(name);
      console.error("FAIL", name, e.message, f.errors);
    } finally {
      for (const hold of [
        "quoteHold",
        "prepareHold",
        "sessionHold",
        "orderHold",
        "scriptHold",
      ])
        f[hold]?.resolve();
      await f.ctx.close();
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, []);
