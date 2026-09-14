// Run: node tests/browser/shipping-validation.mjs
// Real checkout UI; replace provider responses and cart/session data only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
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
    import { CheckoutClient } from './src/components/checkout/CheckoutClient';
    const original = { name: 'Test Buyer', phone: '2025550100', line1: '1600 Pennsylvania Avenue NW', line2: '', city: 'Washington', state: 'DC', postalCode: '20500', country: 'US' };
    window.test = { tokenized: 0, original };
    window.Square = { payments: () => ({
      card: async () => ({ attach: async () => {}, tokenize: async () => { window.test.tokenized++; return { status: 'INVALID', errors: [{ field: 'cardNumber' }] }; } }),
      paymentRequest: () => ({ listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, update: () => true }),
      applePay: async () => ({ tokenize: async () => ({ status: 'CANCEL' }) }),
      googlePay: async (request) => ({ attach: async selector => { document.querySelector(selector).innerHTML = '<button type="button">Google test</button>'; }, tokenize: async () => { window.test.walletQuote = await request.listeners.shippingcontactchanged({countryCode:'US',state:original.state,postalCode:original.postalCode}); return ({ status: 'OK', token: 'test', details: { billing: { givenName: 'Test', familyName: 'Buyer', email: 'buyer@example.com', addressLines: ['2 Billing St'], city: 'Washington', state: 'DC', postalCode: '20001', countryCode: 'US' }, shipping: { contact: { givenName: 'Test', familyName: 'Buyer', phone: '2025550100', addressLines: [original.line1], city: original.city, state: original.state, postalCode: original.postalCode, countryCode: 'US' } } } }); } }),
      afterpayClearpay: async () => ({ attach: async () => {}, tokenize: async () => ({ status: 'CANCEL' }) }),
      cashAppPay: async () => ({ attach: async () => {}, addEventListener() {} }),
    }) };
    createRoot(document.getElementById('root')).render(<CheckoutClient initialData={{ isGuest: false, customer: { email: 'buyer@example.com', address: original }, paymentConfig: { applicationId: 'test', locationId: 'test', environment: 'sandbox' } }} />);
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
              /^@\/(config\/client-env|lib\/utils\/log|components\/cart\/CartProvider|contexts\/SessionContext)$/,
          },
          (args) => ({ path: args.path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          loader: "js",
          contents: args.path.endsWith("CartProvider")
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
              route.request().postDataJSON().shippingAddress?.postalCode === "20500-0005"
                ? 100
                : 0,
            totalCents:
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
      if (body.paymentMethod === "googlePay" || body.paymentMethod === "applePay") {
        await new Promise((resolve) => {
          releasePrepare = resolve;
        });
        return route.fulfill({ json: { orderId: "test-order", totals } });
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
          },
        });
      return route.fulfill({ json: { orderId: "test-order", totals } });
    }
    if (path === "/api/checkout/payment-permit")
      return route.fulfill({ json: { permit: "test" } });
    if (path === "/api/checkout/pay") {
      payCalls++;
      await new Promise((resolve) => {
        releasePay = resolve;
      });
      if (formattingOnly)
        return route.fulfill({
          json: { statusUrl: "/checkout/processing?orderId=test-order" },
        });
      return route.fulfill({ status: 400, json: { error: "payment test boundary" } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  const load = async () => {
    await page.goto("https://checkout.test/checkout");
    await page.addStyleTag({ content: styles.css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Pay $110.00 now" }).waitFor();
  };
  await load();
  await page.getByLabel("Name on card", { exact: true }).fill("Test Buyer");
  await page.getByRole("button", { name: "Pay $110.00 now" }).click();
  await page.getByRole("button", { name: "Use suggested address" }).waitFor();
  await mkdir("test-results/shipping-validation", { recursive: true });
  await page
    .getByRole("dialog")
    .screenshot({ path: "test-results/shipping-validation/correction.png" });
  assert.equal(await page.evaluate(() => window.test.tokenized), 0);
  assert.equal(payCalls, 0);
  await page.getByRole("button", { name: "Use suggested address" }).click();
  assert.equal(
    await page.getByLabel("Address", { exact: true }).inputValue(),
    "1602 Pennsylvania Ave NW",
  );
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await page.getByRole("button", { name: "Pay $111.00 now" }).waitFor();
  await page.getByRole("button", { name: "Pay $111.00 now" }).click();
  await page.waitForFunction(() => window.test.tokenized === 1);
  assert.equal(prepares.at(-1).shippingAddress.postalCode, "20500-0005");
  assert.equal(prepares.at(-1).billingAddress.postalCode, "20500-0005");
  assert.ok(quotes.some((q) => q.shippingAddress?.postalCode === "20500-0005"));
  // Wallet details remain private to this attempt while the processing overlay stays open.
  await load();
  await page.evaluate(() => {
    window.test.original.line1 = "9 Wallet Road";
  });
  await page.getByRole("button", { name: "Google test" }).click();
  await page.getByRole("heading", { name: "Processing your payment" }).waitFor();
  await expect.poll(() => Boolean(releasePrepare)).toBe(true);
  assert.equal(
    await page.getByLabel("Address", { exact: true }).inputValue(),
    "1600 Pennsylvania Avenue NW",
  );
  assert.equal(payCalls, 0);
  assert.equal(
    await page.getByRole("button", { name: "Use suggested address" }).count(),
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
  releasePay();
  await page.waitForURL("**/checkout/processing?orderId=test-order");
  assert.equal(payCalls, 1);
  console.log(
    "PASS: card correction preserved; express processes without form autofill or address review and submits one payment",
  );
} finally {
  await browser.close();
}
