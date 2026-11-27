// Run: node tests/browser/measurement-trigger-sites.mjs
// Mounts the real Phase A trigger components in a browser; hosted services are replaced.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import React from "react";
      import { flushSync } from "react-dom";
      import { createRoot } from "react-dom/client";
      import { ClientShell } from "./src/components/shell/ClientShell";
      import { CartProvider, useCart } from "./src/components/cart/CartProvider";
      import { SearchOverlay } from "./src/components/search/SearchOverlay";
      import { ProductDetail } from "./src/components/store/ProductDetail";
      import { CheckoutClient } from "./src/components/checkout/CheckoutClient";
      import CheckoutPage from "./src/app/checkout/page";
      import { isApprovedMeasurementHostname } from "./src/Modules/Analytics/Source/Features/VisitorMeasurement/host-gate";
      import { sanitizeMeasurementEvent } from "./src/Modules/Analytics/Source/Features/VisitorMeasurement/contract";

      window.testGrant = "consented";
      const test = window.measurementTriggerTest = { events: [], payloads: [] };
      const assert = {
        deepEqual(actual, expected, message) {
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(message + ": " + JSON.stringify(actual));
          }
        },
      };
      (async () => {
      assert.deepEqual([
        isApprovedMeasurementHostname("soles-stg.vercel.app", "staging"),
        isApprovedMeasurementHostname("soles-stg.vercel.app", "production"),
        isApprovedMeasurementHostname("www.solesneakersnc.com", "production"),
        isApprovedMeasurementHostname("www.solesneakersnc.com", "staging"),
        isApprovedMeasurementHostname("solesneakersnc.com", "production"),
        isApprovedMeasurementHostname("www.solesneakers.com", "production"),
        isApprovedMeasurementHostname("shopsolesneakers.com", "production"),
        isApprovedMeasurementHostname("soles-pro-rose.vercel.app", "production"),
        isApprovedMeasurementHostname("www.shopsolesneakers.com", "production"),
        isApprovedMeasurementHostname("soles-pro-preview.vercel.app", "production"),
      ], [true, false, true, false, false, false, false, false, false, false], "exact host/environment matrix");
      const privacyProbe = sanitizeMeasurementEvent("storefront_viewed", {
        storefront: "sole", environment: "production", schema_version: 2,
        pathname: "/store", $geoip_disable: false, $current_url: "https://unsafe.example/",
      });
      if (!privacyProbe || privacyProbe.properties.$geoip_disable !== true) {
        throw new Error("production contract must force GeoIP opt-out");
      }
      await fetch("/measurement-probe", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(privacyProbe),
      });
      const pause = () => new Promise(resolve => setTimeout(resolve, 40));
      const rootElement = document.getElementById("root");
      let root = createRoot(rootElement);
      const resetRoot = async () => {
        root.unmount();
        await pause();
        rootElement.innerHTML = "";
        root = createRoot(rootElement);
      };
      const render = async element => {
        root.render(element);
        await pause();
      };
      const product = {
        id: "123e4567-e89b-42d3-a456-426614174000",
        name: "Air Runner",
        condition: "new",
        description: "Test product",
        brand: { id: "brand-1", label: "Sole" },
        model: null,
        images: [{ id: "image-1", url: "/shoe.png", is_primary: true }],
        variants: [{
          id: "123e4567-e89b-42d3-a456-426614174001",
          stock: 1,
          sale_price_cents: 10000,
          size: { id: "size-1", label: "10" },
        }],
      };
      const initialData = {
        isGuest: true,
        customer: {
          email: "",
          address: {
            name: "", phone: "", line1: "", line2: "", city: "", state: "",
            postalCode: "", country: "US",
          },
        },
        paymentConfig: {
          applicationId: "sandbox-app",
          locationId: "sandbox-location",
          environment: "sandbox",
        },
      };
      let addItem;
      function CartProbe() {
        addItem = useCart().addItem;
        return null;
      }

      window.testPathname = "/";
      await render(<ClientShell><div /></ClientShell>);
      assert.deepEqual(test.events, [], "/ must not emit storefront_viewed");
      window.testPathname = "/store";
      await render(<ClientShell><div /></ClientShell>);
      assert.deepEqual(test.events, ["storefront_viewed"], "/store must emit once");
      await render(<ClientShell><div /></ClientShell>);
      assert.deepEqual(test.events, ["storefront_viewed"], "/store rerender must not duplicate");

      await resetRoot();
      test.events = [];
      sessionStorage.clear();
      await render(<CartProvider><ProductDetail product={product} /></CartProvider>);
      assert.deepEqual(test.events, ["product_viewed"], "product mount must emit once");
      await render(<CartProvider><ProductDetail product={{ ...product }} /></CartProvider>);
      assert.deepEqual(test.events, ["product_viewed"], "product rerender must not duplicate");
      await resetRoot();
      await render(<CartProvider><ProductDetail product={product} /></CartProvider>);
      assert.deepEqual(
        test.events,
        ["product_viewed", "product_viewed"],
        "true product remount must emit a new view",
      );
      await resetRoot();
      test.events=[];
      const soldOut={...product.variants[0],stock:0,id:"123e4567-e89b-42d3-a456-426614174002",size:{id:"size-2",label:"11"}};
      await render(<CartProvider><ProductDetail product={{...product,variants:[product.variants[0],soldOut]}} /></CartProvider>);
      const sizes=rootElement.querySelectorAll("fieldset button");
      sizes[1].click();
      sizes[1].focus();
      test.keyboardReady=true;
      while(!test.keyboardDone)await pause();
      assert.deepEqual([sizes[1].getAttribute("aria-disabled"),sizes[0].getAttribute("aria-pressed"),sizes[1].getAttribute("aria-pressed")],["true","true","false"],"unavailable size cannot change selection");
      sizes[0].click();
      assert.deepEqual(test.events,["product_viewed","unavailable_size_requested","unavailable_size_requested","variant_selected"],"size intent differs from successful available selection");
      await resetRoot();
      test.events=[];
      await render(<CartProvider><ProductDetail product={{...product,variants:[soldOut]}} /></CartProvider>);
      assert.deepEqual(test.events,["product_viewed","out_of_stock_viewed"],"all known variants unavailable at view");
      await resetRoot();test.events=[];test.payloads=[];
      const realFetch=window.fetch;let finishStale;
      window.fetch=async (url,...args)=>{
        if(typeof url!=="string" || !url.startsWith("/api/store/products"))return realFetch(url,...args);
        if(url.includes("stale"))return new Promise(resolve=>{finishStale=()=>resolve(Response.json({products:[product],total:99}));});
        if(url.includes("failed"))return new Response(null,{status:503});
        return Response.json(url.includes("Sole")?{products:[{...product,brand:{id:product.id,label:"Sole"}}],total:1}:{products:[],total:0});
      };
      await render(<SearchOverlay isOpen={true} onClose={()=>{}}/>);
      const search=async text=>{
        const field=document.querySelector('[role="dialog"] [role="searchbox"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,text);
        field.dispatchEvent(new Event("input",{bubbles:true}));await new Promise(r=>setTimeout(r,360));
      };
      await search("stale");await search("Sole");finishStale();await pause();
      await search("failed");await search("private@example.com");
      assert.deepEqual(test.payloads,[{event:"catalog_search_results",result_count:1,concept_kind:"brand",concept_id:product.id},{event:"catalog_search_results",result_count:0}],"only current successful safe search evidence");
      window.fetch=realFetch;

      await resetRoot();
      test.events = [];
      sessionStorage.clear();
      await render(<CartProvider><CartProbe /></CartProvider>);
      addItem({
        productId: product.id,
        variantId: product.variants[0].id,
        sizeLabel: "10",
        brand: "Sole",
        name: product.name,
        titleDisplay: product.name,
        priceCents: 10000,
        imageUrl: "/shoe.png",
        maxStock: 1,
      });
      await pause();
      assert.deepEqual(test.events, ["product_added_to_cart"], "accepted persisted add must emit once");
      addItem({
        productId: product.id,
        variantId: product.variants[0].id,
        sizeLabel: "10",
        brand: "Sole",
        name: product.name,
        titleDisplay: product.name,
        priceCents: 10000,
        imageUrl: "/shoe.png",
        maxStock: 1,
      });
      await pause();
      assert.deepEqual(test.events, ["product_added_to_cart"], "stock-capped add must emit zero");

      await resetRoot();
      test.events = [];
      sessionStorage.clear();
      for (const initialGrant of [null, "previous-receipt"]) {
        window.testGrant = initialGrant;
        await render(<CartProvider><CartProbe /></CartProvider>);
        const saved = addItem({
          productId: product.id, variantId: product.variants[0].id, sizeLabel: "10",
          brand: "Sole", name: product.name, titleDisplay: product.name,
          priceCents: 10000, imageUrl: "/shoe.png", maxStock: 1,
        });
        window.testGrant = "new-receipt";
        flushSync(() => root.render(<CartProvider><CartProbe /></CartProvider>));
        assert.deepEqual(await saved,true,"grant transition preserves the committed cart write");
        assert.deepEqual(test.events,[],"later consent cannot publish a preexisting cart action");
        await resetRoot();
        sessionStorage.clear();
      }
      window.testGrant = "consented";
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("storage unavailable"); };
      await render(<CartProvider><CartProbe /></CartProvider>);
      addItem({
        productId: product.id,
        variantId: product.variants[0].id,
        sizeLabel: "10",
        brand: "Sole",
        name: product.name,
        titleDisplay: product.name,
        priceCents: 10000,
        imageUrl: "/shoe.png",
        maxStock: 1,
      });
      await pause();
      Storage.prototype.setItem = originalSetItem;
      assert.deepEqual(test.events, [], "failed persisted add must emit zero");

      await resetRoot();
      test.events = [];
      sessionStorage.clear();
      sessionStorage.setItem("rdk_cart_session", JSON.stringify([{
        productId: product.id,
        variantId: product.variants[0].id,
        sizeLabel: "10",
        brand: "Sole",
        name: product.name,
        titleDisplay: product.name,
        priceCents: 10000,
        imageUrl: "/shoe.png",
        maxStock: 1,
        quantity: 1,
      }]));
      const lockedPage = await CheckoutPage();
      await render(lockedPage);
      if (!document.body.textContent.includes("Checkout Locked")) {
        throw new Error("real checkout page did not take its locked branch");
      }
      assert.deepEqual(test.events, [], "locked checkout must emit zero");

      await resetRoot();
      test.events = [];
      sessionStorage.clear();
      await render(<CartProvider><CheckoutClient initialData={initialData} /></CartProvider>);
      assert.deepEqual(test.events, [], "ready empty checkout must emit zero");

      await resetRoot();
      test.events = [];
      sessionStorage.clear();
      sessionStorage.setItem("rdk_cart_session", JSON.stringify([{
        productId: product.id,
        variantId: product.variants[0].id,
        sizeLabel: "10",
        brand: "Sole",
        name: product.name,
        titleDisplay: product.name,
        priceCents: 10000,
        imageUrl: "/shoe.png",
        maxStock: 1,
        quantity: 1,
      }]));
      await render(<CartProvider><CheckoutClient initialData={initialData} /></CartProvider>);
      assert.deepEqual(test.events, ["checkout_started"], "ready nonempty checkout must emit once");
      await render(<CartProvider><CheckoutClient initialData={initialData} /></CartProvider>);
      assert.deepEqual(test.events, ["checkout_started"], "usable checkout rerender must not duplicate");
      window.measurementTriggerTest.complete = true;
      })().catch(error => {
        test.failure = String(error?.stack || error);
        test.complete = true;
        throw error;
      });
    `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"test"',
    "process.env.NEXT_PUBLIC_SITE_URL": '"https://www.solesneakersnc.com"',
    "process.env": "{}",
  },
  plugins: [
    {
      name: "measurement-trigger-test-boundaries",
      setup(builder) {
        const mocks = new Map([
          [
            "@/Modules/Analytics/Source/Features/VisitorMeasurement/view-grant",
            "export const useViewGrant = () => window.testGrant; export const useCheckoutMeasurement=()=>'ready';",
          ],
          [
            "next/navigation",
            `
          export const usePathname = () => window.testPathname;
          export const useRouter = () => ({ push() {} });
        `,
          ],
          [
            "next/image",
            "export default props => <img alt={props.alt || ''} src={props.src} />;",
          ],
          [
            "next/link",
            "export const useLinkStatus = () => ({ pending: false }); export default ({ children, onNavigate, ...props }) => <a {...props}>{children}</a>;",
          ],
          ["@/components/shell/Footer", "export const Footer = () => null;"],
          [
            "@/components/shell/StorefrontHeader",
            "export const StorefrontHeader = () => null;",
          ],
          ["@/components/ui/Toast", "export const Toast = () => null;"],
          [
            "@/lib/checkout/checkout-page-access",
            "export const loadCheckoutPageAccess = async () => ({ open: false, message: 'Checkout paused for maintenance' });",
          ],
          [
            "@/lib/checkout/checkout-page-data",
            "export const loadCheckoutPageData = async () => { throw new Error('locked page must not load checkout data'); };",
          ],
          ["@/lib/utils/log", "export const logError = () => {};"],
          [
            "@/contexts/SessionContext",
            "const session={user:null,isIdentityCurrent:owner=>owner===null}; export const useSession=()=>session;",
          ],
          [
            "@/components/checkout/CheckoutContactSection",
            "export const CheckoutContactSection = () => <div data-contact />;",
          ],
          [
            "@/components/checkout/CheckoutDeliverySection",
            "export const CheckoutDeliverySection = () => <div data-delivery />;",
          ],
          [
            "@/components/checkout/CheckoutHeader",
            "export const CheckoutHeader = () => <header />;",
          ],
          [
            "@/components/checkout/CheckoutPaymentDialog",
            "export const CheckoutPaymentDialog = () => <div data-payment-dialog />;",
          ],
          [
            "@/components/checkout/CheckoutOrderSummary",
            "export const CheckoutOrderSummary = () => <div data-summary />;",
          ],
          [
            "@/components/checkout/SquarePaymentMethods",
            "export class CheckoutCartUnavailable extends Error {}; export const SquarePaymentMethods = ({ children }) => <div data-payment>{children}</div>;",
          ],
          [
            "@/lib/checkout/client-session",
            `
          export const getOrCreateCheckoutDeviceSessionId = () => "device";
          export const getOrCreateCheckoutIdempotencyKey = () => "idempotency";
          export const rememberPendingCheckoutAttempt = () => {}; export const clearCheckoutAttempt = () => {}; export const storeGuestOrderAccess = () => {};
        `,
          ],
          [
            "@/lib/checkout/idempotency",
            "export const clearIdempotencyKeyFromStorage = () => {};",
          ],
        ]);
        builder.onResolve({ filter: /^\.\/client$/ }, (args) =>
          args.importer.endsWith("triggers.ts")
            ? { path: "capture-test", namespace: "measurement-test" }
            : null,
        );
        mocks.set(
          "capture-test",
          "export const capture = event => {window.measurementTriggerTest.events.push(event.event);window.measurementTriggerTest.payloads.push(event);};",
        );
        builder.onResolve({ filter: /.*/ }, (args) =>
          mocks.has(args.path)
            ? { path: args.path, namespace: "measurement-test" }
            : null,
        );
        builder.onLoad({ filter: /.*/, namespace: "measurement-test" }, (args) => ({
          contents: mocks.get(args.path),
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  if (
    process.platform !== "win32" ||
    !String(error).includes("Executable doesn't exist")
  ) {
    throw error;
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
}
try {
  const page = await browser.newPage();
  const errors = [];
  let outgoingProbe = null;
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  await page.route("http://measurement.test/measurement-probe", (route) => {
    outgoingProbe = JSON.parse(route.request().postData());
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/cart/validate", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' }),
  );
  await page.route("**/api/checkout/quote", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completeness: "preliminary",
        quoteFingerprint: null,
        totals: {
          subtotalCents: 10000,
          shippingCents: 0,
          taxCents: null,
          totalCents: 10000,
        },
      }),
    }),
  );
  await page.route("http://measurement.test/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<div id="root"></div>',
    }),
  );
  await page.goto("http://measurement.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.measurementTriggerTest?.keyboardReady === true);
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    window.measurementTriggerTest.keyboardDone = true;
  });
  await page.waitForFunction(() => window.measurementTriggerTest?.complete === true);
  assert.deepEqual(errors, []);
  assert.equal(outgoingProbe.event, "storefront_viewed");
  assert.equal(outgoingProbe.properties.$geoip_disable, true);
  assert.equal("$current_url" in outgoingProbe.properties, false);
  console.log(
    "PASS browser trigger sites: storefront, safe search, size selection with mouse and keyboard, stockout, cart, checkout",
  );
} finally {
  await browser.close();
}
