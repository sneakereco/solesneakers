import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import { useState } from 'react';
      import { CreateLabelForm } from './src/components/admin/shipping/CreateLabelForm';

      import { RdkSelect } from './src/components/ui/Select';
      import { Toast } from './src/components/ui/Toast';
      import ShippingPage from './src/app/admin/shipping/page';

      const root = createRoot(document.getElementById('root'));
      window.renderShipping = () => root.render(<div data-admin-shell><main data-admin-content><ShippingPage /></main></div>);
      function Harness() {
        const [open, setOpen] = useState(true);
        window.closeLabelForm = () => setOpen(false);
        return (
        <div data-admin-shell="">
          <div data-admin-content="">
            <RdkSelect value="sneakers" buttonClassName="bg-zinc-800" options={[{value:'sneakers',label:'Sneakers'},{value:'clothing',label:'Clothing'}]} onChange={() => {}} />
            <Toast open message="Product save failed" tone="error" durationMs={0} onClose={() => {}} />
            <button id="dark-action" className="bg-zinc-900 text-white">Save</button>
            <button id="light-action" className="bg-white text-zinc-950">Filter</button>
          </div>
          <CreateLabelForm
            open={open}
            order={{
              id: 'order-1',
              shipping: {
                name: 'Test Buyer',
                phone: '5555555555',
                line1: '1 Main St',
                city: 'Greenville',
                state: 'SC',
                postal_code: '29601',
                country: 'US'
              }
            }}
            onClose={() => {}}
            onSuccess={() => {}}
          />
        </div>
      );
      }
      root.render(<Harness />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
});

const css = await readFile("src/styles/site.css", "utf8");
const compiledCss = await postcss([
  tailwindcss({
    content: ["./src/**/*.{ts,tsx}", "./tests/browser/admin-button-contrast.mjs"],
  }),
]).process(css, { from: "src/styles/site.css" });
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error.message));
  await page.route("https://admin.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
  );
  await page.goto("https://admin.test/");
  await page.addStyleTag({
    content: compiledCss.css,
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const getRates = page.getByRole("button", { name: "Get shipping rates" });
  await getRates.waitFor();

  assert.deepEqual(await page.locator("#dark-action").evaluate(readContrast), {
    background: "rgb(9, 9, 11)",
    color: "rgb(255, 255, 255)",
  });
  assert.equal((await page.locator("#light-action").evaluate(readBorder)).width, "1px");
  assert.equal((await getRates.evaluate(readBorder)).color, "rgb(9, 9, 11)");
  await page.evaluate(() => window.closeLabelForm());
  await getRates.waitFor({ state: "hidden" });
  const trigger = page.locator("[data-ui-select-trigger]");
  assert.equal((await trigger.evaluate(readContrast)).background, "rgb(255, 255, 255)");
  await trigger.click();
  const option = page.getByRole("option", { name: "Sneakers" });
  assert.deepEqual(await option.evaluate(readContrast), {
    background: "rgb(244, 244, 245)",
    color: "rgb(24, 24, 27)",
  });
  const toast = page.getByText("Product save failed");
  assert.equal((await toast.evaluate(readContrast)).color, "rgb(24, 24, 27)");
  assert.equal(
    await toast.evaluate(
      (el) => getComputedStyle(el.parentElement.parentElement).backgroundColor,
    ),
    "rgb(255, 255, 255)",
  );
  await page.evaluate(() => {
    window.fetch = async () =>
      new Response(
        JSON.stringify({
          orders: [
            {
              id: "shipping-test",
              items: [
                {
                  id: "item-1",
                  product_name: "Test sneaker",
                  quantity: 1,
                  unit_price: 100,
                  line_total: 100,
                },
              ],
            },
          ],
          count: 1,
          defaults: [],
          origin: null,
        }),
        { headers: { "content-type": "application/json" } },
      );
    window.renderShipping();
  });
  await page.getByRole("button", { name: "View items (1)" }).click();
  const expanded = page.locator("tr").filter({ hasText: "Test sneaker" });
  assert.equal((await expanded.evaluate(readContrast)).background, "rgb(250, 250, 250)");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Label info", exact: true }).click();
  const mobileDetails = page
    .locator("tr")
    .filter({ hasText: "Destination" })
    .filter({ hasText: "Test sneaker" });
  assert.equal(
    (await mobileDetails.evaluate(readContrast)).background,
    "rgb(250, 250, 250)",
  );
  console.log(
    "PASS: admin buttons, dropdowns, error toasts, and desktop/mobile shipping expansions have readable light surfaces",
  );
} finally {
  await browser.close();
}

function readContrast(element) {
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, color: style.color };
}

function readBorder(element) {
  const style = getComputedStyle(element);
  return { color: style.borderColor, width: style.borderWidth };
}
