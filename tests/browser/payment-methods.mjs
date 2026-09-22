// Run: node tests/browser/payment-methods.mjs
// Real React/DOM lifecycle, with Square replaced only at the external SDK boundary.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const result = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { StrictMode, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { CheckoutPaymentProvider } from './src/components/checkout/CheckoutPaymentDialog';
      import { SquarePaymentMethods } from './src/components/checkout/SquarePaymentMethods';
      const totals = { subtotalCents: 10000, shippingCents: 1000, taxCents: 800, totalCents: 11800 };
      const initial = { quote: { completeness: 'preliminary', quoteFingerprint: null,
        totals: { ...totals, taxCents: null, totalCents: 11000 } }, quoteReady: true,
        fulfillment: 'ship', shippingAddress: null, buyerEmail: 'buyer@example.com' };
      window.paymentTest = { cardFailure: new URLSearchParams(location.search).get('cardFailure'), counts: {}, requests: [], errors: [], prepareCalls: 0, updateAllowed: true };
      const test = window.paymentTest;
      const method = (name, request, options) => {
        test.counts[name] = (test.counts[name] || 0) + 1;
        let host;
        return {
          async attach(selector, attachOptions) { if (name === 'card' && test.cardFailure === 'attach') throw new Error('test card attachment failure'); if (name === "cashAppPay") test.cashAttachOptions = attachOptions; host = document.querySelector(selector);
            if (name === 'card') host.replaceChildren(document.createTextNode('Secure card fields'));
            if (name === 'afterpay') host.replaceChildren(document.createTextNode('SDK owns this node'));
            if (name === 'cashAppPay') {
              const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
              host.replaceChildren(button);
            }
          },
          async destroy() { host?.replaceChildren(); return true; },
          addEventListener(event, listener) { if (name === "cashAppPay") { test.cashCallback = listener; test.cashOptions = options; } },
          async tokenize() { test.tokenizeCalls = (test.tokenizeCalls || 0) + 1; test.lastTokenized = name; test.lastRequest = request?.options; if (test.holdToken) return new Promise(resolve => test.resolveToken = resolve); return test.tokenResult ?? { status: 'CANCEL' }; },
        };
      };
      window.Square = { payments: () => ({
        card: async () => { if (test.cardFailure === 'create') throw new Error('test card creation failure'); return method('card'); },
        paymentRequest: (options) => { const request = { options, listeners: {},
          addEventListener(event, listener) { request.listeners[event] = listener; }, update(next) { if (!test.updateAllowed) return false;
            request.options = { ...request.options, ...next }; return true; } };
          test.requests.push(request); return request;
        },
        applePay: async (request) => method('applePay', request),
        googlePay: async (request) => method('googlePay', request),
        afterpayClearpay: async (request) => method('afterpay', request),
        cashAppPay: async (request, options) => method('cashAppPay', request, options),
      }) };
      function Harness() {
        const [props, setProps] = useState(initial);
        test.change = (next) => setProps(old => ({ ...old, ...next }));
        return <SquarePaymentMethods {...props} paymentConfig={{ applicationId: 'sandbox-test', locationId: 'test', environment: 'sandbox' }}
          isGuest={false} prepare={async (...args) => { test.prepareCalls++; test.lastPrepare = args; if (test.holdPrepare) return new Promise((resolve, reject) => { test.resolvePrepare = resolve; test.rejectPrepare = reject; }); throw new Error('test boundary'); }}
          clearCart={() => {}} quoteWalletShippingDestination={async () => { throw new Error('unused'); }}
          resolveWalletShippingContact={async () => { throw new Error('unused'); }} />;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><CheckoutPaymentProvider><Harness /></CheckoutPaymentProvider></StrictMode>);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "external-service-boundaries",
      setup(builder) {
        builder.onResolve(
          { filter: /^next\/navigation$|^@\/config\/client-env$|^@\/lib\/utils\/log$/ },
          (args) => ({ path: args.path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents:
            args.path === "next/navigation"
              ? "const router = { replace: url => window.location.replace(url) }; export const useRouter = () => router;"
              : args.path.endsWith("client-env")
                ? "export const clientEnv = {};"
                : "export const log = () => {};",
          loader: "js",
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on(
    "pageerror",
    (error) => (errors.push(error.message), console.error(error.message)),
  );
  await page.route("http://checkout.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("http://checkout.test/checkout");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.getByRole("radio", { name: "Cash App Pay", exact: true }).waitFor();
  await page.getByText("Secure card fields", { exact: true }).waitFor();
  const stableRows = async () => {
    assert.equal(
      await page.getByRole("radio", { name: "Cash App Pay", exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await page.getByRole("radio", { name: "Afterpay", exact: true }).isVisible(),
      true,
    );
  };
  const change = async (props) => {
    await page.evaluate((props) => window.paymentTest.change(props), props);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await stableRows();
  };
  const exact = {
    completeness: "exact",
    quoteFingerprint: "a".repeat(64),
    totals: {
      subtotalCents: 10000,
      shippingCents: 1000,
      taxCents: 800,
      totalCents: 11800,
    },
  };
  await page.waitForFunction(() => window.paymentTest.counts.applePay === 1);
  assert.equal(await page.evaluate(() => window.paymentTest.counts.googlePay || 0), 0);
  assert.equal(await page.locator("#square-google-pay-container").count(), 0);
  await stableRows();
  await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Continue with Cash App Pay", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(
    await page.getByRole("status").textContent(),
    "Enter your shipping address to continue.",
  );
  await change({ fulfillment: "pickup", quote: exact });
  assert.equal(
    await page.getByRole("status").textContent(),
    "Enter your billing address to continue.",
  );
  await change({ buyerEmail: "" });
  assert.equal(
    await page.getByRole("status").textContent(),
    "Enter your email to continue.",
  );
  await change({ buyerEmail: "buyer@example.com" });
  await page.waitForFunction(() => window.paymentTest.counts.afterpay === 1);
  await change({ fulfillment: "ship", quoteReady: false });
  const address = {
    name: "Test Buyer",
    phone: "3025550100",
    line1: "1 Test St",
    line2: null,
    city: "Wilmington",
    state: "DE",
    postalCode: "19801",
    country: "US",
  };
  await change({ shippingAddress: address, quoteReady: true });
  await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
  const beforeContactEdit = await page.evaluate(() => window.paymentTest.counts);
  await change({
    buyerEmail: "updated@example.com",
    shippingAddress: { ...address, line1: "2 Test St" },
  });
  assert.equal(
    await page
      .getByRole("radio", { name: "Afterpay", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  const counts = await page.evaluate(() => window.paymentTest.counts);
  assert.equal(counts.applePay, beforeContactEdit.applePay);
  assert.equal(counts.googlePay, beforeContactEdit.googlePay);
  assert.equal(counts.afterpay, beforeContactEdit.afterpay);
  assert.equal(counts.cashAppPay, 1);
  await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
  await page.getByRole("button", { name: "cashAppPay", exact: true }).waitFor();
  await page.getByText("Use a different billing address", { exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.paymentTest.cashOptions.shouldTokenize()),
    false,
  );
  await page.evaluate(() =>
    window.paymentTest.cashCallback({
      detail: { tokenResult: { status: "OK", token: "test" } },
    }),
  );
  await page.getByRole("alert").first().waitFor();
  assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
  await page.getByText("Same as shipping address", { exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.paymentTest.cashOptions.shouldTokenize()),
    true,
  );
  await page
    .getByRole("heading", { name: "Loading Cash App Pay…", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#checkout-payment-description").textContent(),
    "Complete your payment approval in Cash App Pay.",
  );
  assert.equal(
    await page.evaluate(() => document.querySelector("dialog").matches(":modal")),
    false,
  );
  await page.evaluate(() =>
    window.paymentTest.cashCallback({ detail: { tokenResult: { status: "CANCEL" } } }),
  );
  await page.waitForFunction(() => !document.querySelector("dialog")?.open);
  assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
  await page.evaluate(() => window.paymentTest.cashOptions.shouldTokenize());
  await page
    .getByRole("heading", { name: "Loading Cash App Pay…", exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.paymentTest.holdPrepare = true;
  });
  await page.evaluate(() =>
    window.paymentTest.cashCallback({
      detail: { tokenResult: { status: "OK", token: "test" } },
    }),
  );
  await page.waitForFunction(() => Boolean(window.paymentTest.resolvePrepare));
  assert.equal(
    await page.locator("dialog[open]").count(),
    1,
    "Cash App keeps its loading dialog through preparation",
  );
  assert.equal(
    await page.locator("#checkout-payment-title").textContent(),
    "Loading Cash App Pay…",
  );
  await page.evaluate(() => {
    window.paymentTest.holdPrepare = false;
    window.paymentTest.rejectPrepare(new Error("test boundary"));
  });
  await page.getByRole("heading", { name: "Payment could not be completed" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastPrepare[1].billingAddress.line1),
    "2 Test St",
  );
  await page.evaluate(() => {
    window.paymentTest.prepareCalls = 0;
  });
  await change({ quoteReady: false });
  assert.equal(
    await page.locator("#square-cash-app-pay-container").getAttribute("inert"),
    "",
  );
  assert.equal(
    await page.evaluate(() => window.paymentTest.cashOptions.shouldTokenize()),
    false,
  );
  await page.evaluate(() =>
    window.paymentTest.cashCallback({
      detail: { tokenResult: { status: "OK", token: "test" } },
    }),
  );
  assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
  await change({
    quoteReady: true,
    quote: {
      ...exact,
      quoteFingerprint: "b".repeat(64),
      totals: { ...exact.totals, totalCents: 12000 },
    },
  });
  await page.waitForFunction(() => window.paymentTest.counts.cashAppPay === 2);
  assert.equal(
    await page
      .getByRole("radio", { name: "Cash App Pay", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "Return to checkout" }).click();
  await page.getByRole("button", { name: "Pay with Apple Pay", exact: true }).click();
  await page.waitForFunction(() => window.paymentTest.lastTokenized === "applePay");
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastRequest.total.amount),
    "120.00",
  );
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastRequest.requestShippingContact),
    true,
  );
  await page.waitForFunction(() => !document.querySelector("dialog")?.open);
  await change({
    fulfillment: "pickup",
    shippingAddress: null,
    buyerEmail: "account@example.com",
    quote: exact,
  });
  await page.evaluate(() => {
    window.paymentTest.tokenResult = {
      status: "OK",
      token: "test",
      details: {
        billing: {
          email: "Wallet@Example.com",
          givenName: "Wallet",
          familyName: "Buyer",
          addressLines: ["1 Billing St"],
          city: "Wilmington",
          state: "DE",
          postalCode: "19801",
          countryCode: "US",
        },
      },
    };
  });
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "Return to checkout" }).click();
  await page.getByRole("button", { name: "Pay with Apple Pay", exact: true }).click();
  await page.getByRole("heading", { name: "Complete your checkout details" }).waitFor();
  const walletTokenizeCount = await page.evaluate(() => window.paymentTest.tokenizeCalls);
  assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
  await page.getByRole("dialog").getByLabel("Pickup phone").fill("3365550100");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(() => window.paymentTest.prepareCalls === 1);
  assert.equal(
    await page.evaluate(() => window.paymentTest.tokenizeCalls),
    walletTokenizeCount,
  );
  assert.deepEqual(
    await page.evaluate(() => window.paymentTest.lastPrepare[1].pickupContact),
    {
      name: "Wallet Buyer",
      phone: "3365550100",
    },
  );
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastRequest.requestShippingContact),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastPrepare[1].buyerEmail),
    "account@example.com",
  );
  assert.equal(await page.evaluate(() => window.paymentTest.counts.googlePay || 0), 0);
  assert.deepEqual(await page.evaluate(() => window.paymentTest.cashAttachOptions), {
    shape: "semiround",
    size: "medium",
    theme: "dark",
    width: "full",
  });
  await page.getByRole("button", { name: "Return to checkout" }).click();
  // Missing billing and pickup contact can be canceled without preparing or paying.
  await page.evaluate(() => {
    window.paymentTest.prepareCalls = 0;
    window.paymentTest.tokenResult = { status: "OK", token: "held-wallet-token" };
  });
  await page.getByRole("button", { name: "Pay with Apple Pay" }).click();
  await page.getByRole("heading", { name: "Complete your checkout details" }).waitFor();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByLabel("Billing address", { exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
  await page.getByRole("button", { name: "Cancel checkout" }).click();
  await page.waitForFunction(() => !document.querySelector("dialog")?.open);
  assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
  // A second attempt asks for missing fields again and submits the same wallet token once.
  await change({ pickupContact: { name: "Different Recipient", phone: "3365550199" } });
  await page.getByRole("button", { name: "Pay with Apple Pay" }).click();
  await page.getByRole("heading", { name: "Complete your checkout details" }).waitFor();
  const beforeBillingContinue = await page.evaluate(
    () => window.paymentTest.tokenizeCalls,
  );
  const review = page.getByRole("dialog");
  await review.getByLabel("Billing first name", { exact: true }).fill("Billing");
  await review.getByLabel("Billing last name", { exact: true }).fill("Buyer");
  await review.getByLabel("Billing address", { exact: true }).fill("1 Billing St");
  await review.getByLabel("Billing city", { exact: true }).fill("Wilmington");
  await review.getByLabel("Billing state", { exact: true }).selectOption("DE");
  await review.getByLabel("Billing ZIP code", { exact: true }).fill("19801");
  await page.getByRole("button", { name: "Continue", exact: true }).evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(() => window.paymentTest.prepareCalls === 1);
  assert.equal(
    await page.evaluate(() => window.paymentTest.tokenizeCalls),
    beforeBillingContinue,
  );
  assert.deepEqual(
    await page.evaluate(() => window.paymentTest.lastPrepare[1].pickupContact),
    { name: "Different Recipient", phone: "3365550199" },
  );
  await page.getByRole("button", { name: "Return to checkout" }).click();
  await change({
    fulfillment: "ship",
    shippingAddress: address,
    buyerEmail: "buyer@example.com",
  });
  await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
  await page.evaluate(() => {
    window.paymentTest.holdPrepare = true;
    window.paymentTest.holdToken = true;
  });
  await page.getByRole("button", { name: "Continue with Afterpay" }).click();
  await page.waitForFunction(() => Boolean(window.paymentTest.resolvePrepare));
  assert.equal(
    await page
      .getByRole("button", { name: "Loading Afterpay…", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Afterpay address preparation finishes before processing is shown",
  );
  await page.route("**/api/checkout/payment-permit", (route) =>
    route.fulfill({ json: { permit: "test" } }),
  );
  await page.route("**/api/checkout/pay", () => {});
  await page.evaluate(() =>
    window.paymentTest.resolvePrepare({
      orderId: "test",
      deviceSessionId: "test",
      totals: { totalCents: 11800 },
    }),
  );
  await page.getByRole("heading", { name: "Loading Afterpay…", exact: true }).waitFor();
  assert.equal(
    await page.locator("#checkout-payment-description").textContent(),
    "Complete your payment approval in Afterpay.",
  );
  await page.evaluate(() => {
    window.paymentTest.spinner = document.querySelector("dialog .animate-spin");
  });
  await page.waitForFunction(() => Boolean(window.paymentTest.resolveToken));
  await page.evaluate(() => window.paymentTest.resolveToken({ status: "CANCEL" }));
  await page.waitForFunction(() => !document.querySelector("dialog")?.open);
  await page.evaluate(() => {
    window.paymentTest.resolvePrepare = null;
    window.paymentTest.resolveToken = null;
  });
  await page.getByRole("button", { name: "Continue with Afterpay" }).click();
  await page.waitForFunction(() => Boolean(window.paymentTest.resolvePrepare));
  await page.evaluate(() =>
    window.paymentTest.resolvePrepare({
      orderId: "test",
      deviceSessionId: "test",
      totals: { totalCents: 11800 },
    }),
  );
  await page.getByRole("heading", { name: "Loading Afterpay…", exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.paymentTest.resolveToken));
  const afterpayResults = await page.evaluate(() => {
    const req = window.paymentTest.requests.findLast(
      (request) => request.listeners.afterpay_shippingaddresschanged,
    );
    const contact = {
      addressLines: ["1 Test St"],
      city: "Wilmington",
      state: "Delaware",
      postalCode: "19801-1234",
      countryCode: "US",
    };
    const update = req.listeners.afterpay_shippingaddresschanged;
    const wrong = update({ ...contact, addressLines: ["999 Test St"] });
    const right = update(contact);
    return { wrong, right };
  });
  assert.ok(afterpayResults.wrong.error);
  assert.equal(afterpayResults.right.shippingOptions[0].total.amount, "118.00");
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  assert.equal(
    await page.evaluate(() => {
      const input = document.createElement("input");
      document.body.append(input);
      input.focus();
      const providerCanFocus = document.activeElement === input;
      input.remove();
      return (
        providerCanFocus &&
        !document.querySelector("dialog").matches(":modal") &&
        window.paymentTest.spinner === document.querySelector("dialog .animate-spin")
      );
    }),
    true,
    "Provider approval can take focus without replacing the payment spinner",
  );
  await page.evaluate(() =>
    window.paymentTest.resolveToken({ status: "OK", token: "test" }),
  );
  await page
    .getByRole("heading", { name: "Processing your payment", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => window.paymentTest.spinner === document.querySelector("dialog .animate-spin"),
    ),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Processing…", exact: true }).isDisabled(),
    true,
  );

  // Cash App remains loading until its authorized token is submitted for payment.
  await page.goto("http://checkout.test/checkout");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.getByText("Secure card fields", { exact: true }).waitFor();
  await change({ quote: exact, shippingAddress: address });
  await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
  await page.getByRole("button", { name: "cashAppPay", exact: true }).waitFor();
  await page.evaluate(() => {
    window.paymentTest.holdPrepare = true;
    window.paymentTest.cashOptions.shouldTokenize();
  });
  await page
    .getByRole("heading", { name: "Loading Cash App Pay…", exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.paymentTest.spinner = document.querySelector("dialog .animate-spin");
    window.paymentTest.cashCallback({
      detail: { tokenResult: { status: "OK", token: "test" } },
    });
  });
  await page.waitForFunction(() => Boolean(window.paymentTest.resolvePrepare));
  assert.equal(
    await page.locator("#checkout-payment-title").textContent(),
    "Loading Cash App Pay…",
  );
  await page.evaluate(() =>
    window.paymentTest.resolvePrepare({
      orderId: "test",
      deviceSessionId: "test",
      totals: { totalCents: 11800 },
    }),
  );
  await page
    .getByRole("heading", { name: "Processing your payment", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => window.paymentTest.spinner === document.querySelector("dialog .animate-spin"),
    ),
    true,
  );
  assert.deepEqual(errors, []);
  for (const phase of ["create", "attach"]) {
    await page.goto(`http://checkout.test/checkout?cardFailure=${phase}`);
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page
      .getByText("Secure payment fields could not be loaded. Please retry.", {
        exact: true,
      })
      .first()
      .waitFor();
    await page.waitForFunction(() => window.paymentTest.counts.applePay === 1);
    assert.equal(await page.evaluate(() => window.paymentTest.prepareCalls), 0);
    assert.equal(await page.evaluate(() => window.paymentTest.tokenizeCalls || 0), 0);
    await page.reload();
    await page.evaluate(() => history.replaceState(null, "", "/checkout"));
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.getByText("Secure card fields", { exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: persistent rows, independent wallet instances, updated totals, stale Cash App rejection",
  );
} finally {
  await browser.close();
}
