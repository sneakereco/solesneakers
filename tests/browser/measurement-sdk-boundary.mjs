// Run: node tests/browser/measurement-sdk-boundary.mjs
// Uses the installed PostHog SDK and intercepts its real browser transport.
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
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
        captureCheckoutStarted,
        initializeMeasurement,
      } from "./src/lib/measurement/client";

      const test = window.measurementSdkBoundaryTest = {
        boundaryEvent: null,
        complete: false,
      };
      const pause = () => new Promise(resolve => setTimeout(resolve, 60));
      const productId = "123e4567-e89b-42d3-a456-426614174000";
      const variantId = "123e4567-e89b-42d3-a456-426614174001";
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

      (async () => {
        test.hostMatrix = [
          isApprovedMeasurementHostname("soles-stg.vercel.app", "staging"),
          isApprovedMeasurementHostname("soles-stg.vercel.app", "production"),
          isApprovedMeasurementHostname("shopsolesneakers.com", "production"),
          isApprovedMeasurementHostname("shopsolesneakers.com", "staging"),
          isApprovedMeasurementHostname("soles-pro-rose.vercel.app", "production"),
          isApprovedMeasurementHostname("www.shopsolesneakers.com", "production"),
          isApprovedMeasurementHostname("soles-pro-preview.vercel.app", "production"),
        ];
        const originalInit = posthog.init.bind(posthog);
        posthog.init = (...args) => {
          try {
            return originalInit(...args);
          } catch (error) {
            test.initError = String(error?.stack || error);
            throw error;
          }
        };
        initializeMeasurement();
        test.posthogConfig = {
          token: posthog.config.token,
          apiHost: posthog.config.api_host,
          beforeSendType: typeof posthog.config.before_send,
          loaded: posthog.__loaded,
        };
        const originalBeforeSend = posthog.config.before_send;
        posthog.set_config({
          before_send: (event) => {
            test.beforeSendInput = event;
            const result = originalBeforeSend(event);
            test.beforeSendResult = result;
            return result;
          },
        });
        posthog.set_config({
          request_batching: false,
          disable_compression: true,
          // Headless Playwright identifies as automation, which PostHog filters as a bot.
          // Disable that SDK guard only in this harness so the real send boundary executes.
          opt_out_useragent_filter: true,
        });
        posthog.on("eventCaptured", (payload) => {
          if (payload.event === "checkout_started") {
            test.boundaryEvent = payload;
          }
        });
        captureCheckoutStarted();

        for (let attempt = 0; attempt < 50 && !test.boundaryEvent; attempt += 1) {
          await pause();
        }
        if (!test.boundaryEvent) {
          throw new Error("installed SDK did not accept checkout_started");
        }

        const originalCapture = posthog.capture;
        posthog.capture = () => {
          test.failedCaptures = (test.failedCaptures || 0) + 1;
          throw new Error("simulated SDK transport failure");
        };

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
  },
  plugins: [
    {
      name: "measurement-sdk-test-boundaries",
      setup(builder) {
        const mocks = new Map([
          [
            "next/navigation",
            "export const useRouter = () => ({ push() {} }); export const usePathname = () => window.location.pathname;",
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
  await page.route("https://us.i.posthog.com/**", async (route) => {
    const bytes = route.request().postDataBuffer();
    const postData = (
      bytes?.[0] === 0x1f && bytes?.[1] === 0x8b ? gunzipSync(bytes) : bytes
    )?.toString("utf8");
    let payload = null;
    try {
      payload = postData ? JSON.parse(postData) : null;
    } catch {
      // A non-JSON request cannot satisfy the explicit checkout event assertion below.
    }
    transportRequests.push({
      method: route.request().method(),
      url: route.request().url(),
      payload,
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
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
    "https://soles-stg.vercel.app/checkout?utm_source=google&token=sensitive",
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.measurementSdkBoundaryTest?.complete === true);

  const result = await page.evaluate(() => window.measurementSdkBoundaryTest);
  assert.equal(
    result.failure,
    undefined,
    JSON.stringify({
      posthogConfig: result.posthogConfig,
      initError: result.initError,
      beforeSendInput: result.beforeSendInput,
      beforeSendResult: result.beforeSendResult,
    }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(result.hostMatrix, [true, false, true, false, true, false, false]);
  assert.equal(result.checkoutRendered, true);
  assert.equal(result.persistedCart.length, 1);
  assert.equal(result.persistedCart[0].quantity, 1);
  assert.equal(result.finalCart.length, 1);
  assert.equal(result.finalCart[0].quantity, 1);
  assert.equal(result.failedCaptures, 2);
  const checkoutRequest = transportRequests.find(
    (request) =>
      request.method === "POST" &&
      request.payload?.batch?.some((event) => event.event === "checkout_started"),
  );
  assert.ok(
    checkoutRequest,
    `checkout_started must reach the PostHog POST boundary: ${JSON.stringify(transportRequests)}`,
  );

  const properties = result.boundaryEvent.properties;
  assert.deepEqual(Object.keys(properties).sort(), [
    "$geoip_disable",
    "$session_id",
    "distinct_id",
    "environment",
    "landing_pathname",
    "pathname",
    "schema_version",
    "storefront",
    "token",
    "utm_source",
  ]);
  assert.equal(properties.storefront, "sole");
  assert.equal(properties.$geoip_disable, true);
  assert.equal(properties.environment, "staging");
  assert.equal(properties.schema_version, 1);
  assert.equal(properties.pathname, "/checkout");
  assert.equal(properties.landing_pathname, "/checkout");
  assert.equal(properties.utm_source, "google");
  assert.equal(properties.token, projectKey);
  assert.match(properties.distinct_id, /^[0-9a-f-]{36}$/i);
  assert.match(properties.$session_id, /^[0-9a-f-]{36}$/i);
  assert.equal(JSON.stringify(result.boundaryEvent).includes("sensitive"), false);
  assert.equal(JSON.stringify(result.boundaryEvent).includes("$current_url"), false);
  assert.equal(JSON.stringify(result.boundaryEvent).includes("$referrer"), false);
  assert.equal(checkoutRequest.payload.api_key, projectKey);
  assert.equal(checkoutRequest.payload.batch.length, 1);
  assert.deepEqual(checkoutRequest.payload.batch[0].properties, properties);
  assert.equal(checkoutRequest.payload.batch[0].properties.$geoip_disable, true);

  console.log(
    "PASS installed PostHog boundary: sanitized event dispatched; SDK failure preserved cart and checkout",
  );
} finally {
  await browser.close();
}
