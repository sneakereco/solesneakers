import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import TransactionDetailPage from './src/app/admin/transactions/[orderId]/page';
      createRoot(document.getElementById('root')).render(<TransactionDetailPage />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "admin-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(image|navigation)$/ }, (args) => ({
          path: args.path,
          namespace: "test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/image"
              ? `import React from 'react'; export default props => React.createElement('img', props);`
              : `
                  export const useParams = () => ({ orderId: '12345678-test-order' });
                  export const useRouter = () => ({ push() {} });
                `,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error.message));
  await page.addInitScript(() => {
    window.process = { env: { NODE_ENV: "development" } };
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/admin/transactions/12345678-test-order") {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
    if (url.pathname === "/api/admin/transactions/12345678-test-order") {
      return route.fulfill({
        json: {
          order: {
            id: "12345678-test-order",
            status: "paid",
            total: 100,
            subtotal: 100,
            shipping: 0,
            tax_amount: 0,
            fulfillment: "pickup",
            created_at: "2026-09-16T12:00:00Z",
            updated_at: "2026-09-16T12:00:00Z",
            guest_email: "buyer@example.com",
            items: [],
          },
          paymentTransaction: { id: "payment-1", card_type: "VISA", card_last4: "1111" },
          paymentEvents: [],
          emailLogs: [],
          trackingEvents: [],
          checkoutLogs: [],
        },
      });
    }
    return route.abort();
  });

  await page.goto("https://admin.test/admin/transactions/12345678-test-order");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("heading", { name: "Payment Method" }).waitFor({ timeout: 5_000 });
  assert.equal(await page.getByRole("heading", { name: "Session Activity" }).count(), 0);
  console.log("PASS: transaction detail omits session activity");
} finally {
  await browser.close();
}
