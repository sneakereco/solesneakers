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
  import { PasswordLoginForm } from "./src/components/auth/login/PasswordLoginForm";
  import { OtpLoginForm } from "./src/components/auth/login/OtpLoginForm";
  import { VerifyEmailForm } from "./src/components/auth/login/VerifyEmailForm";
  import { EnrollmentForm } from "./src/components/auth/2fa/EnrollmentForm";
  import { ChallengeForm } from "./src/components/auth/2fa/ChallengeForm";
  import { ClientShell } from "./src/components/shell/ClientShell";
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
    const [remote, setRemote] = useState({name: "Initial product", path: "/store" + location.search});
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

  function AuthFixture() {
    const [path, setPath] = useState(location.pathname);
    window.fixturePath = path;
    window.fixturePush = setPath;
    const flow = path.split("/").at(-1);
    const handleVerification = () => setPath("/auth/fixture/verify");
    if (path === "/store") return <ClientShell><h1>Storefront after sign-in</h1></ClientShell>;
    if (path === "/admin") return <>
      <h1>Admin destination</h1>
      <button onClick={() => setPath("/store")}>Visit storefront</button>
    </>;
    if (flow === "otp") return <OtpLoginForm onRequiresEmailVerification={handleVerification} />;
    if (flow === "verify") return <VerifyEmailForm email="hello@example.test" onVerified={(next) => setPath(next ?? "/store")} />;
    if (flow === "setup") return <EnrollmentForm />;
    if (flow === "challenge") return <ChallengeForm />;
    return <PasswordLoginForm onRequiresEmailVerification={handleVerification} onSwitchToOtp={() => {}} onForgotPassword={() => {}} />;
  }

  import Home from "./src/app/(store)/page";
  import Limited from "./src/app/(store)/too-many-requests/page";
  import StoreNotFound from "./src/app/(store)/not-found";
  import RootNotFound from "./src/app/not-found";
  import StoreError from "./src/app/(store)/error";
  import CatalogError from "./src/app/(store)/store/error";
  import CartError from "./src/app/(store)/cart/error";
  import AccountError from "./src/app/(store)/account/error";
  import AdminError from "./src/app/admin/error";
  import CheckoutError from "./src/app/checkout/error";
  const routeErrors={store:StoreError,catalog:CatalogError,cart:CartError,account:AccountError,admin:AdminError,checkout:CheckoutError};
  const boundaryError=new Error("Controlled route read failed");
  function RouteFailure({view}){
    const [retry,setRetry]=useState(false);
    const [completed]=useState(()=>new Promise(resolve=>{window.completeReset=resolve;}));
    const Fallback=routeErrors[view];
    return retry ? use(completed) : <Fallback error={boundaryError} reset={()=>{}} retry={()=>setRetry(true)} />;
  }
  function Fixture() {
    const [searchOpen, setSearchOpen] = useState(false);
    const [cartOpen, setCartOpen] = useState(false);
    if (location.pathname.startsWith("/auth/fixture/")) return <AuthFixture />;
    switch (location.pathname) {
      case "/home": return <Home/>;
      case "/limited": return <Limited/>;
      case "/search":
        return <><button onClick={() => setSearchOpen(true)}>Search</button>
          <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} /></>;
      case "/cart":
        return <CartPage />;
      case "/failure": {
        const view=new URLSearchParams(location.search).get("view");
        if(view==="root-missing") return <RootNotFound/>;
        const content=view==="missing" ? <StoreNotFound/> : <Suspense fallback={<p role="status">Loading destination</p>}><RouteFailure view={view}/></Suspense>;
        return ["admin","checkout"].includes(view) ? <main>{content}</main> : <ClientShell>{content}</ClientShell>;
      }
      case "/gallery":
        return <ProductDetail product={{...product,images:[{id:"a",url:"/local-photo-a.png",is_primary:true},{id:"b",url:"/local-photo-b.png"}]}}/>;
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
                  ? "export const usePathname = () => window.fixturePath ?? location.pathname; export const useRouter = () => ({push(path) {window.fixturePush?.(path);}, refresh() {window.fixturePush?.(window.fixturePath);}}); export const useSearchParams = () => new URLSearchParams(window.fixtureSearch ?? location.search);"
                  : path === "next/link"
                    ? "import {createContext,useContext,useState} from 'react';const Status=createContext({pending:false});export const useLinkStatus=()=>useContext(Status);export default function Link({onNavigate,onClick,...props}){const [pending,set]=useState(false);return <Status.Provider value={{pending}}><a {...props} onClick={e=>{onClick?.(e);if(window.holdNavigation&&!e.defaultPrevented&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&e.button===0){e.preventDefault();onNavigate?.(e);set(true);}}}/></Status.Provider>}"
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
  if (process.argv[2] && !name.includes(process.argv[2])) return;
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

async function emulateOlderAbortSignal(page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(AbortSignal, "any");
    Reflect.deleteProperty(AbortSignal, "timeout");
  });
}

