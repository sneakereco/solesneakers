import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import { StoreMenuDrawer } from './src/components/shell/StoreMenuDrawer';
      createRoot(document.getElementById('root')).render(
        <StoreMenuDrawer isOpen onClose={() => {}} />
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
      name: "store-menu-boundaries",
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
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
    if (url.pathname === "/api/store/taxonomy") {
      return route.fulfill({ json: { brands: [], sizes: [] } });
    }
    return route.abort();
  });

  await page.goto("https://menu.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const menu = page.getByRole("dialog", { name: "Store menu" });
  await menu.getByRole("link", { name: "Shop All" }).waitFor();
  assert.equal(await menu.getByText("More", { exact: true }).count(), 0);
  assert.equal(await menu.getByRole("link", { name: "Home", exact: true }).count(), 0);
  assert.equal(await menu.getByRole("link", { name: "Contact", exact: true }).count(), 0);
  assert.equal(await menu.getByRole("link", { name: "Account", exact: true }).count(), 0);
  assert.equal(await menu.getByRole("link", { name: "Admin dashboard" }).count(), 0);
  console.log("PASS: store menu omits the More section");
} finally {
  await browser.close();
}
