import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const bundle = await compileUxHarness(
  `
  import { createRoot, hydrateRoot } from "react-dom/client";
  import { renderToString } from "react-dom/server.browser";
  import { Suspense, use, useState } from "react";
  import { FeaturedItems } from "./src/components/home/FeaturedItems";
  import { HomepageCategories } from "./src/components/home/HomepageCategories";
  import { SearchOverlay } from "./src/components/search/SearchOverlay";
  import { CartProvider } from "./src/components/cart/CartProvider";
  import CartPage from "./src/app/(store)/cart/page";
  import { CartDrawer } from "./src/components/cart/CartDrawer";
  import { ProductDetail } from "./src/components/store/ProductDetail";
  import { StoreNavigation, StoreResults } from "./src/components/store/StoreNavigation";
  import { ProductGrid } from "./src/components/store/ProductGrid";
  import { StorefrontFilterBar } from "./src/components/store/StorefrontFilterBar";
  import { StoreMenuDrawer } from "./src/components/shell/StoreMenuDrawer";
  import { StoreControls } from "./src/components/store/StoreControls";
  import { SessionProvider } from "./src/contexts/SessionContext";

  const product = {
    id: "case-1", name: "Held Product", description: null,
    category: "sneakers", condition: "new", brand: {id: "sample", label: "Sample"},
    images: [],
    variants: [{id: "case-size", size: {id: "nine", label: "9"}, stock: 5, sale_price_cents: 12500}],
  };

  function CatalogFixture() {
    const [remote, setRemote] = useState({name: "Initial product", path: "/store"});
    const result = remote instanceof Promise ? use(remote) : remote;
    const params = new URL(result.path, location.origin).searchParams;
    window.fixtureSearch = params.toString();
    window.fixturePath = result.path;
    window.fixturePush = (path) => {
      setRemote(fetch("/fixture/catalog" + new URL(path, location.origin).search)
        .then(async (response) => response.ok ? {name: (await response.json()).name, path} : {failed: true, path}));
    };
    const page = Number(params.get("page") ?? 1);
    const sort = params.get("sort") ?? "newest";
    const view = params.get("view") === "list" ? "list" : "grid";
    const controls = {total: 36, page, pageCount: 3, limit: 12, sort, view};
    if (result.failed) return <StoreNavigation loadFailed />;
    return (
      <StoreNavigation>
        <StoreControls {...controls} showPagination={false} />
        <StorefrontFilterBar
          brands={[{id: "sample", label: "Sample"}]} categories={["sneakers"]}
          conditions={["new"]} shoeSizes={[]} clothingSizes={[]}
          shoeSizeCounts={{}} clothingSizeCounts={{}}
          selectedBrandIds={params.getAll("brandIds")} selectedCategories={params.getAll("category")}
          selectedConditions={[]} selectedSizeIds={[]}
        />
        <StoreResults className="pt-12"><ProductGrid products={[{...product, name: result.name}]} view={view} /></StoreResults>
        <StoreControls {...controls} showSortControls={false} />
      </StoreNavigation>
    );
  }

  function Fixture() {
    const [searchOpen, setSearchOpen] = useState(false);
    const [cartOpen, setCartOpen] = useState(false);
    switch (location.pathname) {
      case "/search":
        return <><button onClick={() => setSearchOpen(true)}>Search</button>
          <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} /></>;
      case "/cart":
        return <CartPage />;
      case "/product":
        return <><ProductDetail product={product} />
          <button onClick={() => setCartOpen(true)}>Open cart</button>
          <CartDrawer isOpen={cartOpen} onClose={() => setCartOpen(false)} /></>;
      case "/catalog":
        return <Suspense fallback={<p>Loading route</p>}><CatalogFixture /></Suspense>;
      case "/menu":
        return <StoreMenuDrawer isOpen onClose={() => {}} />;
      default:
        return <><FeaturedItems /><FeaturedItems category="clothing" /><HomepageCategories /></>;
    }
  }

  const app = <SessionProvider initialUser={null} initialRole={null}>
    <CartProvider><Fixture /></CartProvider>
  </SessionProvider>;
  const root = document.getElementById("root");
  if (location.pathname === "/cart") {
    root.innerHTML = renderToString(app);
    window.hydrateCart = () => hydrateRoot(root, app);
  } else {
    createRoot(root).render(app);
  }
  `,
  {
    plugins: [
      {
        name: "storefront-routing-boundaries",
        setup(builder) {
          builder.onResolve(
            { filter: /^next\/(image|link|navigation)$/ },
            ({ path }) => ({
              path,
              namespace: "storefront-boundary",
            }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "storefront-boundary" },
            ({ path }) => ({
              loader: "tsx",
              resolveDir: process.cwd(),
              contents:
                path === "next/navigation"
                  ? "export const useRouter = () => ({push(path) {window.fixturePush?.(path);}, refresh() {window.fixturePush?.(window.fixturePath);}}); export const useSearchParams = () => new URLSearchParams(window.fixtureSearch ?? location.search);"
                  : path === "next/link"
                    ? "export const useLinkStatus = () => ({pending: false}); export default function Link({onNavigate, ...props}) { return <a {...props} />; }"
                    : "export default function Image({ fill, quality, priority, sizes, ...props }) { return <img {...props} />; }",
            }),
          );
        },
      },
    ],
  },
);

