import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import { CreateLabelForm } from './src/components/admin/shipping/CreateLabelForm';

      createRoot(document.getElementById('root')).render(
        <div data-admin-shell="">
          <div data-admin-content="">
            <button id="dark-action" className="bg-zinc-900 text-white">Save</button>
            <button id="light-action" className="bg-white text-zinc-950">Filter</button>
          </div>
          <CreateLabelForm
            open
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
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});

const css = await readFile("src/styles/site.css", "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({
    content: `.bg-white{background:#fff}.bg-zinc-100{background:#f4f4f5}.text-white{color:#fff}.text-black{color:#000}${css}`,
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
  console.log("PASS: admin actions remain visible on light surfaces");
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
