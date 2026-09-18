// Run: node tests/browser/shipping-validation.mjs
// Real checkout UI; replace provider responses and cart/session data only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const validationBundle = await build({
  entryPoints: ["src/lib/shipping/validate-shipping-address.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { validateShippingAddress } = await import(
  `data:text/javascript;base64,${Buffer.from(validationBundle.outputFiles[0].text).toString("base64")}`
);

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import { createRoot } from 'react-dom/client';
      import { CheckoutPaymentProvider } from './src/components/checkout/CheckoutPaymentDialog';
    import { CheckoutClient } from './src/components/checkout/CheckoutClient';
    const original = { name: 'Test Buyer', phone: '2025550100', line1: '1600 Pennsylvania Avenue NW', line2: '', city: 'Washington', state: 'DC', postalCode: '20500', country: 'US' };
    window.test = { tokenized: 0, original };
    window.Square = { payments: () => ({
      card: async () => ({ attach: async () => {}, tokenize: async (details) => { window.test.tokenized++; window.test.cardDetails = details; return { status: 'OK', token: 'card-test' }; } }),
      paymentRequest: (input) => ({ input, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, update(value) { Object.assign(this.input, value); return true; } }),
      applePay: async (request) => ({ tokenize: async () => { window.test.walletTokenizations = (window.test.walletTokenizations || 0) + 1; window.test.walletQuote = await request.listeners.shippingcontactchanged({countryCode:'US',state:original.state,postalCode:original.postalCode}); return ({ status: 'OK', token: 'test', details: { billing: { givenName: 'Test', familyName: 'Buyer', email: 'buyer@example.com', addressLines: ['2 Billing St'], city: 'Washington', state: 'DC', postalCode: '20001', countryCode: 'US' }, shipping: { contact: { givenName: 'Test', familyName: 'Buyer', phone: window.test.omitShippingPhone ? undefined : '2025550100', addressLines: [original.line1], city: original.city, state: original.state, postalCode: original.postalCode, countryCode: 'US' } } } }); } }),
      afterpayClearpay: async (request) => ({ attach: async () => {}, tokenize: async () => { window.test.afterpayRequest = request.input; return { status: 'OK', token: 'afterpay-test', details: { shipping: { contact: request.input.shippingContact } } }; } }),
      cashAppPay: async (request) => { let listener; return { attach: async (selector) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Cash test'; button.onclick = () => { window.test.cashTotal = request.input.total.amount; listener({ detail: { tokenResult: { status: 'OK', token: 'cash-' + request.input.total.amount } } }); }; document.querySelector(selector).append(button); }, addEventListener(event, callback) { listener = callback; }, destroy: async () => true }; },
    }) };
    createRoot(document.getElementById('root')).render(<CheckoutPaymentProvider><CheckoutClient initialData={{ isGuest: false, customer: { email: 'buyer@example.com', address: original }, paymentConfig: { applicationId: 'test', locationId: 'test', environment: 'sandbox' } }} /></CheckoutPaymentProvider>);
  `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^next\/navigation$|^@\/(config\/client-env|lib\/utils\/log|components\/cart\/CartProvider|contexts\/SessionContext)$/,
          },
          (args) => ({ path: args.path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          loader: "js",
          contents:
            args.path === "next/navigation"
              ? 'const router = { replace: url => history.replaceState({}, "", url) }; export const useRouter = () => router;'
              : args.path.endsWith("CartProvider")
                ? "const items = [{productId:'11111111-1111-4111-8111-111111111111',variantId:'22222222-2222-4222-8222-222222222222',titleDisplay:'Test shoes',quantity:1,priceCents:10000}]; export const useCart = () => ({items,itemCount:1,isReady:true,clearCart(){}});"
                : args.path.endsWith("SessionContext")
                  ? "export const useSession = () => ({user:null});"
                  : args.path.endsWith("client-env")
                    ? "export const clientEnv = {};"
                    : "export const log = () => {};",
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
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const prepares = [];
  const quotes = [];
  let payCalls = 0;
  let formattingOnly = false;
  let changeTotal = true;
  let paymentBody;
  let releaseAddressValidation;
  let holdAddressValidation = true;
  let releasePrepare;
  let releasePay;
  const totals = {
    subtotalCents: 10000,
    shippingCents: 1000,
    taxCents: 0,
    totalCents: 11000,
  };
  await page.route("https://checkout.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/checkout/quote") {
      quotes.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          completeness: "exact",
          quoteFingerprint: "a".repeat(64),
          totals: {
            ...totals,
            taxCents:
              changeTotal &&
              route.request().postDataJSON().shippingAddress?.postalCode === "20500-0005"
                ? 100
                : 0,
            totalCents:
              changeTotal &&
              route.request().postDataJSON().shippingAddress?.postalCode === "20500-0005"
                ? 11100
                : 11000,
          },
        },
      });
    }
    if (path === "/api/checkout/prepare") {
      const body = route.request().postDataJSON();
      prepares.push(body);
      if (body.paymentMethod === "applePay") {
        await new Promise((resolve) => {
          releasePrepare = resolve;
        });
        return route.fulfill({ json: { orderId: "test-order", totals } });
      }
      if (
        body.shippingAddressOverride === true &&
        body.shippingConfirmation === "entered-confirmation"
      ) {
        return route.fulfill({ json: { orderId: "test-order", totals } });
      }
      if (holdAddressValidation) {
        holdAddressValidation = false;
        await new Promise((resolve) => {
          releaseAddressValidation = resolve;
        });
      }
      const validation = await validateShippingAddress(
        body.shippingAddress,
        "test",
        async () =>
          new Response(
            JSON.stringify({
              analysis: { validation_result: { value: "valid" } },
              recommended_address: {
                address_line_1: body.shippingAddress.line1.includes("Avenue")
                  ? `${formattingOnly ? "1600" : "1602"} Pennsylvania Ave NW`
                  : body.shippingAddress.line1,
                address_line_2: body.shippingAddress.line2,
                city_locality: body.shippingAddress.city,
                state_province: body.shippingAddress.state,
                postal_code: "20500-0005",
                country_code: "US",
                confidence_result: { score: "high" },
              },
            }),
          ),
      );
      if (validation.status === "suggestion")
        return route.fulfill({
          status: 422,
          json: {
            code: "SHIPPING_ADDRESS_SUGGESTION",
            error:
              "Please confirm the suggested shipping address. You have not been charged.",
            suggestedAddress: validation.address,
            shippingConfirmation: "suggested-confirmation",
            enteredShippingConfirmation: "entered-confirmation",
          },
        });
      return route.fulfill({
        json: {
          orderId: "test-order",
          totals: {
            ...totals,
            taxCents: changeTotal ? 100 : 0,
            totalCents: changeTotal ? 11100 : 11000,
          },
        },
      });
    }
    if (path === "/api/checkout/payment-permit")
      return route.fulfill({ json: { permit: "test" } });
    if (path === "/api/checkout/pay") {
      payCalls++;
      paymentBody = route.request().postDataJSON();
      await new Promise((resolve) => {
        releasePay = resolve;
      });
      return route.fulfill({
        json: { statusUrl: "/checkout/processing?orderId=test-order" },
      });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  const load = async () => {
    payCalls = 0;
    releasePay = undefined;
    releasePrepare = undefined;
    await page.goto("https://checkout.test/checkout");
    await page.addStyleTag({ content: styles.css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Pay $110.00 now" }).waitFor();
  };
  const finishPayment = async () => {
    await page.evaluate(() => {
      window.test.spinner = document.querySelector("dialog .animate-spin");
    });
    releasePay();
    await page.waitForURL("**/checkout/processing?orderId=test-order");
    assert.equal(
      await page.evaluate(
        () =>
          window.test?.spinner === document.querySelector("dialog .animate-spin") &&
          window.test.spinner.isConnected,
      ),
      true,
      "Payment acceptance and cart clearing preserve the same spinner without a document reload",
    );
  };
  await load();
  await page.getByLabel("Name on card", { exact: true }).fill("Test Buyer");
  await page.getByRole("button", { name: "Pay $110.00 now" }).click();
  await expect.poll(() => Boolean(releaseAddressValidation)).toBe(true);
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Address validation finishes before the processing dialog opens",
  );
  releaseAddressValidation();
  await page.getByRole("button", { name: "Accept suggested address" }).waitFor();
  await mkdir("test-results/shipping-validation", { recursive: true });
  await page
    .getByRole("dialog")
    .screenshot({ path: "test-results/shipping-validation/correction.png" });
  assert.equal(await page.evaluate(() => window.test.tokenized), 0);
  assert.equal(payCalls, 0);
  assert.equal(await page.getByRole("button", { name: "Edit address" }).count(), 0);
  await page.getByRole("button", { name: "Accept suggested address" }).click();
  await page.getByRole("button", { name: "Confirm $111.00 and continue" }).waitFor();
  assert.equal(await page.evaluate(() => window.test.tokenized), 0);
  await page.getByRole("button", { name: "Confirm $111.00 and continue" }).click();
  await page.waitForFunction(() => window.test.tokenized === 1);
  assert.equal(prepares.at(-1).shippingAddress.postalCode, "20500-0005");
  assert.equal(prepares.at(-1).billingAddress.postalCode, "20500-0005");
  assert.ok(quotes.some((q) => q.shippingAddress?.postalCode === "20500-0005"));
  await expect.poll(() => Boolean(releasePay)).toBe(true);
  assert.equal(await page.evaluate(() => window.test.cardDetails.amount), "111.00");
  assert.equal(payCalls, 1);
  await finishPayment();

  // The entered address can be used without looping through the suggestion again.
  await load();
  await page.getByLabel("Name on card", { exact: true }).fill("Test Buyer");
  await page.getByRole("button", { name: "Pay $110.00 now" }).click();
  await page.getByRole("button", { name: "Continue with address I entered" }).click();
  await expect.poll(() => Boolean(releasePay)).toBe(true);
  assert.equal(prepares.at(-1).shippingAddress.line1, "1600 Pennsylvania Avenue NW");
  assert.equal(prepares.at(-1).shippingAddressOverride, true);
  assert.equal(prepares.at(-1).shippingConfirmation, "entered-confirmation");
  assert.equal(payCalls, 1);
  await finishPayment();

  // With the same total, acceptance alone continues; duplicate clicks cannot charge twice.
  changeTotal = false;
  await load();
  await page.getByLabel("Name on card", { exact: true }).fill("Test Buyer");
  await page.getByRole("button", { name: "Pay $110.00 now" }).click();
  await page
    .getByRole("button", { name: "Accept suggested address" })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await expect.poll(() => Boolean(releasePay)).toBe(true);
  assert.equal(payCalls, 1);
  assert.equal(await page.evaluate(() => window.test.tokenized), 1);
  await finishPayment();

  // Cash App reauthorizes a changed amount inside the dialog using a fresh source token.
  changeTotal = true;
  await load();
  await page.getByRole("radio", { name: "Afterpay", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Afterpay", exact: true }).click();
  await page.getByRole("button", { name: "Accept suggested address" }).click();
  await page.getByRole("button", { name: "Confirm $111.00 and continue" }).click();
  await expect.poll(() => Boolean(releasePay)).toBe(true);
  assert.equal(
    await page.evaluate(() => window.test.afterpayRequest.total.amount),
    "111.00",
  );
  assert.equal(
    await page.evaluate(() => window.test.afterpayRequest.shippingContact.postalCode),
    "20500-0005",
  );
  assert.equal(payCalls, 1);
  await finishPayment();

  await load();
  await page.getByRole("radio", { name: "Cash App Pay", exact: true }).click();
  await page.getByRole("button", { name: "Cash test" }).click();
  await page.getByRole("button", { name: "Accept suggested address" }).click();
  await page.getByRole("button", { name: "Confirm $111.00 and continue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cash test" }).click();
  await expect.poll(() => Boolean(releasePay)).toBe(true);
  assert.equal(paymentBody.sourceId, "cash-111.00");
  assert.equal(payCalls, 1);
  await finishPayment();
  // Wallet details remain private to this attempt while the processing overlay stays open.
  await load();
  await page.evaluate(() => {
    window.test.original.line1 = "9 Wallet Road";
    window.test.omitShippingPhone = true;
  });
  await page.getByRole("button", { name: "Pay with Apple Pay" }).click();
  await page.getByRole("heading", { name: "Complete your checkout details" }).waitFor();
  assert.equal(payCalls, 0);
  await page.getByRole("dialog").getByLabel("Shipping phone").fill("2025550100");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(await page.evaluate(() => window.test.walletTokenizations), 1);
  await page.getByRole("heading", { name: "Processing your payment" }).waitFor();
  await expect.poll(() => Boolean(releasePrepare)).toBe(true);
  assert.equal(
    await page.getByLabel("Address", { exact: true }).inputValue(),
    "1600 Pennsylvania Avenue NW",
  );
  assert.equal(payCalls, 0);
  assert.equal(
    await page.getByRole("button", { name: "Accept suggested address" }).count(),
    0,
  );
  releasePrepare();
  await expect.poll(() => Boolean(releasePay)).toBe(true);
  await page.getByRole("heading", { name: "Processing your payment" }).waitFor();
  assert.equal(prepares.at(-1).shippingAddress.line1, "9 Wallet Road");
  assert.equal(prepares.at(-1).billingAddress.postalCode, "20001");
  await page
    .getByRole("dialog")
    .screenshot({ path: "test-results/shipping-validation/express-processing.png" });
  formattingOnly = true;
  await finishPayment();
  assert.equal(payCalls, 1);
  // An incomplete wallet destination cannot use the wallet-only address exception.
  await load();
  const preparesBeforeMissingStreet = prepares.length;
  await page.evaluate(() => {
    window.test.original.line1 = "";
    window.test.omitShippingPhone = true;
  });
  await page.getByRole("button", { name: "Pay with Apple Pay" }).click();
  await page
    .getByText("Choose a complete US shipping address in your wallet.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Shipping street address").count(), 0);
  assert.equal(prepares.length, preparesBeforeMissingStreet);
  assert.equal(payCalls, 0);
  console.log(
    "PASS: address acceptance, editing, cancellation, changed totals, duplicate clicks, Afterpay and Cash App continuation; express bypass preserved",
  );
} finally {
  await browser.close();
}