async function checkHome(page) {
  await emulateOlderAbortSignal(page);
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
  await emulateOlderAbortSignal(page);
  await page.clock.install();
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
    const superseded = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url().includes("?q=first&"),
    });
    await input.fill("next");
    await Promise.all([second.received, superseded]);
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
    const expired = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url().includes("?q=deadline&"),
    });
    await page.clock.fastForward(15_000);
    await expired;
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

async function checkRetainedCart(page, drawer) {
  const item = {
    productId: "case-1",
    variantId: "case-size",
    sizeLabel: "9",
    brand: "Sample",
    name: "Held Product",
    titleDisplay: "Held Product",
    priceCents: 12500,
    imageUrl: "/placeholder.png",
    maxStock: 5,
    quantity: 1,
  };
  await page.route("**/placeholder.png", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/cart/validate", (route) =>
    route.fulfill({ json: { items: [item] } }),
  );
  await page.addInitScript(
    (item) => sessionStorage.setItem("rdk_cart_session", JSON.stringify([item])),
    item,
  );
  await openUxHarness(
    page,
    bundle,
    drawer ? "https://ux.test/product" : "https://ux.test/cart",
  );
  if (drawer) await page.getByRole("button", { name: "Open cart" }).click();
  else await page.evaluate(() => window.hydrateCart());
  const surface = drawer ? page.getByRole("dialog") : page;
  const saved = surface.getByRole("heading", { name: "Held Product", exact: true });
  await expect(saved).toBeVisible(options);
  const held = holdResponse();
  await page.route("**/api/auth/session", held.fulfill);
  await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
  await held.received;
  try {
    await expect(saved).toBeVisible(options);
    await expect(surface.getByRole("button", { name: /Decrease quantity/ })).toBeDisabled(
      options,
    );
    await expect(surface.getByRole("link", { name: /Checkout/ })).toHaveCount(0);
  } finally {
    held.release({ status: 503, json: {} });
  }
  await expect(surface.getByRole("alert")).toBeVisible(options);
  await expect(saved).toBeVisible(options);
  await page.unroute("**/api/auth/session");
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "different-owner", email: "other@example.test" },
        role: "customer",
      },
    }),
  );
  await surface.getByRole("button", { name: "Try again" }).click();
  await expect(surface.getByText("Your cart is empty")).toBeVisible(options);
  await expect(saved).toHaveCount(0);
}

async function checkProductCartRecovery(page, sessionFailure) {
  await page.route("**/placeholder.png", (route) => route.fulfill({ status: 204 }));
  if (!sessionFailure)
    await page.addInitScript(() => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === "rdk_cart_session") throw Error("Storage denied");
        return original.call(this, key);
      };
      window.restoreCartReads = () => {
        Storage.prototype.getItem = original;
      };
    });
  await openUxHarness(page, bundle, "https://ux.test/product");
  if (sessionFailure) {
    await expect(
      page.getByRole("button", { name: "Add to Cart", exact: true }),
    ).toBeEnabled();
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 503, json: {} }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
  }
  await expect(page.getByRole("alert")).toContainText(/cart/i, options);
  await expect(page.getByRole("button", { name: "Loading cart…" })).toHaveCount(0);
  if (sessionFailure) {
    await page.unroute("**/api/auth/session");
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { user: null, role: null } }),
    );
  } else await page.evaluate(() => window.restoreCartReads());
  await page.getByRole("button", { name: "Retry loading cart" }).click();
  const add = page.getByRole("button", { name: "Add to Cart", exact: true });
  await expect(add).toBeEnabled(options);
  await add.click();
  await expect(page.getByText("Added to cart.", { exact: true })).toBeVisible(options);
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

