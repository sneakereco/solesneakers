// Run: node tests/browser/payment-methods.mjs
// Real React/DOM lifecycle, with Square replaced only at the external SDK boundary.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const result = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { SquarePaymentMethods } from './src/components/checkout/SquarePaymentMethods';
      const totals = { subtotalCents: 10000, shippingCents: 1000, taxCents: 800, totalCents: 11800 };
      const initial = { quote: { completeness: 'preliminary', quoteFingerprint: null,
        totals: { ...totals, taxCents: null, totalCents: 11000 } }, quoteReady: true,
        fulfillment: 'ship', shippingAddress: null, buyerEmail: 'buyer@example.com' };
      window.paymentTest = { counts: {}, requests: [], errors: [], prepareCalls: 0, updateAllowed: true };
      const test = window.paymentTest;
      const method = (name, request, options) => {
        test.counts[name] = (test.counts[name] || 0) + 1;
        let host;
        return {
          async attach(selector, attachOptions) { if (name === "googlePay") test.googleAttachOptions = attachOptions; host = document.querySelector(selector);
            if (name === 'afterpay') host.replaceChildren(document.createTextNode('SDK owns this node'));
            if (name === 'googlePay' || name === 'cashAppPay') {
              const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
              host.replaceChildren(button);
            }
          },
          async destroy() { host?.replaceChildren(); return true; },
          addEventListener(event, listener) { if (name === "cashAppPay") { test.cashCallback = listener; test.cashOptions = options; } },
          async tokenize() { test.lastTokenized = name; test.lastRequest = request?.options; return test.tokenResult ?? { status: 'CANCEL' }; },
        };
      };
      window.Square = { payments: () => ({
        card: async () => method('card'),
        paymentRequest: (options) => { const request = { options,
          addEventListener() {}, update(next) { if (!test.updateAllowed) return false;
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
          isGuest={false} prepare={async (...args) => { test.prepareCalls++; test.lastPrepare = args; throw new Error('test boundary'); }}
          clearCart={() => {}} quoteWalletShippingDestination={async () => { throw new Error('unused'); }}
          resolveWalletShippingContact={async () => { throw new Error('unused'); }} />;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
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
          { filter: /^@\/config\/client-env$|^@\/lib\/utils\/log$/ },
          (args) => ({ path: args.path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents: args.path.endsWith("client-env")
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
  await page.waitForFunction(() => window.paymentTest.counts.googlePay === 1);
  assert.deepEqual(await page.evaluate(() => window.paymentTest.googleAttachOptions), {
    buttonSizeMode: "fill",
  });
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
  assert.equal(counts.afterpay, 1);
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
  await page.evaluate(() =>
    window.paymentTest.cashCallback({
      detail: { tokenResult: { status: "OK", token: "test" } },
    }),
  );
  await page.waitForFunction(() => window.paymentTest.prepareCalls === 1);
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
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Return to checkout" }).click();
  await page.getByRole("button", { name: "googlePay", exact: true }).click();
  await page.waitForFunction(() => window.paymentTest.lastTokenized === "googlePay");
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastRequest.total.amount),
    "120.00",
  );
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastRequest.requestShippingContact),
    true,
  );
  await page.getByRole("alert").first().waitFor();
  await change({
    fulfillment: "pickup",
    shippingAddress: null,
    buyerEmail: "",
    quote: exact,
  });
  await page.evaluate(() => {
    window.paymentTest.tokenResult = {
      status: "OK",
      token: "test",
      details: { billing: { email: "Wallet@Example.com", givenName: "Wallet", familyName: "Buyer", addressLines: ["1 Billing St"], city: "Wilmington", state: "DE", postalCode: "19801", countryCode: "US" } },
    };
  });
  if (await page.getByRole("dialog").isVisible()) await page.getByRole("button", { name: "Return to checkout" }).click();
  await page.getByRole("button", { name: "googlePay", exact: true }).click();
  await page.waitForFunction(() => window.paymentTest.prepareCalls === 1);
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastRequest.requestShippingContact),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.paymentTest.lastPrepare[1].buyerEmail),
    "wallet@example.com",
  );
  assert.equal(await page.evaluate(() => window.paymentTest.counts.googlePay), beforeContactEdit.googlePay + 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: persistent rows, independent wallet instances, updated totals, stale Cash App rejection",
  );
} finally {
  await browser.close();
}
