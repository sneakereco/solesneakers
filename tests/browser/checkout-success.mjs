// Run: node tests/browser/checkout-success.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import CheckoutSuccessPage from './src/app/checkout/success/page';
      window.cartClears = 0;
      createRoot(document.getElementById('root')).render(<CheckoutSuccessPage />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "checkout-boundaries",
      setup(builder) {
        builder.onResolve(
          { filter: /^next\/navigation$|^@\/components\/cart\/CartProvider$/ },
          (args) => ({ path: args.path, namespace: "test" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/navigation"
              ? `
          import { useSyncExternalStore } from 'react';
          const subscribe = callback => {
            window.addEventListener('popstate', callback);
            return () => window.removeEventListener('popstate', callback);
          };
          const router = { push: href => {
            history.pushState({}, '', href);
            window.dispatchEvent(new PopStateEvent('popstate'));
          } };
          export const useRouter = () => router;
          export const useSearchParams = () => new URLSearchParams(
            useSyncExternalStore(subscribe, () => location.search)
          );
        `
              : `
          const clearCart = () => { window.cartClears++; };
          export const useCart = () => ({ clearCart });
        `,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const orderTokens = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://checkout.test") {
      errors.push(`Unexpected external request: ${url.origin}`);
      return route.abort();
    }
    if (url.pathname === "/checkout/success") {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
    if (url.pathname === "/api/auth/session") {
      return route.fulfill({ json: { user: null } });
    }
    if (url.pathname === "/api/orders/test-order") {
      orderTokens.push(url.searchParams.get("token"));
      return route.fulfill({
        json: {
          id: "test-order",
          status: "paid",
          fulfillment: "ship",
          subtotal: 100,
          shipping: 10,
          tax: 5,
          total: 115,
        },
      });
    }
    errors.push(`Unexpected request: ${url.pathname}`);
    return route.abort();
  });
  await page.goto("https://checkout.test/checkout/success?orderId=test-order");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByText(/We could not load the full order details/).waitFor();
  assert.deepEqual(orderTokens, [], "Denied session must not fetch order details");
  await page.evaluate(() => {
    history.pushState({}, "", "/checkout/success?orderId=test-order&token=valid-token");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("heading", { name: "Order Details", exact: true }).waitFor();
  assert.equal(await page.getByText("$115.00", { exact: true }).count(), 1);
  assert.deepEqual(orderTokens, ["valid-token"]);
  assert.equal(
    await page.evaluate(() => window.cartClears),
    1,
    "Recovery must reuse the mounted page",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: denied checkout session recovers paid order details when a valid token arrives without remounting",
  );
} finally {
  await browser.close();
}