async function checkPageReversal(page) {
  const forward = holdResponse();
  const reverse = holdResponse();
  await page.route("**/fixture/catalog**", (route) => {
    const requested = new URL(route.request().url()).searchParams.get("page");
    return (requested === "3" ? forward : reverse).fulfill(route);
  });
  await openUxHarness(page, bundle, "https://ux.test/catalog?page=2");
  const products = page.getByTestId("product-card");
  const pagination = page.getByRole("navigation", { name: "Product pagination" });
  const next = pagination.getByRole("button", { name: "Next" });
  const previous = pagination.getByRole("button", { name: "Previous" });
  try {
    await expect(
      pagination.getByRole("button", { name: "2", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await next.press("Enter");
    await forward.received;
    await expect(next).toBeDisabled(options);
    await expect(products).toContainText("Initial product");
    await previous.press("Enter");
    const request = await reverse.received;
    assert.equal(new URL(request.url()).searchParams.get("page"), "2");
    reverse.release({ json: { name: "Page two stays selected" } });
    await expect(products).toContainText("Page two stays selected");
    forward.release({ json: { name: "Superseded page three" } });
    await expect(
      pagination.getByRole("button", { name: "2", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(products).not.toContainText("Superseded page three");
  } finally {
    forward.release({ json: { name: "Superseded page three" } });
    reverse.release({ json: { name: "Page two stays selected" } });
  }
}

async function checkFailedPageRecovery(page) {
  const forward = holdResponse();
  const retry = holdResponse();
  const previous = holdResponse();
  let lastPageAttempts = 0;
  await page.route("**/fixture/catalog**", (route) => {
    const requested = new URL(route.request().url()).searchParams.get("page");
    if (requested !== "3") return previous.fulfill(route);
    lastPageAttempts += 1;
    return (lastPageAttempts === 1 ? forward : retry).fulfill(route);
  });
  await openUxHarness(page, bundle, "https://ux.test/catalog?page=2");
  const products = page.getByTestId("product-card");
  const pagination = page.getByRole("navigation", { name: "Product pagination" });
  const next = pagination.getByRole("button", { name: "Next" });
  const back = pagination.getByRole("button", { name: "Previous" });
  const retryButton = page.getByRole("button", { name: "Retry", exact: true });

  try {
    await next.press("Enter");
    await forward.received;
    forward.release({ status: 503, json: {} });
    await expect(page.getByRole("alert")).toContainText("Showing previous results");
    await expect(products).toContainText("Initial product");
    await expect(next).toBeEnabled(options);

    await retryButton.press("Enter");
    const retried = await retry.received;
    assert.equal(new URL(retried.url()).searchParams.get("page"), "3");
    await expect(next).toBeDisabled(options);
    retry.release({ status: 503, json: {} });
    await expect(retryButton).toBeEnabled(options);
    await expect(next).toBeEnabled(options);
    await expect(back).toBeEnabled(options);
    await expect(
      pagination.getByRole("button", { name: "2", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    await back.press("Enter");
    const request = await previous.received;
    assert.equal(new URL(request.url()).searchParams.get("page"), "1");
    previous.release({ json: { name: "Previous page product" } });
    await expect(products).toContainText("Previous page product");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    forward.release({ status: 503, json: {} });
    retry.release({ status: 503, json: {} });
    previous.release({ json: { name: "Previous page product" } });
  }
}

const authEmail = "hello@example.test";

async function checkAuthHandoff(page, flow) {
  const session = holdResponse();
  const admin = flow === "challenge" || flow === "setup";
  let sessionReadCount = 0;
  await page.route("**/api/auth/session", (route) => {
    sessionReadCount += 1;
    return session.fulfill(route);
  });
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: admin
        ? {
            ok: true,
            isAdmin: true,
            [flow === "setup" ? "requiresTwoFASetup" : "requiresTwoFAChallenge"]: true,
          }
        : { ok: true, isAdmin: false },
    }),
  );
  await page.route("**/api/auth/otp/request", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/auth/otp/verify", (route) =>
    route.fulfill({ json: { ok: true, isAdmin: false } }),
  );
  await page.route("**/api/auth/verify-email", (route) =>
    route.fulfill({ json: { ok: true, nextPath: "/store" } }),
  );
  await page.route("**/api/auth/2fa/enroll*", (route) =>
    route.fulfill({
      json: {
        factorId: "example-factor",
        qrCode:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
      },
    }),
  );
  await page.route("**/api/auth/2fa/verify-enrollment", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/auth/2fa/challenge/verify", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/images/**", (route) => route.fulfill({ status: 204 }));

  const entry = admin ? "password" : flow;
  await openUxHarness(page, bundle, `https://ux.test/auth/fixture/${entry}?next=/store`);

  if (entry === "password") {
    await page.getByTestId("login-email").fill(authEmail);
    await page.getByTestId("login-password").fill("sample-secret");
    await page.getByTestId("login-submit").press("Enter");
  } else if (flow === "otp") {
    await page.locator('input[name="email"]').fill(authEmail);
    await page.getByRole("button", { name: "Send code", exact: true }).press("Enter");
    await page.getByLabel("Verification code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Sign in", exact: true }).press("Enter");
  } else {
    await page.getByLabel("Verification code", { exact: true }).fill("123456");
    await page
      .getByRole("button", { name: "Verify & continue", exact: true })
      .press("Enter");
  }

  if (flow === "challenge") {
    await expect(
      page.getByRole("heading", { name: "Verify your identity" }),
    ).toBeVisible();
    assert.equal(sessionReadCount, 0);
    await page.getByLabel("Authentication code").fill("123456");
    await page.getByRole("button", { name: "Verify", exact: true }).press("Enter");
  } else if (flow === "setup") {
    await expect(page.getByRole("heading", { name: "Set up 2FA" })).toBeVisible();
    assert.equal(sessionReadCount, 0);
    await page
      .getByRole("button", { name: "Generate QR code", exact: true })
      .press("Enter");
    await page.getByLabel("Verification code").fill("123456");
    await page
      .getByRole("button", { name: "Verify & continue", exact: true })
      .press("Enter");
  }

  if (admin) await page.getByRole("button", { name: "Visit storefront" }).press("Enter");

  const header = page.locator("[data-storefront-header]");
  try {
    await expect(
      page.getByRole("heading", { name: "Storefront after sign-in" }),
    ).toBeVisible();
    await expect(header.getByRole("link", { name: "Login", exact: true })).toHaveCount(
      0,
      options,
    );
    await session.received;
    await expect(header.getByTestId("navbar-auth-loading")).toBeVisible();
  } finally {
    session.release({
      json: {
        user: { id: "sample-user", email: authEmail },
        role: admin ? "admin" : "customer",
      },
    });
  }
  await expect(
    header.getByRole("button", { name: "Account", exact: true }),
  ).toContainText(authEmail);
  await expect(header.getByRole("link", { name: "Login", exact: true })).toHaveCount(0);
}

async function checkMenu(page) {
  await emulateOlderAbortSignal(page);
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
  for (const view of [
    "root-missing",
    "missing",
    "store",
    "catalog",
    "cart",
    "account",
    "admin",
    "checkout",
  ]) {
    await check(390, "route recovery " + view, async (page) => {
      await openUxHarness(page, bundle, "https://ux.test/failure?view=" + view);
      await expect(page.getByRole("main")).toHaveCount(1);
      if (view.includes("missing")) {
        await expect(
          page.getByRole("link", { name: "Shop new arrivals" }),
        ).toHaveAttribute("href", "/store");
        return;
      }
      await page.getByRole("button", { name: "Try again" }).press("Enter");
      await expect(page.getByRole("button", { name: /retrying/i })).toBeVisible();
      await page.evaluate(() => window.completeReset("Route recovered"));
      await expect(page.getByText("Route recovered", { exact: true })).toBeVisible();
    });
  }
  await check(
    390,
    "gallery represents held and failed assets without blocking shopping",
    async (page) => {
      const held = holdResponse();
      await page.route("**/local-photo-a.png", held.fulfill);
      await page.route("**/local-photo-b.png", (r) =>
        r.fulfill({
          contentType: "image/gif",
          body: Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64"),
        }),
      );
      await openUxHarness(page, bundle, "https://ux.test/gallery");
      try {
        await held.received;
        const photo = page.getByRole("img", { name: "Held Product", exact: true });
        await expect(photo.locator("..")).toHaveAttribute("aria-busy", "true");
        await expect(photo.locator("..").locator("[data-ui-skeleton]")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
      } finally {
        held.release({ status: 404, body: "missing" });
      }
      await expect(
        page.getByText("Image unavailable", { exact: true }).last(),
      ).toBeVisible();
      await page.getByRole("button", { name: "View product image 2" }).click();
      await expect(
        page.getByRole("img", { name: "Held Product", exact: true }).locator(".."),
      ).not.toHaveAttribute("aria-busy", "true");
      await expect(
        page.getByRole("button", { name: "View product image 2" }),
      ).toHaveAttribute("aria-pressed", "true");
    },
  );
  await check(320, "hard checkout navigation feedback", async (page) => {
    await checkCart(page);
    const link = page.locator("a[data-checkout-link]");
    const document = holdResponse();
    await page.route("**/checkout", document.fulfill);
    try {
      await link.click({ modifiers: ["Control"] });
      await expect(link.getByRole("status")).toHaveCount(0);
      let announced = false;
      await page.exposeFunction("recordCheckoutPending", () => {
        announced = true;
      });
      await link.evaluate((el) => {
        const observer = new MutationObserver(() => {
          if (el.querySelector("[role=status]")?.textContent === "Loading page") {
            observer.disconnect();
            window.recordCheckoutPending();
          }
        });
        observer.observe(el, { childList: true, subtree: true, characterData: true });
      });
      await link.press("Enter", { noWaitAfter: true });
      await expect.poll(() => announced).toBe(true);
    } finally {
      document.release({ body: "Complete", contentType: "text/html" });
    }
    await expect(page).toHaveURL(/\/checkout$/);
  });
  await check(320, "prominent navigation feedback", async (page) => {
    for (const [route, name] of [
      ["home", "Shop Now"],
      ["limited", "Back to home"],
      ["limited", "Retry"],
    ]) {
      await openUxHarness(page, bundle, "https://ux.test/" + route);
      await page.evaluate(() => (window.holdNavigation = true));
      const link = page.getByRole("link", { name: new RegExp("^" + name) });
      await link.click({ modifiers: ["Control"] });
      await expect(link.getByText("Loading page")).toHaveCount(0);
      if (name === "Shop Now") await link.tap();
      else await link.press("Enter");
      await expect(link.getByText("Loading page")).toHaveCount(1);
    }
  });
  await check(320, "homepage merchandise photo feedback", async (page) => {
    const held = holdResponse();
    await page.route("**/photo-*.png", held.fulfill);
    await page.route("**/api/featured-items", (r) =>
      r.fulfill({
        json: {
          featured: [
            {
              id: "one",
              titleDisplay: "Fixture shoe",
              primaryImage: "/photo-one.png",
              minPrice: 500,
            },
          ],
        },
      }),
    );
    await page.route("**/api/store/products?**", (r) =>
      r.fulfill({
        json: {
          products: [
            {
              id: "two",
              name: "Fixture shirt",
              images: [{ url: "/photo-two.png" }],
              variants: [{ stock: 1, sale_price_cents: 500 }],
            },
          ],
        },
      }),
    );
    await openUxHarness(page, bundle, "https://ux.test/home");
    try {
      for (const name of ["Fixture shoe", "Fixture shirt"]) {
        const link = page.getByRole("link", { name: new RegExp(name) });
        await expect(link).toContainText("$5.00");
        await expect(link.locator("[aria-busy=true] [data-ui-skeleton]")).toBeVisible();
      }
    } finally {
      held.release({ status: 404, body: "" });
    }
    for (const name of ["Fixture shoe", "Fixture shirt"])
      await expect(page.getByRole("link", { name: new RegExp(name) })).toContainText(
        "Image unavailable",
      );
  });
  for (const failure of ["storage", "session"])
    await check(320, "product can retry unavailable cart after " + failure, (page) =>
      checkProductCartRecovery(page, failure === "session"),
    );
  for (const drawer of [false, true])
    await check(
      320,
      drawer
        ? "drawer retains last confirmed basket during owner lookup"
        : "cart retains last confirmed basket during owner lookup",
      (page) => checkRetainedCart(page, drawer),
    );
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
    await check(width, "pagination reverses from latest intent", checkPageReversal);
    await check(
      width,
      "pagination follows retained results after a failure",
      checkFailedPageRecovery,
    );
  }
  for (const flow of ["password", "otp", "verify", "challenge", "setup"]) {
    await check(1440, `session follows soft navigation after ${flow}`, (page) =>
      checkAuthHandoff(page, flow),
    );
  }
} finally {
  await browser.close();
}

if (failures.length) throw new AggregateError(failures, "Storefront regressions failed");