function holdResponse() {
  let markReceived;
  let sendResponse;
  const received = new Promise((resolve) => {
    markReceived = resolve;
  });
  const response = new Promise((resolve) => {
    sendResponse = resolve;
  });
  return {
    get received() {
      let timer;
      return Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Expected fixture request was not received")),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    },
    release: sendResponse,
    fulfill: async (route) => {
      markReceived(route.request());
      const options = await response;
      await route.fulfill(options).catch(() => {}); // A newer query can cancel this request.
    },
  };
}

const browser = await chromium.launch({ headless: true });
const failures = [];

async function check(width, name, run) {
  const page = await browser.newPage({
    viewport: { width, height: 860 },
    reducedMotion: width === 320 ? "reduce" : "no-preference",
    hasTouch: width === 320,
  });
  page.setDefaultTimeout(3500);
  page.on("pageerror", (error) => {
    failures.push(error);
    console.error(error);
  });
  try {
    await run(page);
    console.log(`PASS ${width}px ${name}`);
  } catch (error) {
    failures.push(new Error(`${width}px ${name}`, { cause: error }));
    console.error(`FAIL ${width}px ${name}: ${error.message}`);
  } finally {
    await page.close();
  }
}

const options = { timeout: 1500 };

async function checkHome(page) {
  const featured = holdResponse();
  const clothing = holdResponse();
  const categories = holdResponse();
  await page.route("**/api/featured-items", featured.fulfill);
  await page.route(
    "**/api/store/products?category=clothing&sort=newest&limit=12",
    clothing.fulfill,
  );
  await page.route("**/api/store/taxonomy", categories.fulfill);
  await page.route("**/images/**", (route) => route.fulfill({ status: 204 }));
  await openUxHarness(page, bundle);
  try {
    await Promise.all([featured.received, clothing.received, categories.received]);
    for (const [name, count] of [
      ["Featured Items", 4],
      ["Shop Clothing", 4],
      ["Shop by Category", 2],
    ]) {
      const region = page.getByRole("region", { name });
      await expect(
        region.locator("[aria-busy=true] [data-ui-skeleton]").first(),
      ).toBeVisible(options);
      assert.ok(
        (await region.locator("[aria-busy=true] [data-ui-skeleton]").count()) >= count,
      );
      if (page.viewportSize().width === 320) {
        assert.equal(
          await region
            .locator("[data-ui-skeleton]")
            .first()
            .evaluate((el) => getComputedStyle(el).animationName),
          "none",
        );
      }
    }
    await expect(
      page.getByRole("link", { name: "Designer Sneakers", exact: true }),
    ).toHaveCount(0);
  } finally {
    featured.release({ status: 503, json: {} });
    clothing.release({ json: { products: [] } });
    categories.release({ json: { brands: [{ id: "prada", label: "Prada" }] } });
  }
  const featuredRegion = page.getByRole("region", { name: "Featured Items" });
  await expect(featuredRegion.getByRole("alert")).toBeVisible(options);
  await page.unroute("**/api/featured-items");
  await page.route("**/api/featured-items", (route) =>
    route.fulfill({
      json: {
        featured: [
          {
            id: "ready",
            titleDisplay: "Recovered Item",
            primaryImage: null,
            minPrice: 1000,
          },
        ],
      },
    }),
  );
  await featuredRegion.getByRole("button", { name: /Retry/ }).press("Enter");
  await expect(featuredRegion.getByRole("link", { name: /Recovered Item/ })).toBeVisible(
    options,
  );
  await expect(
    page.getByRole("link", { name: "Designer Sneakers", exact: true }),
  ).toBeVisible(options);
}

async function checkSearch(page) {
  const first = holdResponse();
  const second = holdResponse();
  const deadline = holdResponse();
  // Control the timeout source without changing the feature's composed fetch signal.
  await page.addInitScript(() => {
    AbortSignal.timeout = () => {
      const deadline = new AbortController();
      window.expireRequest = () =>
        deadline.abort(new DOMException("Expired", "TimeoutError"));
      return deadline.signal;
    };
  });
  await page.route("**/api/store/products?q=first&limit=6", first.fulfill);
  await page.route("**/api/store/products?q=next&limit=6", second.fulfill);
  await page.route("**/api/store/products?q=deadline&limit=6", deadline.fulfill);
  await openUxHarness(page, bundle, "https://ux.test/search");
  const open = page.getByRole("button", { name: "Search", exact: true });
  await open.press("Enter");
  const input = page.getByRole("searchbox");
  await input.fill("first");
  await first.received;
  try {
    await expect(page.locator("[aria-busy=true] [data-ui-skeleton]").first()).toBeVisible(
      options,
    );
    await input.fill("next");
    await second.received;
  } finally {
    second.release({ status: 503, json: {} });
    first.release({ json: { products: [{ id: "old", name: "Old Result" }], total: 1 } });
  }
  await expect(page.getByRole("alert")).toBeVisible(options);
  await expect(input).toHaveValue("next");
  await page.unroute("**/api/store/products?q=next&limit=6");
  await page.route("**/api/store/products?q=next&limit=6", (route) =>
    route.fulfill({
      json: { products: [{ id: "new", name: "Fresh Result" }], total: 1 },
    }),
  );
  await page.getByRole("button", { name: "Retry", exact: true }).press("Enter");
  await expect(page.getByRole("link", { name: /Fresh Result/ })).toBeVisible(options);
  await expect(page.getByRole("link", { name: /Old Result/ })).toHaveCount(0);
  const fresh = page.getByRole("link", { name: /Fresh Result/ });
  const before = await fresh.boundingBox();
  try {
    await input.fill("deadline");
    await deadline.received;
    await expect(page.getByText("Updating…", { exact: true })).toBeVisible(options);
    await expect(fresh).toBeVisible(options);
    assert.equal(
      (await fresh.boundingBox()).y,
      before.y,
      "search status moved current matches",
    );
    await page.evaluate(() => window.expireRequest());
    await expect(page.getByRole("alert")).toBeVisible(options);
    await expect(fresh).toBeVisible(options);
    await expect(input).toHaveValue("deadline");
  } finally {
    deadline.release({ json: { products: [], total: 0 } });
  }
}

async function checkCart(page) {
  await openUxHarness(page, bundle, "https://ux.test/cart");
  await expect(page.getByText("Your cart is empty")).toHaveCount(0, options);
  await expect(page.locator("[aria-busy=true] [data-ui-skeleton]").first()).toBeVisible(
    options,
  );
  await expect(page.getByRole("link", { name: "Checkout" })).toHaveCount(0);
  const hasSavedCart = page.viewportSize().width === 320;
  if (hasSavedCart) {
    const item = {
      productId: "saved",
      variantId: "save-nine",
      sizeLabel: "9",
      brand: "Sample",
      name: "Saved Product",
      titleDisplay: "Saved Product",
      priceCents: 12000,
      imageUrl: "/placeholder.png",
      maxStock: 2,
      quantity: 1,
    };
    await page.route("**/placeholder.png", (route) => route.fulfill({ status: 204 }));
    await page.route("**/api/cart/validate", (route) =>
      route.fulfill({ json: { items: [item] } }),
    );
    await page.evaluate(
      (saved) => sessionStorage.setItem("rdk_cart_session", JSON.stringify([saved])),
      item,
    );
  }
  await page.evaluate(() => window.hydrateCart());
  if (hasSavedCart) {
    await expect(page.getByRole("heading", { name: "Saved Product" })).toBeVisible(
      options,
    );
    await expect(page.getByText("Your cart is empty")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Checkout" })).toHaveAttribute(
      "href",
      "/checkout",
    );
  } else {
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible(
      options,
    );
  }
}

async function checkAdd(page) {
  await page.route("**/placeholder.png", (route) => route.fulfill({ status: 204 }));
  await openUxHarness(page, bundle, "https://ux.test/product");
  const add = page.getByRole("button", { name: "Add to Cart", exact: true });
  await expect(add).toBeEnabled();
  await add.evaluate((element) => {
    element.click();
    element.click();
  });
  await expect(page.getByText("Added to cart.", { exact: true })).toBeVisible(options);
  await expect(
    page.getByRole("button", { name: /Add Another \(1 in cart\)/ }),
  ).toBeEnabled(options);
  await page.getByRole("button", { name: "Open cart" }).press("Enter");
  const checkout = page.getByRole("link", { name: /Checkout/ });
  await expect(checkout).toHaveAttribute("href", "/checkout", options);
  assert.equal(
    await checkout.evaluate((el) => el.hasAttribute("data-feedback-link")),
    false,
  );
}

async function checkPress(page) {
  await openUxHarness(page, bundle, "https://ux.test/catalog");
  await page.route("**/fixture/catalog?view=list&page=1", (route) =>
    route.fulfill({ json: { name: "List product" } }),
  );
  const grid = page.getByRole("button", { name: "Grid view" });
  const list = page.getByRole("button", { name: "List view" });
  for (const control of [grid, list]) {
    const box = await control.boundingBox();
    assert.ok(box?.width >= 44 && box.height >= 44, "expected 44×44 view controls");
  }
  await page.keyboard.press("Tab");
  await expect(grid).toBeFocused();
  assert.equal(await grid.evaluate((el) => getComputedStyle(el).outlineStyle), "solid");
  const box = await list.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    assert.equal(
      await list.evaluate((el) => getComputedStyle(el).filter),
      "brightness(0.85)",
    );
  } finally {
    await page.mouse.up();
  }
  if (page.viewportSize().width === 320) {
    const products = page.getByTestId("product-grid");
    await expect(products).toHaveAttribute("data-view", "list");
    await page.route("**/fixture/catalog?view=grid&page=1", (route) =>
      route.fulfill({ json: { name: "Grid product" } }),
    );
    await grid.tap();
    await expect(products).toHaveAttribute("data-view", "grid");
  }
}

