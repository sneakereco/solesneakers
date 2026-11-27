// Run: node tests/browser/measurement-sdk-boundary.mjs
// Uses the installed PostHog SDK and intercepts its real browser transport.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const projectKey = `phc_${"a".repeat(24)}`;

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import posthog from "posthog-js";
      import { isApprovedMeasurementHostname } from "./src/lib/measurement/host-gate";
      import { CartProvider, useCart } from "./src/components/cart/CartProvider";
      import { CheckoutClient } from "./src/components/checkout/CheckoutClient";
      import {
        filterOutgoingEvent,
        captureCheckoutStarted,
        initializeMeasurement,
      } from "./src/lib/measurement/client";

      const test = window.measurementSdkBoundaryTest = {
        initCalls: 0, captureCalls: 0,
        complete: false,
      };
      const pause = () => new Promise(resolve => setTimeout(resolve, 60));
      const productId = "123e4567-e89b-42d3-a456-426614174000";
      const variantId = "123e4567-e89b-42d3-a456-426614174001";
      const initialData = {
        ownerId:null,
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

      (async () => {
        test.hostMatrix = [
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
        ];
        const originalInit = posthog.init.bind(posthog);
        posthog.init = (...args) => { test.initCalls++; return originalInit(...args); };
        const originalCapture = posthog.capture.bind(posthog);
        posthog.capture = (...args) => {test.captureCalls++; return originalCapture(...args);};
        await import("./src/instrumentation-client");
        initializeMeasurement();
        captureCheckoutStarted();
        const permit = new URL(location.href).searchParams.get("utm_source");
        const key = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY;
        const filtered = filterOutgoingEvent({event:"checkout_started",properties:{
          token:key,distinct_id:"01990f14-c5f9-7bc8-9d22-f560a81f2381",$session_id:"01990f14-c5f9-7bc8-9d22-f560a81f2382",
          storefront:"sole",environment:"staging",schema_version:1,pathname:"/checkout",utm_source:permit,
        }},key,"staging");
        test.credentialRemoved = Boolean(permit && filtered && !JSON.stringify(filtered).includes(permit));
        const rootElement = document.getElementById("root");
        let root = createRoot(rootElement);
        history.replaceState(null, "", "/store/" + productId);
        root.render(<CartProvider><CartProbe /></CartProvider>);
        await pause();
        addItem({
          productId,
          variantId,
          sizeLabel: "10",
          brand: "Sole",
          name: "Air Runner",
          titleDisplay: "Air Runner",
          priceCents: 10000,
          imageUrl: "/shoe.png",
          maxStock: 1,
        });
        await pause();
        test.persistedCart = JSON.parse(sessionStorage.getItem("rdk_cart_session") || "[]");

        root.unmount();
        await pause();
        rootElement.innerHTML = "";
        root = createRoot(rootElement);
        history.replaceState(null, "", "/checkout");
        root.render(<CartProvider><CheckoutClient initialData={initialData} /></CartProvider>);
        for (let attempt = 0; attempt < 50; attempt += 1) {
          test.checkoutRendered = Boolean(
            document.querySelector("[data-contact]") &&
            document.querySelector("[data-delivery]") &&
            document.querySelector("[data-summary]"),
          );
          if (test.checkoutRendered) {
            break;
          }
          await pause();
        }

        test.finalCart = JSON.parse(sessionStorage.getItem("rdk_cart_session") || "[]");
        test.storageTouches = window.optionalStorageTouches;
        posthog.capture = originalCapture;
        test.complete = true;
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
    "process.env.NEXT_PUBLIC_POSTHOG_ENABLED": '"true"',
    "process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT": '"staging"',
    "process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY": JSON.stringify(projectKey),
    "process.env.NEXT_PUBLIC_POSTHOG_HOST": '"https://us.i.posthog.com"',
    "process.env.NEXT_PUBLIC_SITE_URL": '"https://www.solesneakersnc.com"',
  },
  plugins: [
    {
      name: "measurement-sdk-test-boundaries",
      setup(builder) {
        const mocks = new Map([
          ["botid/client/core", "export const initBotId=()=>{};"],
          [
            "next/navigation",
            "export const useRouter = () => ({ push() {} }); export const usePathname = () => window.location.pathname;",
          ],
          ["@/components/ui/Toast", "export const Toast = () => null;"],
          [
            "@/contexts/SessionContext",
            "const verified = { user:null, status:'ready', isCurrent:()=>true, refreshSession:async()=>{} }; export const useSession=()=>verified;",
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
            "@/Modules/Checkout/Source/Client",
            `
              export const getOrCreateCheckoutDeviceSessionId = () => "device";
              export const useProcessingCredential=()=>undefined; export const useCheckoutRegistration=()=>undefined; export const capturePreparedAttempt=()=>{throw Error("unexpected prepare")};
              export const readGuestOrderAccess=()=>null; export const needsOriginalRecovery=()=>false; export const recoverOriginalOrder=()=>{throw Error("unexpected recovery")};
            `,
          ],
          [
            "@/lib/checkout/idempotency",
            "export const clearIdempotencyKeyFromStorage = () => {};",
          ],
        ]);
        builder.onResolve({ filter: /.*/ }, (args) =>
          mocks.has(args.path)
            ? { path: args.path, namespace: "measurement-sdk-test" }
            : null,
        );
        builder.onLoad({ filter: /.*/, namespace: "measurement-sdk-test" }, (args) => ({
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
  const transportRequests = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.route("**/*", (route) => route.abort());
  await page.addInitScript(() => {
    window.optionalStorageTouches = [];
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        if (/posthog|^ph_|phase_a_attribution/i.test(String(key)))
          window.optionalStorageTouches.push(method);
        return original.call(this, key, ...args);
      };
    }
  });
  await page.route("https://us.i.posthog.com/**", (route) => {
    transportRequests.push(route.request().method());
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("https://soles-stg.vercel.app/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<div id="root"></div>',
    }),
  );
  await page.route("**/api/cart/validate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            productId: "123e4567-e89b-42d3-a456-426614174000",
            variantId: "123e4567-e89b-42d3-a456-426614174001",
            sizeLabel: "10",
            brand: "Sole",
            name: "Air Runner",
            titleDisplay: "Air Runner",
            priceCents: 10000,
            imageUrl: "/shoe.png",
            maxStock: 1,
            quantity: 1,
          },
        ],
      }),
    }),
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
  await page.goto(
    "https://soles-stg.vercel.app/checkout?utm_source=ba6ce9ab-4aa2-40aa-8514-d5ecd17392f3&token=synthetic",
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.measurementSdkBoundaryTest?.complete === true);

  const result = await page.evaluate(() => window.measurementSdkBoundaryTest);
  assert.equal(result.failure, undefined);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.hostMatrix, [
    true,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
  assert.equal(result.checkoutRendered, true);
  assert.equal(result.persistedCart.length, 1);
  assert.equal(result.persistedCart[0].quantity, 1);
  assert.equal(result.finalCart.length, 1);
  assert.equal(result.finalCart[0].quantity, 1);
  assert.equal(result.credentialRemoved, true);
  assert.equal(result.initCalls, 0);
  assert.equal(result.captureCalls, 0);
  assert.deepEqual(result.storageTouches, []);
  assert.deepEqual(transportRequests, []);
  console.log(
    "PASS installed Chromium/PostHog boundary: zero optional startup/storage/capture/transport; cart and checkout remain functional",
  );
} finally {
  await browser.close();
}
