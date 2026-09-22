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
      import { createRoot } from "react-dom/client";
      import { ClientShell } from "./src/components/shell/ClientShell";
      import { CartProvider, useCart } from "./src/components/cart/CartProvider";
      import { ProductDetail } from "./src/components/store/ProductDetail";
      import { CheckoutClient } from "./src/components/checkout/CheckoutClient";

      const test = window.measurementTriggerTest = { events: [] };
      const assert = {
        deepEqual(actual, expected, message) {
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(message + ": " + JSON.stringify(actual));
          }
        },
      };
      (async () => {
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
  define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
  plugins: [
    {
      name: "measurement-trigger-test-boundaries",
      setup(builder) {
        const mocks = new Map([
          [
            "@/lib/measurement/client",
            `
          const emit = name => window.measurementTriggerTest.events.push(name);
          export const captureStorefrontViewed = () => emit("storefront_viewed");
          export const captureProductViewed = () => emit("product_viewed");
          export const captureProductAddedToCart = () => emit("product_added_to_cart");
          export const captureCheckoutStarted = () => emit("checkout_started");
        `,
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
            "export default ({ children, ...props }) => <a {...props}>{children}</a>;",
          ],
          ["@/components/shell/Footer", "export const Footer = () => null;"],
          [
            "@/components/shell/StorefrontHeader",
            "export const StorefrontHeader = () => null;",
          ],
          ["@/components/ui/Toast", "export const Toast = () => null;"],
          [
            "@/contexts/SessionContext",
            "export const useSession = () => ({ user: null });",
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
            "export const SquarePaymentMethods = ({ children }) => <div data-payment>{children}</div>;",
          ],
          [
            "@/lib/checkout/client-session",
            `
          export const getOrCreateCheckoutDeviceSessionId = () => "device";
          export const getOrCreateCheckoutIdempotencyKey = () => "idempotency";
          export const storeGuestOrderAccess = () => {};
        `,
          ],
          [
            "@/lib/checkout/idempotency",
            "export const clearIdempotencyKeyFromStorage = () => {};",
          ],
        ]);
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/cart/validate", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' }),
  );
  await page.route("**/api/checkout/quote", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completeness: "estimate",
        quoteFingerprint: "a".repeat(64),
        totals: {
          subtotalCents: 10000,
          shippingCents: 0,
          taxCents: 0,
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
  await page.waitForFunction(() => window.measurementTriggerTest?.complete === true);
  assert.deepEqual(errors, []);
  console.log("PASS browser trigger sites: storefront, product, cart, checkout");
} finally {
  await browser.close();
}