async function checkCatalog(page) {
  const filter = holdResponse();
  const sort = holdResponse();
  const next = holdResponse();
  let descendingAttempts = 0;
  await page.route("**/fixture/catalog**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("page") === "2") return next.fulfill(route);
    if (params.get("sort") === "price_asc") return sort.fulfill(route);
    if (params.get("sort") === "price_desc") {
      descendingAttempts += 1;
      return descendingAttempts === 1
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: { name: "Retried product" } });
    }
    return filter.fulfill(route);
  });
  await openUxHarness(page, bundle, "https://ux.test/catalog");
  const initial = page
    .getByTestId("product-card")
    .filter({ hasText: /Initial product/i });
  await expect(initial).toBeVisible(options);
  const before = await initial.boundingBox();
  const updating = page.getByText("Updating products…", { exact: true }).first();

  try {
    await page.getByRole("button", { name: "Brand", exact: true }).press("Enter");
    await page.getByRole("checkbox", { name: "Sample" }).click();
    await filter.received;
    await expect(updating).toBeVisible(options);
    await expect(initial).toBeVisible(options);
    await expect(page.getByRole("region", { name: "Products" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    assert.equal(
      (await initial.boundingBox()).y,
      before.y,
      "updating indicator moved the grid",
    );

    await page.getByRole("button", { name: "Date: New to Old" }).press("Enter");
    await page.getByRole("option", { name: "Price: Low to High" }).click();
    const request = await sort.received;
    assert.equal(new URL(request.url()).searchParams.get("brandIds"), "sample");
    sort.release({ json: { name: "Sorted product" } });
    await expect(
      page.getByTestId("product-card").filter({ hasText: /Sorted product/i }),
    ).toBeVisible(options);
    filter.release({ json: { name: "Superseded product" } });
    await expect(
      page.getByTestId("product-card").filter({ hasText: /Superseded product/i }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Next", exact: true }).press("Enter");
    await next.received;
    await expect(updating).toBeVisible(options);
    await expect(
      page.getByTestId("product-card").filter({ hasText: /Sorted product/i }),
    ).toBeVisible(options);
    next.release({ json: { name: "Next page product" } });
    await expect(
      page.getByTestId("product-card").filter({ hasText: /Next page product/i }),
    ).toBeVisible(options);
    await expect(updating).toBeHidden(options);

    await page.getByRole("button", { name: "Price: Low to High" }).press("Enter");
    await page.getByRole("option", { name: "Price: High to Low" }).click();
    await expect(page.getByRole("alert")).toContainText("Showing previous results");
    await expect(
      page.getByTestId("product-card").filter({ hasText: /Next page product/i }),
    ).toBeVisible(options);
    await page.getByRole("button", { name: "Retry", exact: true }).press("Enter");
    await expect(
      page.getByTestId("product-card").filter({ hasText: /Retried product/i }),
    ).toBeVisible(options);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    filter.release({ json: { name: "Superseded product" } });
    sort.release({ json: { name: "Sorted product" } });
    next.release({ json: { name: "Next page product" } });
  }
}

async function checkMenu(page) {
  const loading = holdResponse();
  await page.route("**/api/store/taxonomy", loading.fulfill);
  await openUxHarness(page, bundle, "https://ux.test/menu");
  const menu = page.getByRole("dialog", { name: "Store menu" });
  await expect(menu.getByRole("link", { name: "Shop All" })).toBeVisible(options);
  await loading.received;
  try {
    await menu.getByRole("button", { name: "Shop by Size" }).press("Enter");
    await expect(menu.locator("[aria-busy=true] [data-ui-skeleton]").first()).toBeVisible(
      options,
    );
  } finally {
    loading.release({ status: 503, json: {} });
  }
  await expect(menu.getByRole("alert")).toBeVisible(options);
  await page.unroute("**/api/store/taxonomy");
  await page.route("**/api/store/taxonomy", (route) =>
    route.fulfill({
      json: { brands: [], sizes: [{ id: "nine", label: "9M", sizeType: "shoe" }] },
    }),
  );
  await menu.getByRole("button", { name: "Retry", exact: true }).press("Enter");
  await menu.getByRole("button", { name: "Men's", exact: true }).press("Enter");
  await expect(menu.getByRole("link", { name: "9M", exact: true })).toHaveAttribute(
    "href",
    "/store?category=sneakers&sizeIds=nine",
    options,
  );
}

try {
  for (const width of [320, 768, 1440]) {
    await check(width, "homepage sections show regional skeletons and retry", checkHome);
    await check(width, "search rejects superseded responses and can retry", checkSearch);
    await check(width, "cart waits for hydration before showing empty", checkCart);
    await check(width, "same-turn add is acknowledged once", checkAdd);
    await check(
      width,
      "view controls have visible keyboard and press feedback",
      checkPress,
    );
    await check(
      width,
      "filter, sort and page retain and update catalog results",
      checkCatalog,
    );
    await check(width, "menu taxonomy shows scoped loading and retry", checkMenu);
  }
} finally {
  await browser.close();
}

if (failures.length) throw new AggregateError(failures, "Storefront regressions failed");
