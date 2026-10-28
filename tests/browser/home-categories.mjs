import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const outputDir = path.resolve(".superpowers/sdd/2026-10-28-homepage-categories");
mkdirSync(outputDir, { recursive: true });
const cssPath = path.join(outputDir, "categories.css");
execFileSync(
  process.execPath,
  [
    "node_modules/tailwindcss/lib/cli.js",
    "--input",
    "src/styles/site.css",
    "--output",
    cssPath,
    "--minify",
  ],
  { stdio: "pipe" },
);

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import { createRoot } from 'react-dom/client';
      import { HomepageCategories } from './src/components/home/HomepageCategories';
      const root = createRoot(document.getElementById('root'));
      window.unmountCategories = () => root.unmount();
      root.render(<HomepageCategories />);`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "next-boundaries",
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
              ? `import React from 'react'; export default ({ fill, priority, quality, style, ...props }) => React.createElement('img', { ...props, style: { ...(fill ? {position:'absolute',inset:0,width:'100%',height:'100%'} : {}), ...style } });`
              : `import React from 'react'; export default ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);`,
        }));
      },
    },
  ],
});

let mode = "success";
let releaseBrands;
let brandGate = new Promise((resolve) => {
  releaseBrands = resolve;
});
const brands = [
  { id: "prada", label: "Prada" },
  { id: "gucci", label: "Gucci" },
  { id: "nike", label: "Nike" },
  { id: "chrome-hearts", label: "Chrome Hearts" },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10_000);
  await page.route("https://categories.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: `<style>${readFileSync(cssPath, "utf8")}</style><div id="root"></div>`,
      });
    }
    if (url.pathname === "/api/store/taxonomy") {
      await brandGate;
      if (mode === "error") return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        json: { brands: mode === "empty" ? [] : mode === "malformed" ? null : brands },
      });
    }
    if (url.pathname.startsWith("/images/homepage_categories/")) {
      return route.fulfill({
        contentType: "image/jpeg",
        body: readFileSync(path.join("public", url.pathname)),
      });
    }
    return route.abort();
  });
  const mount = async () => {
    await page.goto("https://categories.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  };
  await mount();
  const section = page.getByRole("region", { name: "Shop by Category" });
  await page.getByRole("status").filter({ hasText: "Loading" }).waitFor();
  assert.equal(await section.getByRole("link").count(), 4);
  assert.equal(
    await section.getByRole("link", { name: "Designer Sneakers", exact: true }).count(),
    0,
  );
  releaseBrands();
  await section.getByRole("link", { name: "Designer Sneakers", exact: true }).waitFor();
  assert.equal(await section.getByRole("link").count(), 6);
  for (const [name, category] of [
    ["Designer Sneakers", "sneakers"],
    ["Designer Bags & Accessories", "accessories"],
  ]) {
    const href = await section
      .getByRole("link", { name, exact: true })
      .getAttribute("href");
    const params = new URL(href, "https://categories.test").searchParams;
    assert.equal(params.get("category"), category);
    assert.deepEqual(params.getAll("brandIds"), ["prada", "gucci"]);
  }

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    const links = section.getByRole("link");
    const boxes = await links.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width };
      }),
    );
    if (width === 1440) {
      assert.equal(boxes[0].y, boxes[1].y);
      assert.equal(boxes[2].y, boxes[5].y);
      assert.ok(boxes[0].width > boxes[2].width * 2);
    } else if (width === 768) {
      assert.equal(boxes[0].y, boxes[1].y);
      assert.equal(boxes[2].y, boxes[3].y);
    } else {
      assert.ok(boxes.every((box) => box.x === boxes[0].x));
      assert.ok(boxes.every((box, index) => index === 0 || box.y > boxes[index - 1].y));
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    const images = section.locator("img");
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      assert.ok(await image.evaluate((element) => element.naturalWidth > 0));
      assert.equal(
        await image.evaluate((element) => getComputedStyle(element).objectFit),
        "cover",
      );
    }
    assert.equal(
      await images.nth(0).evaluate((el) => getComputedStyle(el).objectPosition),
      "50% 64%",
    );
    assert.equal(
      await images.nth(3).evaluate((el) => getComputedStyle(el).objectPosition),
      "50% 50%",
    );
    await links.first().focus();
    assert.ok(await links.first().evaluate((el) => el === document.activeElement));
    assert.equal(
      await links.first().evaluate((el) => getComputedStyle(el).outlineStyle),
      "solid",
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await section.getByRole("link").first().hover();
  assert.equal(
    await section
      .locator("img")
      .first()
      .evaluate((el) => getComputedStyle(el).transform),
    "none",
  );

  mode = "error";
  await mount();
  const retry = page.getByRole("button", { name: "Retry designer collections" });
  await retry.waitFor();
  assert.equal(await section.getByRole("link").count(), 4);
  mode = "success";
  await retry.click();
  await section.getByRole("link", { name: "Designer Sneakers", exact: true }).waitFor();
  assert.equal(await section.getByRole("link").count(), 6);
  for (mode of ["empty", "malformed"]) {
    await mount();
    await retry.waitFor();
    assert.equal(await section.getByRole("link").count(), 4);
    assert.equal(await section.getByRole("link", { name: /Designer/ }).count(), 0);
  }
  mode = "success";
  brandGate = new Promise((resolve) => {
    releaseBrands = resolve;
  });
  await mount();
  await page.getByRole("status").filter({ hasText: "Loading" }).waitFor();
  const aborted = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith("/api/store/taxonomy"),
  });
  await page.evaluate(() => window.unmountCategories());
  await aborted;
  releaseBrands();
  assert.equal(await section.count(), 0);
  console.log(
    "PASS: homepage category filters, failure recovery, real images, responsive layout, focus, reduced motion, and request cleanup",
  );
} finally {
  releaseBrands();
  await browser.close();
}
