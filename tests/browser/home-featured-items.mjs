import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const featured = Array.from({ length: 6 }, (_, index) => ({
  id: `product-${index + 1}`,
  name: `Product ${index + 1}`,
  brand: { id: "brand-1", label: "Sole" },
  titleDisplay: `Featured Product ${index + 1}`,
  category: "sneakers",
  primaryImage: `https://images.test/product-${index + 1}.jpg`,
  minPrice: 10_000 + index * 1_000,
  sortOrder: index,
  variants: [],
}));

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import { createRoot } from 'react-dom/client';
      import HomePage from './src/app/(store)/page';
      createRoot(document.getElementById('root')).render(<HomePage />);
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "home-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^next\/(?:image|link)$/ }, (args) => ({
          path: args.path,
          namespace: "test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/image"
              ? `import React from 'react'; export default ({ fill, priority, quality, sizes, ...props }) => React.createElement('img', props);`
              : `import React from 'react'; export default ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);`,
        }));
      },
    },
  ],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    }
    if (url.pathname === "/api/featured-items") {
      return route.fulfill({ json: { featured } });
    }
    if (url.hostname === "images.test") {
      return route.fulfill({ status: 204 });
    }
    return route.abort();
  });

  await page.goto("https://home.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("heading", { name: "Featured Items", exact: true }).waitFor();

  assert.equal(await page.getByText("Shop by category", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: /View All/i }).count(), 0);
  assert.equal(await page.getByText("Sole", { exact: true }).count(), 0);
  assert.equal(await page.getByText(/From \$/).count(), 0);
  assert.equal(await page.getByRole("link", { name: /Featured Product/ }).count(), 6);
  assert.equal(
    await page.getByRole("button", { name: "Next featured products" }).count(),
    0,
  );

  const carousel = page.getByRole("region", { name: "Featured products" });
  await carousel.evaluate((element) => {
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 1000 },
      scrollWidth: { configurable: true, value: 2000 },
    });
    element.scrollTo = (options) => {
      window.featuredScrollTarget = options.left;
    };
    window.dispatchEvent(new Event("resize"));
  });

  await page.getByRole("button", { name: "Next featured products" }).click();
  assert.equal(await page.evaluate(() => window.featuredScrollTarget), 1000);
  console.log("PASS: homepage uses the reference-style featured carousel");
} finally {
  await browser.close();
}
