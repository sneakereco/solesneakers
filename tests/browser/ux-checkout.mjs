import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const item = {
  productId: "71111111-1111-4111-8111-111111111112",
  variantId: "71111111-1111-4111-8111-111111111113",
  name: "Runner",
  titleDisplay: "Runner",
  brand: "Brand",
  sizeLabel: "10",
  quantity: 1,
  maxStock: 7,
  priceCents: 200,
  imageUrl: "/shoe.jpg",
};
const buyer = { id: "buyer", email: "buyer@example.test" };
const totals = { subtotalCents: 200, shippingCents: 20, taxCents: 10, totalCents: 230 };
const order = {
  id: "71111111-1111-4111-8111-111111111111",
  status: "paid",
  fulfillment: "ship",
  subtotal: 2,
  shipping: 0.2,
  tax: 0.1,
  total: 2.3,
  customerId: "buyer",
  financial: { source: "legacy" },
  financialReview: false,
  purchasedLines: [{ productId: item.productId, variantId: item.variantId, quantity: 1 }],
  purchasedItems: [
    {
      productId: "71111111-1111-4111-8111-111111111112",
      variantId: "71111111-1111-4111-8111-111111111113",
      quantity: 1,
    },
  ],
  events: [],
  supportEmail: "support@example.test",
  updatedAt: "2026-11-25T00:00:00Z",
};
const bundle = await compileUxHarness(
  `
import {createRoot} from "react-dom/client";
import {useState} from "react";
import {CartProvider,useCart} from "./src/components/cart/CartProvider";
import {SessionProvider,useSession} from "./src/contexts/SessionContext";
import {CheckoutLayoutProviders} from "./src/app/checkout/CheckoutLayoutProviders";
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
 return path.includes("processing")?<Processing/>:path.includes("order-status")?<OrderStatus/>:path.includes("success")?<Success/>:<CheckoutClient initialData={{ownerId:seed?.id??null,isGuest:!seed,customer:{email:seed?.email??"",address:{name:"Test Buyer",phone:"3025550100",line1:seed?.id==="second"?"2 Second St":"1 Test St",line2:"",city:"Wilmington",state:"DE",postalCode:"19801",country:"US"}}, paymentConfig:{applicationId:"test",locationId:"test",environment:"sandbox"}}}/>;
}
function Root(){const [seed,change]=useState(user);window.reseed=change;return <SessionProvider initialUser={seed} initialRole={seed?"customer":null} serverReadId={cfg.has("unavailable")?undefined:seed?.id??"guest"} initialUnavailable={cfg.has("unavailable")}><CartProvider userId={user?.id}><CheckoutLayoutProviders><Outlet seed={seed}/></CheckoutLayoutProviders></CartProvider></SessionProvider>};createRoot(document.getElementById("root")).render(<Root/>);
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
                ? "const router={refresh:()=>{},replace:u=>window.navigate(u),push:u=>window.navigate(u)};export const usePathname=()=>location.pathname,useRouter=()=>router,useParams=()=>({orderId:'71111111-1111-4111-8111-111111111111'}),useSearchParams=()=>new URLSearchParams(location.search);"
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
  paymentRequest(options){return {total:options.total,update(patch){this.total=patch.total??this.total;return true},addEventListener(){}}},
  async applePay(request){window.appleCount=(window.appleCount||0)+1;return {async tokenize(){(window.appleTokenAmounts??=[]).push(request.total.amount);if(window.holdApple)await new Promise(resolve=>window.releaseApple=resolve);return window.walletResult??{status:"CANCEL"}}}},
  async afterpayClearpay(){return {async attach(){},async tokenize(){return window.afterpayResult??{status:"CANCEL"}}}},
  async cashAppPay(request,options){const entry={options};(window.cashMethods??=[]).push(entry);return {async attach(){},addEventListener(type,listener){entry.complete=listener},async destroy(){entry.destroyed=true;return true}}}
})};`;
const prepared = (reused) => ({
  orderId: "71111111-1111-4111-8111-111111111111",
  totals,
  reused,
});
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
    permitCalls: 0,
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
    if (path === "/api/cart/validate") {
      const input = route.request().postDataJSON();
      if (f.lastUnit?.reservation) {
        const last = f.lastUnit;
        const owns =
          input.order?.orderId === order.id &&
          input.order?.guestAccessToken === last.guestAccessToken;
        const available = owns && last.phase !== "paid";
        last.validations.push({ phase: last.phase, owns });
        return route.fulfill({
          json: {
            contractVersion: 2,
            items: [],
            removed: input.items.map(({ productId, variantId }) => ({
              productId,
              variantId,
              reason: "out_of_stock",
            })),
            lineState: input.items.map((row) => ({
              productId: row.productId,
              variantId: row.variantId,
              requestedQuantity: row.quantity,
              availableQuantity: available ? 1 : 0,
              availability: available ? "available" : "unavailable",
              reason: available ? "available" : "unavailable",
              facts: last.changedPrice
                ? { ...item, priceCents: item.priceCents + 1 }
                : item,
              ...(owns ? { orderScoped: true } : {}),
            })),
          },
        });
      }
      return route.fulfill({
        json: {
          removed: [],
          items: input.items.map((x) => ({ ...item, ...x })),
        },
      });
    }
    if (path === "/api/auth/session") {
      if (f.sessionHold) await f.sessionHold.promise;
      return route.fulfill({ status: f.sessionStatus ?? 200, json: f.session });
    }
    if (path === "/api/checkout/quote") {
      f.quoteCalls++;
      if (f.quoteHold) await f.quoteHold.promise;
      const unavailable = f.quoteError || f.lastUnit?.reservation;
      return route.fulfill({
        status: unavailable ? 503 : 200,
        json: unavailable
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
      if (f.lastUnit) {
        const last = f.lastUnit;
        const input = f.prepareCalls[n - 1];
        if (input.recoveryOnly) {
          const original = last.reservation;
          const requested = { ...input };
          const saved = { ...original };
          delete requested.recoveryOnly;
          delete saved.shippingAddressOverride;
          delete saved.shippingConfirmation;
          if (!isDeepStrictEqual(requested, saved))
            return route.fulfill({
              status: 409,
              json: { code: "CHECKOUT_RECOVERY_REQUIRED" },
            });
          if (f.retryLookupHold) await f.retryLookupHold.promise;
          const reply = route.fulfill({
            json: {
              ...prepared(true),
              code: "CHECKOUT_RECOVERY_REQUIRED",
              expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
              guestAccessToken: last.guestAccessToken,
              ...(last.phase === "declined"
                ? {
                    originalRetry: {
                      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                      lines: [
                        {
                          productId: item.productId,
                          variantId: item.variantId,
                          quantity: 1,
                          unitPriceCents: item.priceCents,
                        },
                      ],
                    },
                  }
                : {}),
            },
          });
          if (!f.retryLookupHold) return reply;
          await reply.catch(() => {});
          last.lookupSettled = true;
          return;
        }
        if (last.suggestion && !input.shippingConfirmation)
          return route.fulfill({
            status: 422,
            json: {
              code: "SHIPPING_ADDRESS_SUGGESTION",
              error: "Review address",
              suggestedAddress: { ...input.shippingAddress, line1: last.suggestion },
              shippingConfirmation: "fixture",
            },
          });
        if (last.reservation)
          return route.fulfill({ status: 409, json: { error: "Last unit is held" } });
        last.reservation = f.prepareCalls[n - 1];
        return route.fulfill({
          json: { ...prepared(false), guestAccessToken: last.guestAccessToken },
        });
      }
      if (n === 1 && f.prepareHold) await f.prepareHold.promise;
      if (f.missingOriginal && f.prepareCalls[n - 1].recoveryOnly)
        return route.fulfill({
          status: 409,
          json: { code: "CHECKOUT_RECOVERY_REQUIRED" },
        });
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
          : f.prepareCalls[n - 1].recoveryOnly
            ? { ...prepared(true), code: "CHECKOUT_RECOVERY_REQUIRED" }
            : f.omitReused
              ? { orderId: "71111111-1111-4111-8111-111111111111", totals }
              : prepared(n > 1),
      });
    }
    if (path === "/api/checkout/payment-permit") {
      f.permitCalls++;
      if (f.lastUnit) {
        const last = f.lastUnit;
        const { orderId, deviceSessionId, guestAccessToken, method, turnstileToken } =
          route.request().postDataJSON();
        if (
          last.phase === "paid" ||
          orderId !== order.id ||
          deviceSessionId !== last.reservation?.deviceSessionId ||
          guestAccessToken !== last.guestAccessToken ||
          method !== last.reservation.paymentMethod ||
          (last.guestAccessToken && !turnstileToken)
        )
          return route.fulfill({ status: 403, json: { error: "Original mismatch" } });
        const permit = `permit-${last.attempts.length + 1}`;
        last.attempts.push(permit);
        return route.fulfill({ json: { permit } });
      }
      return route.fulfill({ json: { permit: "fixture" } });
    }
    if (path === "/api/checkout/pay") {
      f.payCalls++;
      if (f.lastUnit) {
        const last = f.lastUnit;
        const { permit } = route.request().postDataJSON();
        if (!last.attempts.includes(permit) || last.dispatches.includes(permit))
          return route.fulfill({ status: 409, json: { status: "UNKNOWN" } });
        last.dispatches.push(permit);
        if (last.phase === "ready") {
          last.phase = "declined";
          return route.fulfill({
            status: 402,
            json: {
              error: "Payment was declined. Check your details and try again.",
              status: "FAILED",
              paymentId: "synthetic-declined-payment",
              attemptId: "71111111-1111-4111-8111-111111111114",
            },
          });
        }
        last.phase = "paid";
      }
      return route.fulfill({
        json: {
          statusUrl: "/checkout/success?orderId=71111111-1111-4111-8111-111111111111",
        },
      });
    }
    if (path === "/api/orders/71111111-1111-4111-8111-111111111111") {
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
async function retryDeclinedLastUnit(
  f,
  {
    guest = false,
    reload = false,
    method = "card",
    walletAddress,
    suggestion,
    failure,
  } = {},
) {
  f.lastUnit = {
    phase: "ready",
    guestAccessToken: guest ? "synthetic-order-grant" : undefined,
    validations: [],
    attempts: [],
    dispatches: [],
    suggestion,
  };
  if (failure === "late qualification" || failure === "edited contact")
    f.retryLookupHold = gate();
  const p = await f.ctx.newPage();
  p.on("pageerror", (e) => f.errors.push(e.message));
  if (guest) {
    f.session = { user: null, role: null };
    await p.route("https://challenges.cloudflare.com/**", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "window.turnstile={render(el,options){window.verifyGuest=options.callback;return 'widget';},remove(){},reset(){}};",
      }),
    );
  }
  const url = "https://ux.test/checkout" + (guest ? "?guest&guestKey" : "");
  const verifyGuest = async () => {
    if (!walletAddress)
      await p.getByLabel("Email", { exact: true }).fill("guest@example.test");
    await p.waitForFunction(() => typeof window.verifyGuest === "function");
    await p.evaluate(() => window.verifyGuest("synthetic-first-verification"));
  };
  await openUxHarness(p, bundle, url);
  if (guest) await verifyGuest();
  const submit = async (replaceUnits = false) => {
    const replace = () =>
      p.evaluate(() => window.cart.setCartItems([...window.cart.items]));
    if (method === "applePay") {
      await p.evaluate(
        ({ pause, walletAddress }) => {
          const contact = {
            givenName: "Test",
            familyName: "Buyer",
            phone: "3025550100",
            addressLines: [walletAddress ?? "1 Test St"],
            email: "guest@example.test",
            city: "Wilmington",
            state: "DE",
            postalCode: "19801",
            countryCode: "US",
          };
          window.walletResult = {
            status: "OK",
            token: "synthetic-apple",
            details: { billing: contact, shipping: { contact } },
          };
          window.holdApple = pause;
        },
        { pause: replaceUnits, walletAddress },
      );
      await p.getByRole("button", { name: "Pay with Apple Pay" }).click();
      if (replaceUnits) {
        await p.waitForFunction(() => typeof window.releaseApple === "function");
        assert.deepEqual(await replace(), { status: "saved" });
        await p.evaluate(() => window.releaseApple());
      }
    } else if (method === "cashAppPay") {
      await p.getByRole("radio", { name: "Cash App Pay" }).click();
      await p.waitForFunction(() => window.cashMethods?.at(-1)?.complete);
      await expect
        .poll(() => p.evaluate(() => window.cashMethods.at(-1).options.shouldTokenize()))
        .toBe(true);
      if (replaceUnits) assert.deepEqual(await replace(), { status: "saved" });
      await p.evaluate(() =>
        window.cashMethods.at(-1).complete({
          detail: { tokenResult: { status: "OK", token: "synthetic-cash" } },
        }),
      );
    } else if (method === "afterpay") {
      await p.evaluate(() => {
        window.afterpayResult = {
          status: "OK",
          token: "synthetic-afterpay",
          details: {
            shipping: {
              contact: {
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
      await p.getByRole("radio", { name: "Afterpay" }).click();
      await p.getByRole("button", { name: "Continue with Afterpay" }).click();
    } else await pay(p);
  };
  await submit();
  if (suggestion)
    await p.getByRole("button", { name: "Accept suggested address" }).click();
  await expect(p.getByRole("dialog").getByRole("alert"))
    .toHaveText("Payment was declined. Check your details and try again.")
    .catch(async (error) => {
      console.error(
        "Initial decline diagnostic",
        p.url(),
        await p.locator("body").innerText(),
        {
          permits: f.permitCalls,
          pays: f.payCalls,
          validations: f.lastUnit.validations,
        },
      );
      throw error;
    });
  const financialPair = () =>
    p.evaluate(() => [
      sessionStorage.getItem("checkout_idempotency_key"),
      sessionStorage.getItem("checkout_cart_fingerprint"),
    ]);
  const originalPair = await financialPair();
  assert.equal(originalPair[0], f.lastUnit.reservation.idempotencyKey);
  assert.ok(originalPair[1]);
  await p.evaluate(() => window.cart.recheckAvailability());
  assert.ok(
    f.lastUnit.validations.some(({ phase, owns }) => phase === "declined" && owns),
  );
  assert.deepEqual(f.lastUnit.dispatches, ["permit-1"]);
  if (method === "card") assert.equal(await p.evaluate(() => window.tokenCalls), 1);
  assert.equal(f.statusCalls, 0);
  if (reload) await openUxHarness(p, bundle, url);
  else await p.getByRole("button", { name: "Return to checkout" }).click();
  if (guest) await verifyGuest();
  const restoredAddress = walletAddress ?? suggestion;
  if (restoredAddress) {
    assert.equal(f.lastUnit.reservation.shippingAddress.line1, restoredAddress);
    const address = p.getByRole("textbox", { name: "Address", exact: true });
    const apple = p.getByRole("button", { name: "Pay with Apple Pay" });
    const restore = p.getByRole("button", { name: "Restore original details" });
    const tokenCalls = () =>
      p.evaluate(() => [window.tokenCalls, window.appleTokenAmounts]);
    const tokensBeforeRestore = await tokenCalls();
    if (failure === "edited contact") {
      await expect
        .poll(() => f.prepareCalls.some((input) => input.recoveryOnly))
        .toBe(true);
      await address.fill("3 Edited St");
      f.retryLookupHold.resolve();
    }
    await expect(restore).toBeVisible();
    await expect(p.getByText(restoredAddress, { exact: true })).toBeVisible();
    await expect(address).toHaveValue(
      failure === "edited contact" ? "3 Edited St" : "1 Test St",
    );
    await expect(p.locator("#square-apple-pay-container:enabled")).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Pay now", exact: true })).toBeDisabled();
    if (guest) await expect(p.getByLabel("Email", { exact: true })).toHaveValue("");
    const prepareCount = f.prepareCalls.length;
    const staleRestore = async () =>
      restore.evaluate((button) => {
        window.staleRestore = () => button.click();
      });
    if (failure === "restore owner changed") {
      await staleRestore();
      f.sessionStatus = 503;
      await p.evaluate(() => {
        const refresh = window.session.refreshSession();
        window.staleRestore();
        return refresh;
      });
      await expect(restore).toBeHidden();
      assert.equal(
        await p.locator('input[aria-label="Address"]').inputValue(),
        "1 Test St",
      );
      assert.equal(f.permitCalls, 1);
      assert.equal(f.payCalls, 1);
      assert.deepEqual(await tokenCalls(), tokensBeforeRestore);
      return;
    }
    if (failure === "restore units changed") {
      await staleRestore();
      assert.deepEqual(
        await p.evaluate(async () => {
          const saved = await window.cart.setCartItems([...window.cart.items]);
          window.staleRestore();
          return saved;
        }),
        { status: "saved" },
      );
      await expect(restore).toBeHidden();
      await expect(address).toHaveValue("1 Test St");
      await expect(apple).toBeDisabled();
      assert.equal(f.permitCalls, 1);
      assert.equal(f.payCalls, 1);
      assert.deepEqual(await tokenCalls(), tokensBeforeRestore);
      return;
    }
    await restore.click();
    await expect(address).toHaveValue(restoredAddress);
    if (guest)
      await expect(p.getByLabel("Email", { exact: true })).toHaveValue(
        "guest@example.test",
      );
    await expect(restore).toHaveCount(0);
    if (method === "applePay")
      await expect(p.getByRole("button", { name: "Pay $2.30 now" })).toBeDisabled();
    assert.equal(f.prepareCalls.length, prepareCount);
    assert.equal(f.permitCalls, 1);
    assert.equal(f.payCalls, 1);
    assert.deepEqual(await tokenCalls(), tokensBeforeRestore);
  }
  if (failure === "price change") {
    f.lastUnit.changedPrice = true;
    await p.evaluate(() => window.cart.recheckAvailability());
    await expect(p.getByRole("button", { name: "Pay now" })).toBeDisabled();
    assert.equal(f.permitCalls, 1);
    assert.equal(f.payCalls, 1);
    return;
  }
  if (failure === "device change") {
    await p.evaluate(() => {
      sessionStorage.setItem("rdk_checkout_device_session_id", crypto.randomUUID());
      return window.cart.recheckAvailability();
    });
    await expect(p.getByRole("button", { name: "Pay now" })).toBeDisabled();
    assert.equal(f.permitCalls, 1);
    assert.equal(f.payCalls, 1);
    assert.equal(await p.evaluate(() => window.tokenCalls), 1);
    return;
  }
  if (failure === "late qualification") {
    await expect
      .poll(() => f.prepareCalls.some((input) => input.recoveryOnly))
      .toBe(true);
    assert.deepEqual(
      await p.evaluate(() => window.cart.setCartItems([...window.cart.items])),
      { status: "saved" },
    );
    await p.evaluate(() => window.cart.recheckAvailability());
    f.retryLookupHold.resolve();
    await expect.poll(() => f.lastUnit.lookupSettled).toBe(true);
    await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await expect(p.getByRole("button", { name: "Pay now" })).toBeDisabled();
    assert.equal(f.permitCalls, 1);
    assert.equal(f.payCalls, 1);
    return;
  }
  if (failure === "replaced units") {
    await submit(true);
    await expect(p.getByRole("dialog").getByRole("alert")).toContainText(
      /checkout changed/i,
    );
    assert.equal(f.permitCalls, 1);
    assert.equal(f.payCalls, 1);
    return;
  }
  f.orderHold = gate();
  await submit();
  await expect(p).toHaveURL(
    /\/checkout\/processing\?orderId=71111111-1111-4111-8111-111111111111/,
  );
  assert.deepEqual(await financialPair(), originalPair);
  assert.equal(
    f.prepareCalls.filter((input) => !input.recoveryOnly).length,
    suggestion ? 2 : 1,
  );
  assert.ok(f.prepareCalls.some((input) => input.recoveryOnly));
  assert.equal(f.permitCalls, 2);
  assert.equal(f.payCalls, 2);
  if (method === "card")
    assert.equal(await p.evaluate(() => window.tokenCalls), reload ? 1 : 2);
  if (method === "applePay")
    assert.deepEqual(
      await p.evaluate(() => window.appleTokenAmounts),
      reload ? ["2.30"] : ["2.30", "2.30"],
    );
  assert.deepEqual(f.lastUnit.dispatches, ["permit-1", "permit-2"]);
  f.orderHold.resolve();
  await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
}
async function controlledPost(f, stage, mode) {
  const p = await f.ctx.newPage();
  p.on("pageerror", (e) => f.errors.push(e.message));
  await p.clock.install();
  await p.addInitScript(
    ({ stage, mode }) => {
      localStorage.clear();
      sessionStorage.clear();
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
                  orderId: "71111111-1111-4111-8111-111111111111",
                  reused: false,
                  totals: {
                    subtotalCents: 200,
                    shippingCents: 20,
                    taxCents: 10,
                    totalCents: 230,
                  },
                }
              : {
                  statusUrl:
                    "/checkout/success?orderId=71111111-1111-4111-8111-111111111111",
                };
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
async function copiedCheckout(f, missingOriginal) {
  f.missingOriginal = missingOriginal;
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
  assert.equal(
    await b.evaluate(() => window.cart.clearCart().then((r) => r.status)),
    "saved",
  );
  assert.equal(
    await b.evaluate((x) => window.cart.addItem(x).then((r) => r.status), item),
    "saved",
  );
  await pay(b);
  await expect
    .poll(() => f.prepareCalls.length)
    .toBe(2)
    .catch(async (error) => {
      console.error(
        "Synthetic copied-tab state",
        (await b.locator("body").innerText()).slice(-2000),
        { prepare: f.prepareCalls.length, permit: f.permitCalls, pay: f.payCalls },
      );
      throw error;
    });
  const { recoveryOnly, ...recovered } = f.prepareCalls[1];
  assert.equal(recoveryOnly, true);
  const { shippingAddressOverride, ...original } = f.prepareCalls[0];
  assert.equal(shippingAddressOverride, false);
  assert.deepEqual(
    recovered,
    original,
    "the lookup reuses the original saved payload, key and device",
  );
  assert.equal(f.permitCalls, 0);
  assert.equal(await b.evaluate(() => window.tokenCalls ?? 0), 0);
  if (missingOriginal) {
    await expect(b.getByRole("button", { name: "Check original order" })).toBeVisible();
    await expect(b.getByRole("link", { name: "Check order status" })).toBeVisible();
    assert.equal(
      await b.evaluate(() => sessionStorage.getItem("checkout_idempotency_key")),
      original.idempotencyKey,
    );
  } else {
    await expect(b.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
  }
  assert.equal(f.payCalls, 0);
  assert.equal(await b.evaluate(() => window.cart.itemCount), 1);
  f.prepareHold.resolve();
  await expect(a.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
  assert.equal(f.permitCalls, 0);
  assert.equal(await a.evaluate(() => window.tokenCalls ?? 0), 0);
  assert.equal(await a.evaluate(() => window.cart.itemCount), 1);
  assert.equal(f.payCalls, 0);
}

const cases = {
  async lostPayment(f) {
    for (const mode of ["drop", "headers", "body", "unreadable"]) {
      f.orderHold = gate();
      const p = await controlledPost(f, "pay", mode);
      await p.clock.fastForward(16000);
      await expect(p).toHaveURL(
        /checkout\/processing\?orderId=71111111-1111-4111-8111-111111111111/,
      );
      await expect.poll(() => f.statusQueries?.length ?? 0).toBeGreaterThan(0);
      const key = await p.evaluate(() =>
        sessionStorage.getItem("checkout_idempotency_key"),
      );
      assert.ok(key);
      await p.clock.fastForward(61000);
      await expect(p.getByText(/before paying again/)).toBeVisible();
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
  lastUnitDeclineAccount: (f) => retryDeclinedLastUnit(f),
  lastUnitDeclineGuest: (f) => retryDeclinedLastUnit(f, { guest: true }),
  lastUnitDeclineAccountReload: (f) => retryDeclinedLastUnit(f, { reload: true }),
  lastUnitDeclineGuestReload: (f) =>
    retryDeclinedLastUnit(f, { guest: true, reload: true }),
  lastUnitApplePay: (f) => retryDeclinedLastUnit(f, { method: "applePay" }),
  lastUnitApplePayRestore: (f) =>
    retryDeclinedLastUnit(f, { method: "applePay", walletAddress: "2 Wallet St" }),
  lastUnitApplePayRestoreGuestReload: (f) =>
    retryDeclinedLastUnit(f, {
      method: "applePay",
      walletAddress: "2 Wallet St",
      guest: true,
      reload: true,
    }),
  lastUnitCardRestoreSuggestion: (f) =>
    retryDeclinedLastUnit(f, { suggestion: "2 Suggested St" }),
  lastUnitApplePayRestoreEditedContact: (f) =>
    retryDeclinedLastUnit(f, {
      method: "applePay",
      walletAddress: "2 Wallet St",
      failure: "edited contact",
    }),
  lastUnitApplePayRestoreOwnerChanged: (f) =>
    retryDeclinedLastUnit(f, {
      method: "applePay",
      walletAddress: "2 Wallet St",
      failure: "restore owner changed",
    }),
  lastUnitApplePayRestoreUnitsChanged: (f) =>
    retryDeclinedLastUnit(f, {
      method: "applePay",
      walletAddress: "2 Wallet St",
      failure: "restore units changed",
    }),
  lastUnitCashApp: (f) => retryDeclinedLastUnit(f, { method: "cashAppPay" }),
  lastUnitAfterpay: (f) => retryDeclinedLastUnit(f, { method: "afterpay" }),
  lastUnitApplePayReplacement: (f) =>
    retryDeclinedLastUnit(f, { method: "applePay", failure: "replaced units" }),
  lastUnitCashAppReplacement: (f) =>
    retryDeclinedLastUnit(f, { method: "cashAppPay", failure: "replaced units" }),
  lastUnitDeclineRepriced: (f) => retryDeclinedLastUnit(f, { failure: "price change" }),
  lastUnitDeclineDeviceChanged: (f) =>
    retryDeclinedLastUnit(f, { failure: "device change" }),
  lastUnitDeclineLateQualification: (f) =>
    retryDeclinedLastUnit(f, { failure: "late qualification" }),
  async earlyDeadline(f) {
    for (const stage of ["prepare", "payment-permit"])
      for (const mode of ["headers", "body"]) {
        const p = await controlledPost(f, stage, mode);
        const key = await p.evaluate(() =>
          sessionStorage.getItem("checkout_idempotency_key"),
        );
        await p.waitForFunction(() => window.postCount === 1);
        await p.clock.runFor(16001);
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
  async missingGuestKey(f) {
    f.session = { user: null, role: null };
    const p = await f.open("/checkout?guest");
    await p.getByLabel("Email", { exact: true }).fill("guest@example.test");
    await p.getByLabel("Name on card").fill("Saved draft");
    const pay = p.getByRole("button", { name: /^Pay .*now/ });
    await expect(pay).toBeDisabled();

    await expect(pay).toHaveAccessibleDescription(/verification|security check/i);
    await expect(p.getByRole("status").filter({ hasText: /unavailable/i })).toBeVisible();
    await expect(p.getByRole("button", { name: "Retry security check" })).toHaveCount(0);
    assert.equal(f.payCalls, 0);
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
    await expect(p.getByText("Runner", { exact: true })).toBeHidden();
    await expect(p.getByLabel("Name on card")).toBeHidden();
    f.sessionStatus = 503;
    f.sessionHold.resolve();
    await expect(
      p.getByRole("button", { name: /Retry (checkout|cart access)/ }),
    ).toBeVisible();
    const n = f.quoteCalls;
    f.sessionStatus = 200;
    f.session = {
      user: { id: "changed", email: "other@test.invalid" },
      role: "customer",
    };
    await p.getByRole("button", { name: /Retry (checkout|cart access)/ }).click();
    await expect(p.getByLabel("Name on card")).toHaveCount(0);
    await expect(p.getByText("buyer@example.test", { exact: true })).toHaveCount(0);
    assert.equal(f.quoteCalls, n);
    f.sessionStatus = 503;
    const guest = await f.open("/checkout?guest&unavailable");
    await expect(
      guest.getByRole("button", { name: /Retry (checkout|cart access)/ }),
    ).toBeVisible();
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
    await expect(p.getByLabel("Address", { exact: true })).toHaveValue("2 Second St");
    await p.evaluate(() => window.releaseToken());
    await expect(p.getByLabel("Name on card")).toHaveValue("");
    assert.equal(f.payCalls, 0);
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
      p.getByRole("button", { name: "Pay $2.30 now", exact: true }),
    ).toBeHidden();
    assert.equal(f.prepareCalls.length, 0);
    f.sessionHold.resolve();
  },
  async omitted(f) {
    f.omitReused = true;
    const p = await f.open();
    await pay(p);
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(await p.evaluate(() => window.cart.itemCount), 0);
    assert.equal(f.payCalls, 1);
  },
  async omittedReplacement(f) {
    f.omitReused = true;
    f.orderHold = gate();
    const page = await f.open();
    await pay(page);
    await expect.poll(() => f.statusCalls).toBe(1);
    assert.equal(
      await page.evaluate(() => window.cart.clearCart().then((result) => result.status)),
      "saved",
    );
    assert.equal(
      await page.evaluate(
        (item) => window.cart.addItem(item).then((result) => result.status),
        item,
      ),
      "saved",
    );
    f.orderHold.resolve();
    await expect(page.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.cart.itemCount)).toBe(1);
    assert.equal(f.payCalls, 1);
  },
  async bindFailure(f) {
    const p = await f.open();
    await p.waitForFunction(
      () => window.cart?.isReady && window.cart.validationStatus === "idle",
    );
    await p.getByLabel("Name on card").fill("Buyer");
    await p.evaluate(() => {
      navigator.locks.request = () => Promise.reject(Error("Fixture lock unavailable"));
    });
    await p.getByRole("button", { name: "Pay $2.30 now", exact: true }).click();
    await expect(p.getByRole("button", { name: "Retry cart access" })).toBeVisible();
    assert.equal(await p.evaluate(() => window.cart.access), "unavailable");
    assert.equal(
      await p.evaluate(
        () => JSON.parse(localStorage.getItem("rdk_cart_user_buyer"))[0].quantity,
      ),
      1,
    );
    assert.equal(f.permitCalls, 0);
    assert.equal(f.payCalls, 0);
    assert.equal(f.prepareCalls.length, 0);
  },
  duplicate: (f) => copiedCheckout(f, false),
  duplicateMissing: (f) => copiedCheckout(f, true),
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
      "https://ux.test/checkout/success?orderId=71111111-1111-4111-8111-111111111111&token=fixture",
    );
    await expect.poll(() => f.statusCalls).toBe(1);
    await p.clock.fastForward(61000);
    await expect(p.getByRole("button", { name: "Check order status" })).toBeVisible();
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toHaveCount(0);
    f.orderHold.resolve();
    await p.getByRole("button", { name: "Check order status" }).click();
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(f.statusCalls, 2);
  },
  async receiptRead(f) {
    f.firstPending = true;
    const p = await f.open(
      "/checkout/success?orderId=71111111-1111-4111-8111-111111111111&token=fixture",
    );
    await expect(p.getByRole("heading", { name: "Order Confirmed!" })).toBeVisible();
    assert.equal(f.statusCalls, 2);
    assert.equal(
      f.statusQueries.some((q) => q.includes("reconcile")),
      true,
      "the second pending status read requests authorized reconciliation",
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
    assert.equal(
      await p.evaluate((item) => window.cart.addItem(item).then((r) => r.status), item),
      "saved",
    );
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
    const p = await f.open(
      "/order-status/71111111-1111-4111-8111-111111111111?token=fixture",
    );
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
    const p = await f.open(
      "/order-status/71111111-1111-4111-8111-111111111111?token=invalid",
    );
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
    const p = await f.open(
      "/order-status/71111111-1111-4111-8111-111111111111?guest&unavailable&token=fixture",
    );
    await expect(p.getByText("outage@example.test")).toBeVisible();
    assert.equal(await p.evaluate(() => window.session.isSessionUnavailable), true);
    f.statusOwner = "confirmed-guest";
    f.sessionStatus = 200;
    f.session = { user: null, role: null };
    await p.evaluate(() => window.session.refreshSession());
    await expect(p.getByText("confirmed-guest@example.test")).toBeVisible();
    await expect(p.getByText("outage@example.test")).toHaveCount(0);
    assert.ok(
      f.statusCalls >= 2 && f.statusQueries.every((q) => q.includes("token=fixture")),
    );
  },
  async orderOwnerLate(f) {
    f.orderHold = gate();
    const old = f.orderHold;
    const p = await f.open(
      "/order-status/71111111-1111-4111-8111-111111111111?token=fixture",
    );
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
    const p = await f.open(
      "/order-status/71111111-1111-4111-8111-111111111111?token=fixture",
    );
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
        "retryLookupHold",
      ])
        f[hold]?.resolve();
      await f.ctx.close();
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, []);
