// Run: node tests/browser/checkout-ui.mjs
// Real checkout components and browser validation; only external services are replaced.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import nextEnv from "@next/env";

const liveSquare = process.argv.includes("--live-square");
let squareConfig;
if (liveSquare) {
  nextEnv.loadEnvConfig(process.cwd());
  assert.equal(process.env.SQUARE_ENVIRONMENT, "sandbox", "Live UI checks require Sandbox");
  squareConfig = { applicationId: process.env.SQUARE_APPLICATION_ID, locationId: process.env.SQUARE_LOCATION_ID, environment: "sandbox" };
  assert.ok(squareConfig.applicationId && squareConfig.locationId);
}

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { SquarePaymentMethods } from './src/components/checkout/SquarePaymentMethods';
      import { CheckoutContactSection } from './src/components/checkout/CheckoutContactSection';
      import { CheckoutDeliverySection } from './src/components/checkout/CheckoutDeliverySection';
      const test = window.checkoutTest = { listeners: {}, created: 0, prepared: 0, tokenized: [], focused: null };
      window.Square = { payments: () => ({
        card: async options => { test.created++; if (window.realSquarePayments) return window.realSquarePayments.card(options); return {
          attach: async selector => { document.querySelector(selector).innerHTML = '<div style="border:1px solid #dedede;border-radius:12px;padding:16px;background:white">Secure card number<br/><hr style="margin:16px -16px"/>MM/YY &nbsp;&nbsp;&nbsp;&nbsp; CVV</div>'; },
          addEventListener: (name, callback) => { test.listeners[name] = callback; },
          removeEventListener: name => { delete test.listeners[name]; },
          focus: async name => { test.focused = name; return true; },
          recalculateSize: () => {}, destroy: async () => true,
          tokenize: async () => { test.tokenized.push('card'); return { status: 'INVALID', errors: [{ field: 'cardNumber', message: 'Invalid card' }] }; }
        }; },
        paymentRequest: () => ({ addEventListener() {}, update: () => true }),
        applePay: async () => ({ tokenize: async () => { test.tokenized.push('apple'); return { status: 'CANCEL' }; } }),
        googlePay: async () => ({ attach: async selector => { document.querySelector(selector).innerHTML = '<button type="button">Google Pay test</button>'; }, tokenize: async () => { test.tokenized.push('google'); return { status: 'CANCEL' }; } }),
        afterpayClearpay: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'CANCEL' }) }),
        cashAppPay: async (_, options) => ({ attach: async selector => { document.querySelector(selector).innerHTML = '<button type="button">Cash App test</button>'; test.shouldTokenize = options.shouldTokenize; }, addEventListener() {} }),
      }) };
      function Harness() {
        const [email, setEmail] = useState('');
        const [fulfillment, setFulfillment] = useState('ship');
        const [address, setAddress] = useState({ name: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US' });
        return <div data-checkout style={{ maxWidth: 680, margin: "auto" }} className="bg-[#f3f3f3] p-6"><div className="flex flex-col">
          <SquarePaymentMethods paymentConfig={window.squareTestConfig ?? { applicationId: 'sandbox-test', locationId: 'test', environment: 'sandbox' }}
            quote={{ completeness: 'exact', quoteFingerprint: 'a'.repeat(64), totals: { subtotalCents: 10000, shippingCents: 1000, taxCents: 0, totalCents: 11000 } }}
            quoteReady={true} fulfillment={fulfillment} buyerEmail={email} shippingAddress={address.line1 && address.postalCode ? address : null}
            isGuest={false} prepare={async () => { test.prepared++; if (test.allowPrepare) return { orderId: 'test-order', deviceSessionId: 'test-device', totals: { subtotalCents: 10000, shippingCents: 1000, taxCents: 0, totalCents: 11000 } }; throw new Error('prepare test boundary'); }}
            clearCart={() => {}} quoteWalletShippingDestination={async () => { throw new Error('unused'); }} resolveWalletShippingContact={async () => { throw new Error('unused'); }}>
            <CheckoutContactSection email={email} isGuest={true} onEmailChange={setEmail} />
            <CheckoutDeliverySection fulfillment={fulfillment} address={address} onFulfillmentChange={setFulfillment} onAddressChange={(field, value) => setAddress(old => ({ ...old, [field]: value }))} />
          </SquarePaymentMethods>
        </div></div>;
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
      name: "external-services",
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
const styles = await postcss([
  tailwindcss({
    content: ["./src/components/checkout/**/*.{ts,tsx}"],
    corePlugins: { preflight: true },
  }),
]).process(await readFile("src/styles/site.css", "utf8"), {
  from: "src/styles/site.css",
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  const errors = [];
  let payRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://checkout.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/checkout/payment-permit") {
      await route.fulfill({ json: { permit: "test-permit" } });
    } else if (pathname === "/api/checkout/pay") {
      payRequests++;
      await route.fulfill({ status: 400, json: { error: "test payment boundary" } });
    } else if (pathname.startsWith("/images/payments/")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: await readFile(`public${pathname}`),
      });
    } else
      await route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://checkout.test/checkout");
  await page.addStyleTag({ content: styles.css });
  if (liveSquare) {
    await page.addScriptTag({ url: "https://sandbox.web.squarecdn.com/v1/square.js" });
    await page.evaluate(config => {
      window.squareTestConfig = config;
      window.realSquarePayments = window.Square.payments(config.applicationId, config.locationId);
    }, squareConfig);
  }
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  if (liveSquare) {
    await page.locator("#square-card-container iframe").first().waitFor({ timeout: 30000 });
    const frame = page.frameLocator("#square-card-container iframe").first();
    const number = frame.getByPlaceholder("Card number", { exact: true });
    await number.fill("1");
    await frame.getByPlaceholder("MM/YY", { exact: true }).focus();
    await frame.getByText("Enter a valid card number.", { exact: true }).waitFor();
    await page.getByText("Enter a valid card number", { exact: true }).waitFor({state: "hidden"});
    await mkdir("test-results/checkout-ui", { recursive: true });
    await page.locator('[aria-labelledby="payment-heading"]').screenshot({ path: "test-results/checkout-ui/square-error.png", animations: "disabled" });
    await number.fill("4111111111111111");
    await frame.getByPlaceholder("MM/YY", { exact: true }).fill("1299");
    await frame.getByPlaceholder("CVV", { exact: true }).fill("111");
    const zip = frame.getByPlaceholder("ZIP", { exact: true });
    if (await zip.isVisible()) await zip.fill("19801");
    await page.getByLabel("Name on card", { exact: true }).fill("Sandbox Buyer");
    assert.equal(await page.getByRole("img", { name: "Visa", exact: true }).count(), 1);
    assert.equal(await page.getByRole("img", { name: "Mastercard", exact: true }).count(), 0);
    assert.equal(await page.getByText("Enter a valid card number", { exact: true }).count(), 0);
    await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
    await page.getByRole("radio", { name: "Credit card", exact: true }).click();
    assert.equal((await number.inputValue()).replace(/\s/g, ""), "4111111111111111");
    await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
    await page.locator('[aria-labelledby="payment-heading"]').screenshot({ path: "test-results/checkout-ui/afterpay.png", animations: "disabled" });
    await page.getByRole("radio", { name: "Credit card", exact: true }).click();
    // No payment requests: UI inspection uses only published Sandbox test card data.
    await mkdir("test-results/checkout-ui", { recursive: true });
    await page.screenshot({ path: "test-results/checkout-ui/square-live-desktop.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    if (liveSquare) { await number.waitFor({state: "visible"});  }
    await page.screenshot({ path: "test-results/checkout-ui/square-live-mobile.png", fullPage: true, animations: "disabled" });
    await page.locator('[aria-labelledby="payment-heading"]').screenshot({ path: "test-results/checkout-ui/square-payment-mobile.png", animations: "disabled" });
    assert.deepEqual(errors, []);
    console.log("PASS: real Sandbox iframe styles, blur errors, card detection and input preservation");
  } else {

  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await email.waitFor();
  assert.equal(await email.getAttribute("aria-invalid"), null);
  await email.focus();
  await page.getByRole("textbox", { name: "First name", exact: true }).focus();
  assert.equal(
    await email.getAttribute("aria-invalid"),
    "true",
    "empty email must show an inline error after blur",
  );
  await email.fill("buyer@example.com");
  assert.notEqual(await email.getAttribute("aria-invalid"), "true");
  await email.fill("");
  await email.blur();
  assert.equal(await email.getAttribute("aria-invalid"), "true");
  await page.getByRole("button", { name: "Pay $110.00 now", exact: true }).click();
  for (const label of [
    "Email",
    "First name",
    "Last name",
    "Address",
    "City",
    "State",
    "ZIP code",
    "Phone",
    "Name on card",
  ]) {
    assert.equal(
      await page.getByLabel(label, { exact: true }).getAttribute("aria-invalid"),
      "true",
      `${label} must be marked on submit`,
    );
  }
  assert.equal(await page.evaluate(() => window.checkoutTest.prepared), 0);
  assert.equal(await email.evaluate((el) => el === document.activeElement), true);
  await page.getByRole("button", { name: "Google Pay test" }).click();
  await page.waitForFunction(() => window.checkoutTest.tokenized.includes("google"));
  await page
    .getByRole("button", { name: /close|dismiss|return|back|try again/i })
    .first()
    .click();
  const last = page.getByLabel("Last name", { exact: true });
  await last.fill("Buyer");
  assert.equal(
    await last.inputValue(),
    "Buyer",
    "last name must not move into an empty first name",
  );
  await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
  const cashPanel = page.locator('[data-payment-method="cashAppPay"]');
  await cashPanel.getByText("Continue with Cash App Pay to approve your payment.").waitFor({ state: "visible" });
  await page.getByRole("radio", { name: "Credit card", exact: true }).click();
  await page.getByText("Use a different billing address", { exact: true }).click();
  await page.getByLabel("Billing first name", { exact: true }).fill("Bill");
  await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
  assert.equal(
    await page.getByLabel("Billing first name", { exact: true }).inputValue(),
    "Bill",
  );
  const billing = page.getByRole("heading", { name: "Billing address", exact: true });
  assert.equal(
    await billing.evaluate((el) => el.closest('[role="radiogroup"]') === null),
    true,
  );
  await page.getByRole("radio", { name: "Credit card", exact: true }).click();
  await page.evaluate(() =>
    window.checkoutTest.listeners.cardBrandChanged({
      detail: {
        cardBrand: "visa",
        field: "cardNumber",
        currentState: { isEmpty: false, isCompletelyValid: false },
      },
    }),
  );
  assert.equal(await page.getByRole("img", { name: "Visa", exact: true }).count(), 1);
  assert.equal(
    await page.getByRole("img", { name: "Mastercard", exact: true }).count(),
    0,
  );
  await page.evaluate(() =>
    window.checkoutTest.listeners.focusClassRemoved({
      detail: {
        field: "cardNumber",
        currentState: { isEmpty: false, isCompletelyValid: false },
      },
    }),
  );
  assert.equal(
    await page.getByText("Enter a valid card number", { exact: true }).isVisible(),
    true,
  );
  await page.evaluate(() =>
    window.checkoutTest.listeners.errorClassRemoved({
      detail: {
        field: "cardNumber",
        currentState: { isEmpty: false, isCompletelyValid: true },
      },
    }),
  );
  assert.equal(
    await page.getByText("Enter a valid card number", { exact: true }).count(),
    0,
  );
  await page.evaluate(() =>
    window.checkoutTest.listeners.cardBrandChanged({
      detail: {
        cardBrand: "OTHER_BRAND",
        field: "cardNumber",
        currentState: { isEmpty: true, isCompletelyValid: false },
      },
    }),
  );
  const more = page.getByRole("button", { name: "Show 4 more accepted card brands" });
  await more.click();
  assert.equal(
    await page.getByRole("tooltip", { name: "Accepted cards" }).isVisible(),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("tooltip", { name: "Accepted cards" }).isVisible(),
    false,
  );
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  assert.equal(await page.getByLabel("Address", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Ship", exact: true }).click();
  assert.equal(await page.evaluate(() => window.checkoutTest.created), 1);
  await mkdir("test-results/checkout-ui", { recursive: true });
  await page.screenshot({ path: "test-results/checkout-ui/desktop.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/checkout-ui/mobile.png", fullPage: true, animations: "disabled" });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".checkout-collapse")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  // Fill the real page fields, leaving optional apartment and billing phone blank.
  for (const [label, value] of Object.entries({ Email: "buyer@example.com", "First name": "Test", "Last name": "Buyer", Address: "1 Market St", City: "Wilmington", "ZIP code": "19801", Phone: "3025550100", "Name on card": "Test Buyer", "Billing first name": "Bill", "Billing last name": "Buyer", "Billing address": "2 Market St", "Billing city": "Wilmington", "Billing ZIP code": "19801" })) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel("State", { exact: true }).selectOption("DE");
  await page.getByLabel("Billing state", { exact: true }).selectOption("DE");
  await page.evaluate(() => {
    const listeners = window.checkoutTest.listeners;
    for (const field of ["cardNumber", "expirationDate"]) listeners.focusClassRemoved({ detail: { field, currentState: { isEmpty: false, isCompletelyValid: true } } });
    listeners.focusClassAdded({ detail: { field: "cvv", currentState: { isEmpty: true, isCompletelyValid: false } } });
    listeners.submit({ detail: { field: "cvv", currentState: { isEmpty: false, isCompletelyValid: true } } });
  });
  await page.waitForFunction(() => window.checkoutTest.prepared === 1);
  await page.getByRole("button", { name: "Return to checkout" }).click();
  // Autofill may leave stale event metadata. Tokenization owns submit validity.
  await page.evaluate(() => {
    window.checkoutTest.allowPrepare = true;
    window.checkoutTest.listeners.focusClassAdded({ detail: { field: "cvv", currentState: { isEmpty: true, isCompletelyValid: false } } });
  });
  await page.getByLabel("Name on card", { exact: true }).press("Enter");
  await page.waitForFunction(() => window.checkoutTest.tokenized.includes("card"));
  await page.getByText("Enter a valid card number", { exact: true }).waitFor();
  assert.equal(payRequests, 0, "INVALID card tokens cannot reach payment");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: checkout blur/submit errors, express bypass, shared billing, card events, responsive layout and reduced motion",
  );
  }
} finally {
  await browser.close();
}
