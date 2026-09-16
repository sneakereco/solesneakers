// Run: node tests/browser/checkout-progress.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import Layout from './src/app/checkout/layout';
      import Processing from './src/app/checkout/processing/page';
      import Success from './src/app/checkout/success/page';
      import Cancel from './src/app/checkout/cancel/page';
      import { CheckoutPaymentDialog } from './src/components/checkout/CheckoutPaymentDialog';
      function Submitted() { return <CheckoutPaymentDialog open />; }
      function Harness() {
        const [route, setRoute] = useState('submitted');
        window.navigate = url => { history.replaceState({}, '', url); setRoute(url.includes('/success') ? 'success' : url.includes('/cancel') ? 'cancel' : url.includes('/processing') ? 'processing' : 'submitted'); };
        return <Layout>{route === 'cancel' ? <Cancel /> : route === 'submitted' ? <Submitted /> : route === 'processing' ? <Processing /> : <Success />}</Layout>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "boundaries",
      setup(builder) {
        builder.onResolve(
          { filter: /^next\/navigation$|^@\/components\/cart\/CartProvider$/ },
          (args) => ({ path: args.path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          loader: "js",
          contents:
            args.path === "next/navigation"
              ? `const router = { replace: url => window.navigate(url), push: url => window.navigate(url) }; export const useRouter = () => router; export const useSearchParams = () => new URLSearchParams(location.search);`
              : `export const useCart = () => ({ clearCart: () => {} });`,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let statusRequests = 0;
  let releaseStatus;
  let releaseDetails;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/checkout")
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    if (url.pathname === "/api/auth/session")
      return route.fulfill({ json: { user: { id: "buyer" } } });
    if (url.pathname.startsWith("/api/orders/")) {
      statusRequests++;
      await new Promise((resolve) => {
        if (statusRequests === 1) releaseStatus = resolve;
        else releaseDetails = resolve;
      });
      return route.fulfill({
        json: {
          id: "test-order",
          status: "paid",
          fulfillment: "pickup",
          subtotal: 100,
          shipping: 0,
          tax: 8,
          total: 108,
        },
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  await page.goto("https://checkout.test/checkout?orderId=test-order");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page
    .getByRole("heading", { name: "Processing your payment", exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.originalSpinner = document.querySelector("dialog .animate-spin");
    window.originalDialog = document.querySelector("dialog");
    window.navigate("/checkout/processing?orderId=test-order");
  });
  await page.waitForFunction(() => location.pathname.endsWith("/processing"));
  await page.waitForTimeout(100);
  const unchanged = () =>
    page.evaluate(
      () =>
        window.originalSpinner === document.querySelector("dialog .animate-spin") &&
        window.originalSpinner.isConnected &&
        window.originalDialog.open,
    );
  assert.equal(
    await unchanged(),
    true,
    "The SAME spinner must survive checkout -> processing",
  );
  await expect.poll(() => Boolean(releaseStatus)).toBe(true);
  releaseStatus();
  await page.waitForFunction(() => location.pathname.endsWith("/success"));
  await expect.poll(() => Boolean(releaseDetails)).toBe(true);
  assert.equal(
    await unchanged(),
    true,
    "The SAME spinner must survive processing -> success details loading",
  );
  assert.match(
    await page.locator("#checkout-payment-description").innerText(),
    /process your payment and confirm your order/,
  );
  releaseDetails();
  await page.getByRole("heading", { name: "Order Confirmed!", exact: true }).waitFor();
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Confirmed details dismiss the loader",
  );
  await page.evaluate(() => window.navigate("/checkout"));
  await page
    .getByRole("heading", { name: "Processing your payment", exact: true })
    .waitFor();
  await page.evaluate(() => window.navigate("/checkout/cancel"));
  await page.getByRole("heading", { name: "Checkout Canceled", exact: true }).waitFor();
  assert.equal(
    await page.locator("dialog[open]").count(),
    0,
    "Cancellation clears retained progress",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: a single mounted spinner and message persist until confirmed order details are ready",
  );
} finally {
  await browser.close();
}
