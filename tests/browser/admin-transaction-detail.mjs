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
      import TransactionsPage from './src/app/admin/transactions/page';
      createRoot(document.getElementById('root')).render(
        location.pathname === '/admin/transactions' ? <TransactionsPage /> : <TransactionDetailPage />
      );
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
    if (
      url.pathname === "/admin/transactions/12345678-test-order" ||
      url.pathname === "/admin/transactions"
    ) {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
    if (url.pathname === "/api/admin/orders") {
      return route.fulfill({
        json: {
          count: 5,
          orders: ["applePay", "googlePay", "card", "afterpay", "cashAppPay"].map(
            (method, index) => ({
              id: `order-${index}`,
              status: "paid",
              created_at: "2026-09-18T12:00:00Z",
              fulfillment: "pickup",
              total: 10,
              payment_transaction_id: `payment-${index}`,
              payment: [
                { square_payment_id: "older-attempt", card_type: "WRONG" },
                { square_payment_id: `payment-${index}`, payment_method: method },
              ],
            }),
          ),
        },
      });
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
          paymentTransaction: {
            id: "payment-1",
            payment_method: "applePay",
            card_type: "VISA",
            card_last4: "1111",
            avs_result_code: "AVS_ACCEPTED",
            cvv2_result_code: "CVV_NOT_CHECKED",
          },
          paymentEvents: [],
          emailLogs: [],
        },
      });
    }
    return route.abort();
  });

  await page.goto("https://admin.test/admin/transactions/12345678-test-order");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("heading", { name: "Payment Method" }).waitFor({ timeout: 5_000 });
  assert.equal(await page.getByText("Apple Pay", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Address verified", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Not checked", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("heading", { name: "Session Activity" }).count(), 0);
  console.log("PASS: transaction detail omits session activity");
  await page.goto("https://admin.test/admin/transactions");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("cell", { name: "Apple Pay", exact: true }).waitFor();
  for (const method of [
    "Apple Pay",
    "Google Pay",
    "Credit card",
    "Afterpay",
    "Cash App Pay",
  ]) {
    assert.equal(await page.getByRole("cell", { name: method, exact: true }).count(), 1);
  }
  assert.equal(await page.getByText("WRONG", { exact: true }).count(), 0);
  console.log("PASS: transaction list shows all five methods from the matching payment");
} finally {
  await browser.close();
}
