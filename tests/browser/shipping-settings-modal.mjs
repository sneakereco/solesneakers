import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const [siteCss, pageSource, modalSource] = await Promise.all([
  readFile("src/styles/site.css", "utf8"),
  readFile("src/app/admin/settings/shipping/page.tsx", "utf8"),
  readFile("src/components/ui/ModalPortal.tsx", "utf8"),
]);
const compiledCss = await postcss([
  tailwindcss({
    content: [{ raw: `${pageSource}\n${modalSource}`, extension: "tsx" }],
  }),
]).process(siteCss, { from: "src/styles/site.css" });

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import ShippingSettingsPage from './src/app/admin/settings/shipping/page';

      createRoot(document.getElementById('root')).render(
        <div data-admin-shell="">
          <main data-admin-content="">
            <div><ShippingSettingsPage /></div>
          </main>
        </div>
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
      name: "shipping-settings-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "next/link",
          namespace: "test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents: `
            import React from 'react';
            export default ({ children, href, ...props }) =>
              React.createElement('a', { href, ...props }, children);
          `,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: compiledCss.css });
  await page.evaluate(() => {
    window.fetch = async (input) => {
      const path = String(input);
      const payload = path.endsWith("/defaults")
        ? { defaults: [] }
        : path.endsWith("/origin")
          ? { origin: null }
          : { carriers: [] };
      return { json: async () => payload };
    };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const heading = page.getByRole("heading", { name: "Edit package defaults" });
  await heading.waitFor();

  const bounds = await heading.evaluate((element) => {
    let overlay = element.parentElement;
    while (overlay && getComputedStyle(overlay).position !== "fixed") {
      overlay = overlay.parentElement;
    }
    if (!overlay) throw new Error("Fixed modal overlay not found");
    const rect = overlay.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    };
  });

  assert.deepEqual(bounds, { left: 0, top: 0, right: 390, bottom: 640 });
  console.log("PASS: shipping defaults editor covers the viewport");
} finally {
  await browser.close();
}
