import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

// Catch misplaced sections, unwanted motion and clothing cards using unavailable
// variant prices. Network fixtures replace the catalog, while rendering real UI.
const outputDir = path.resolve(".superpowers/verification/home-clothing");
mkdirSync(outputDir, { recursive: true });
const cssPath = path.join(outputDir, "home.css");
execFileSync(process.execPath, [
  "node_modules/tailwindcss/lib/cli.js",
  "--input",
  "src/styles/site.css",
  "--output",
  cssPath,
  "--minify",
]);
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `import { createRoot } from 'react-dom/client';
      import HomePage from './src/app/(store)/page';
      const root = createRoot(document.getElementById('root'));
      window.unmountHome = () => root.unmount();
      root.render(<HomePage />);`,
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
              ? `import React from 'react'; export default ({ fill, priority, quality, sizes, ...props }) =>
              React.createElement('img', { ...props, style: { ...(fill ? {position:'absolute',inset:0,width:'100%',height:'100%'} : {}), ...props.style } });`
              : `import React from 'react'; export default ({children,href,...props}) => React.createElement('a',{href,...props},children);`,
        }));
      },
    },
  ],
});

const clothing = Array.from({ length: 7 }, (_, i) => ({
  id: `clothing-${i + 1}`,
  name: `Catalog Hoodie ${i + 1}`,
  category: "clothing",
  images: [
    { url: "/images/hero.jpg", is_primary: false, sort_order: 0 },
    {
      url: "/images/homepage_categories/clothing_1.jpg",
      is_primary: true,
      sort_order: 1,
    },
  ],
  variants: [
    { sale_price_cents: 1000, stock: 0 },
    { sale_price_cents: 4500, stock: 2 },
    { sale_price_cents: 5500, stock: 1 },
  ],
}));
let mode = "success";
let releaseClothing;
let clothingGate = Promise.resolve();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://clothing.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<style>${readFileSync(cssPath, "utf8")}</style><div id="root"></div>`,
      });
    if (url.pathname === "/api/featured-items")
      return route.fulfill({
        json: {
          featured: [
            {
              id: "featured-shoe",
              titleDisplay: "Featured Sneaker",
              primaryImage: "/images/hero.jpg",
              minPrice: 9900,
            },
          ],
        },
      });
    if (url.pathname === "/api/store/taxonomy")
      return route.fulfill({
        json: {
          brands: [{ id: "prada", label: "Prada" }],
        },
      });
    if (url.pathname === "/api/store/products") {
      assert.deepEqual(url.searchParams.getAll("category"), ["clothing"]);
      assert.equal(url.searchParams.get("limit"), "12");
      await clothingGate;
      if (mode === "error") return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        json: {
          products:
            mode === "empty" ? [] : mode === "single" ? clothing.slice(0, 1) : clothing,
        },
      });
    }
    if (url.pathname.startsWith("/images/"))
      return route.fulfill({
        body: readFileSync(path.join("public", url.pathname)),
      });
    return route.abort();
  });
  const mount = async () => {
    await page.goto("https://clothing.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  };
  await mount();
  const slideshow = page.getByRole("region", { name: "Outfit inspiration" });
  await slideshow.waitFor();
  assert.equal(
    await slideshow.locator('[style*="background-image"]').count(),
    0,
    "offscreen slides defer their background downloads",
  );
  const section = page.getByRole("region", { name: "Shop Clothing", exact: true });
  await section.getByRole("link", { name: /Catalog Hoodie 1/ }).waitFor();
  const ordering = await page
    .locator("section")
    .evaluateAll((sections) =>
      sections.map(
        (s) =>
          s.getAttribute("aria-label") || s.querySelector("h1,h2")?.textContent.trim(),
      ),
    );
  assert.deepEqual(ordering.slice(0, 5), [
    "Curated heat.Available now.",
    "Featured Items",
    "Outfit inspiration",
    "Shop Clothing",
    "Shop by Category",
  ]);
  assert.equal(await slideshow.getByRole("button").count(), 2);
  assert.equal(await slideshow.getByRole("link").count(), 0);
  const left = await slideshow
    .getByRole("button", { name: "Previous outfit" })
    .boundingBox();
  const right = await slideshow
    .getByRole("button", { name: "Next outfit" })
    .boundingBox();
  assert.ok(left.x < 35 && right.x > 1360, "outfit arrows sit on opposite edges");
  assert.equal(Math.round((await slideshow.boundingBox()).height), 320);
  assert.equal(await slideshow.getByRole("img").count(), 1);
  const firstAlt = await slideshow.getByRole("img").getAttribute("alt");
  await slideshow.getByRole("button", { name: "Next outfit" }).click();
  assert.notEqual(await slideshow.getByRole("img").getAttribute("alt"), firstAlt);
  await slideshow.getByRole("button", { name: "Previous outfit" }).click();
  assert.equal(await slideshow.getByRole("img").getAttribute("alt"), firstAlt);

  const cards = section.getByRole("link", { name: /Catalog Hoodie/ });
  assert.equal(await cards.count(), 7);
  assert.equal(await cards.first().getAttribute("href"), "/store/clothing-1");
  assert.equal(
    await cards.first().locator("img").getAttribute("src"),
    "/images/homepage_categories/clothing_1.jpg",
  );
  assert.ok((await cards.first().textContent()).includes("$45.00"));
  assert.equal(
    await section.getByRole("link", { name: "Shop All Clothing" }).getAttribute("href"),
    "/store?category=clothing",
  );
  await section.getByRole("button", { name: "Next clothing products" }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Clothing products"]').scrollLeft > 100,
  );

  for (const width of [768, 767, 390]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const ratio = await slideshow.getByRole("img").evaluate((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width / rect.height;
    });
    assert.ok(
      Math.abs(ratio - 3) < 0.01,
      "outfit image retains its full height at every breakpoint",
    );
  }
  assert.equal(Math.round((await slideshow.boundingBox()).height), 200);

  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 950 });
    for (const index of [0, 3, 6]) {
      await cards.nth(index).evaluate((card) => {
        card.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
      });
      const bounds = await cards.nth(index).boundingBox();
      assert.ok(
        Math.abs(bounds.x + bounds.width / 2 - width / 2) < 1,
        `clothing card ${index + 1} is centered in the ${width}px phone viewport`,
      );
    }
    const featuredCard = await page
      .getByRole("region", { name: "Featured products", exact: true })
      .getByRole("link")
      .first()
      .boundingBox();
    assert.ok(
      featuredCard.width < width * 0.85,
      "featured sneakers retain narrower cards",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }

  await page.setViewportSize({ width: 390, height: 950 });
  await cards.first().evaluate((card) => {
    card.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
  });
  await section.getByRole("button", { name: "Next clothing products" }).click();
  await page.waitForFunction(() => {
    const card = document.querySelector(
      '[aria-label="Clothing products"] > a:nth-child(2)',
    );
    const bounds = card.getBoundingClientRect();
    return Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) < 1;
  });
  await section.screenshot({ path: path.join(outputDir, "mobile-centered.png") });

  for (const width of [640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const card = await cards.first().boundingBox();
    const carousel = await section
      .getByRole("region", { name: "Clothing products" })
      .boundingBox();
    const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;
    assert.ok(
      card.width <= carousel.width / columns,
      `${columns} clothing cards fit at ${width}px`,
    );
    assert.ok(
      card.width > carousel.width / (columns + 1),
      "desktop card sizing is retained",
    );
  }

  mode = "single";
  await page.setViewportSize({ width: 390, height: 950 });
  await mount();
  await cards.first().waitFor();
  const single = await cards.first().boundingBox();
  assert.ok(
    Math.abs(single.x + single.width / 2 - 195) < 1,
    "a single clothing card is centered",
  );
  assert.equal(
    await section.getByRole("button", { name: /clothing products/ }).count(),
    0,
  );
  mode = "success";

  await page.setViewportSize({ width: 1440, height: 1000 });
  await mount();
  await slideshow.waitFor();
  await page.clock.install();
  const offscreen = await slideshow.getByRole("img").getAttribute("alt");
  await page.clock.runFor(6500);
  assert.equal(await slideshow.getByRole("img").getAttribute("alt"), offscreen);
  await slideshow.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.clock.runFor(6500);
  assert.notEqual(await slideshow.getByRole("img").getAttribute("alt"), offscreen);
  await slideshow.getByRole("button", { name: "Next outfit" }).click();
  await page.mouse.move(0, 0);
  const manual = await slideshow.getByRole("img").getAttribute("alt");
  await page.clock.runFor(6500);
  assert.equal(await slideshow.getByRole("img").getAttribute("alt"), manual);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await mount();
  await slideshow.scrollIntoViewIfNeeded();
  const still = await slideshow.getByRole("img").getAttribute("alt");
  await page.clock.runFor(6500);
  assert.equal(await slideshow.getByRole("img").getAttribute("alt"), still);
  await page.clock.resume();

  mode = "empty";
  await mount();
  await section.getByText("Clothing is coming soon.").waitFor();
  assert.equal(await section.getByRole("link", { name: "Shop All Clothing" }).count(), 1);
  mode = "error";
  await mount();
  await section.getByRole("button", { name: "Retry clothing" }).waitFor();
  mode = "success";
  await section.getByRole("button", { name: "Retry clothing" }).click();
  await section.getByRole("link", { name: /Catalog Hoodie 1/ }).waitFor();
  clothingGate = new Promise((resolve) => {
    releaseClothing = resolve;
  });
  await mount();
  await section.getByRole("status").filter({ hasText: "Loading clothing" }).waitFor();
  await page.evaluate(() => window.unmountHome());
  releaseClothing();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: homepage clothing layout, product navigation, inventory states and reduced motion",
  );
} finally {
  await browser.close();
}
