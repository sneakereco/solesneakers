// Run: node tests/browser/measurement-sdk-boundary.mjs
// Uses the installed PostHog SDK and intercepts its real browser transport.
import assert from "node:assert/strict";
import { checkMeasurementLifecycle } from "./measurement-lifecycle.mjs";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";
import { chromium } from "playwright";

const projectKey = `phc_${"a".repeat(24)}`;

const privateQueryKey = "phs_private_query_bundle_sentinel";
const identitySecret = "analytics_identity_bundle_sentinel";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import React from "react";
      import {SessionProvider,useSession as useRootSession} from "./src/contexts/SessionContext";
      function SessionProbe(){const session=useRootSession();return <output data-session-user={session.user?.id??"guest"} data-session-available={String(session.sessionAvailable)} />;}
      import {MeasurementProvider} from "./src/Modules/Analytics/Source/Features/VisitorMeasurement/MeasurementProvider";
      import {ClientShell} from "./src/components/shell/ClientShell";
      import { createRoot } from "react-dom/client";
      import posthog from "posthog-js";
      import { configuredMeasurement,isApprovedMeasurementHostname } from "./src/Modules/Analytics/Source/Features/VisitorMeasurement/host-gate";
      import { CartProvider, useCart } from "./src/components/cart/CartProvider";
      import { CheckoutClient } from "./src/components/checkout/CheckoutClient";
      import {captureCheckoutStarted} from "./src/Modules/Analytics/Source/Features/VisitorMeasurement/triggers";
      import {getCheckoutTrackingContext,revokeMeasurement,initializeMeasurement,identifyConsentingCustomer,setMeasurementAccount,capture} from "./src/Modules/Analytics/Source/Features/VisitorMeasurement/client";

      const test = window.measurementSdkBoundaryTest = {
        boundaryEvent: null,
        complete: false,
      };
      test.rawEntryPersisted=false;
      const setItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key.startsWith("ph_") && /sensitive|utm_source=|private-keyword/.test(String(value)))test.rawEntryPersisted=true;
        return setItem.call(this,key,value);
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
        posthog.init = (...args) => {
          try {
            return originalInit(...args);
          } catch (error) {
            test.initError = String(error?.stack || error);
            throw error;
          }
        };
        const cfg=configuredMeasurement();
        const accepted={choice:"accepted",receiptId:"123e4567-e89b-42d3-a456-426614174000"};
        window.actions={nativeId:()=>posthog.get_distinct_id(),nativeSession:()=>posthog.get_session_id(),context:getCheckoutTrackingContext,withdraw:revokeMeasurement,account:setMeasurementAccount,identify:identifyConsentingCustomer,capture:captureCheckoutStarted,accept:()=>initializeMeasurement(cfg,accepted)};
        if(window.fixtureMode==="provider"||window.fixtureMode==="lifecycle"){
          const root=createRoot(document.getElementById("root"));
          const init=posthog.init.bind(posthog);
          posthog.init=(token,options,name)=>init(token,{...options,opt_out_useragent_filter:true,disable_compression:true},name);
          if(window.fixtureMode==="lifecycle"){
            const user=window.initialAccount?{id:window.initialAccount,email:""}:null;
            window.observe=()=>capture({event:"public_page_viewed"});
            const renderLifecycle=(showCheckout)=>root.render(<SessionProvider initialUser={user} initialRole={user?"customer":null}><MeasurementProvider><SessionProbe/>
              {showCheckout ? <CartProvider userId={user?.id}><CheckoutClient initialData={initialData}/></CartProvider> : <div>Store</div>}
            </MeasurementProvider></SessionProvider>);
            window.leaveCheckout=()=>renderLifecycle(false);
            renderLifecycle(window.location.pathname==="/checkout");
            test.complete=true;return;
          }
          window.renderProvider=()=>root.render(<MeasurementProvider><ClientShell><div>Fixture storefront</div></ClientShell></MeasurementProvider>);
          window.renderProvider();test.complete=true;return;
        }
        if(window.fixtureMode==="reload"){
          setMeasurementAccount(window.fixtureAccount??null,false);
          initializeMeasurement(cfg,accepted);
          posthog.set_config({opt_out_useragent_filter:true,disable_compression:true});
          if(window.fixtureAccount)await identifyConsentingCustomer();
          test.complete=true; return;
        }
        initializeMeasurement(cfg,{choice:"unknown"});
        captureCheckoutStarted();
        if(posthog.__loaded || localStorage.length || sessionStorage.length) throw new Error("measurement initialized before consent");
        initializeMeasurement(cfg,{choice:"accepted",receiptId:"123e4567-e89b-42d3-a456-426614174000"});
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
  metafile: true,
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"test"',
    "process.env.NEXT_PUBLIC_POSTHOG_ENABLED": '"true"',
    "process.env.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT": '"staging"',
    "process.env.NEXT_PUBLIC_POSTHOG_PROJECT_KEY": JSON.stringify(projectKey),
    "process.env.NEXT_PUBLIC_POSTHOG_HOST": '"https://us.i.posthog.com"',
    "process.env.POSTHOG_QUERY_API_KEY": JSON.stringify(privateQueryKey),
    "process.env.ANALYTICS_IDENTITY_SECRET": JSON.stringify(identitySecret),
    "process.env.NEXT_PUBLIC_SITE_URL": '"https://www.solesneakersnc.com"',
  },
  plugins: [
    {
      name: "measurement-sdk-test-boundaries",
      setup(builder) {
        const mocks = new Map([
          [
            "@/components/shell/StorefrontHeader",
            "export const StorefrontHeader=()=>null;",
          ],
          ["@/components/shell/Footer", "export const Footer=()=>null;"],
          [
            "next/navigation",
            "export const useRouter = () => ({ push() {} }); export const usePathname = () => window.location.pathname;",
          ],
          ["@/components/ui/Toast", "export const Toast = () => null;"],
          [
            "@/contexts/SessionContext",
            `import {useSession as real} from "./src/contexts/SessionContext"; export const useSession=()=>window.fixtureMode==="lifecycle"?real():(window.fixtureSession??{user:null,role:null,isLoading:false});`,
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

const analyticsInputs = Object.keys(bundle.metafile.inputs).filter((path) =>
  path.includes("Modules/Analytics/Source/Features/"),
);
assert.ok(
  analyticsInputs.some((path) => path.endsWith("/Configuration/public-config.ts")),
);
assert.ok(
  !analyticsInputs.some((path) => path.endsWith("/Configuration/server-config.ts")),
);
for (const file of bundle.outputFiles) {
  assert.ok(
    file.text.includes(projectKey),
    "positive control: the project token is bundled",
  );
  for (const privateValue of [
    privateQueryKey,
    identitySecret,
    "readServerAnalyticsConfig",
    "POSTHOG_QUERY_API_KEY",
    "ANALYTICS_IDENTITY_SECRET",
  ]) {
    assert.ok(
      !file.text.includes(privateValue),
      "private analytics config must stay server-side",
    );
  }
}

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
  const buyerKey = "sole-buyer:v1:" + "b".repeat(64);
  await page.route("**/api/analytics/identity", (route) =>
    route.fulfill({ json: { buyerKey } }),
  );
  await page.goto(
    "https://soles-stg.vercel.app/checkout?utm_source=google&token=sensitive",
    { referer: "https://www.google.com/search?q=private-keyword" },
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

  assert.equal(
    result.rawEntryPersisted,
    false,
    "SDK never writes the raw entry URL or search to storage",
  );
  const properties = result.boundaryEvent.properties;
  assert.deepEqual(Object.keys(properties).sort(), [
    "$geoip_disable",
    "$process_person_profile",
    "$session_id",
    "device",
    "discovery_source",
    "distinct_id",
    "environment",
    "landing_pathname",
    "pathname",
    "referrer_host",
    "schema_version",
    "session_source",
    "storefront",
    "token",
  ]);
  assert.equal(properties.storefront, "sole");
  assert.equal(properties.$geoip_disable, true);
  assert.equal(properties.environment, "staging");
  assert.equal(properties.schema_version, 2);
  assert.equal(properties.pathname, "/checkout");
  assert.equal(properties.landing_pathname, "/checkout");
  assert.equal(properties.discovery_source, "google");
  assert.equal(properties.session_source, "google");
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

  const anon = await page.evaluate(() => window.actions.context());
  assert.match(anon.visitorId, /^[a-f0-9-]{36}$/);
  await page.reload();
  await page.evaluate(() => {
    window.fixtureMode = "reload";
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.measurementSdkBoundaryTest?.complete);
  assert.deepEqual(await page.evaluate(() => window.actions.context()), anon);
  await page.evaluate(async () => {
    history.replaceState(null, "", "/auth/login?token=sensitive");
    window.actions.account(null, true);
    if (window.actions.context()) throw new Error("auth route allowed behavior");
    history.replaceState(null, "", "/checkout?token=sensitive");
    window.actions.account("fixture-customer", false);
    await window.actions.identify();
    window.actions.capture();
  });
  await page.waitForFunction(() =>
    window.actions.context()?.visitorId.startsWith("sole-buyer:"),
  );
  await page.waitForTimeout(200);
  const sent = transportRequests.flatMap((request) => request.payload?.batch ?? []);
  const identify = sent.find((event) => event.event === "$identify");
  assert.ok(identify, "native identify control reached real POST");
  assert.deepEqual(identify.properties, {
    token: projectKey,
    distinct_id: buyerKey,
    $session_id: anon.sessionId,
    $anon_distinct_id: anon.visitorId,
    $geoip_disable: true,
    $process_person_profile: true,
  });
  assert.equal(identify.$set, undefined);
  assert.equal(identify.$set_once, undefined);
  assert.ok(
    sent.some(
      (event) =>
        event.event === "checkout_started" && event.properties.distinct_id === buyerKey,
    ),
  );
  const optional = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  assert.ok(
    !optional.includes("sensitive") && !optional.includes("utm_source="),
    "native storage must exclude raw entry URL",
  );
  await page.evaluate(() => window.actions.account(null, false));
  const guest = await page.evaluate(() => window.actions.context());
  assert.notEqual(guest.visitorId, anon.visitorId);
  assert.notEqual(guest.sessionId, anon.sessionId);
  await page.evaluate(() => {
    window.actions.withdraw();
    window.actions.capture();
  });
  assert.equal(await page.evaluate(() => window.actions.context()), null);
  assert.deepEqual(
    await page.evaluate(() =>
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(
        (k) =>
          k.startsWith("ph_") || k.startsWith("sole_analytics") || k.includes("ph_opt"),
      ),
    ),
    [],
  );
  const sentCount = transportRequests.length;
  await page.evaluate(() => window.actions.capture());
  await page.waitForTimeout(120);
  assert.equal(transportRequests.length, sentCount);
  const context = await browser.newContext();
  const flow = await context.newPage();
  const flowWire = [];
  let choice = { choice: "unknown" };
  let offline = true;
  let preferencePosts = 0;
  await flow.context().route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "us.i.posthog.com") {
      const bytes = req.postDataBuffer();
      if (bytes)
        flowWire.push(
          JSON.parse((bytes[0] === 0x1f ? gunzipSync(bytes) : bytes).toString()),
        );
      return route.fulfill({ json: {} });
    }
    if (url.pathname === "/api/analytics/preferences") {
      if (req.method() === "POST") {
        preferencePosts++;
        const next = req.postDataJSON().choice;
        if (next === "declined" && offline)
          return route.fulfill({ status: 503, json: {} });
        choice =
          next === "accepted"
            ? { choice: next, receiptId: anon.receiptId }
            : { choice: next };
      }
      return route.fulfill({ json: choice });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  async function mountFlow(role = null) {
    await flow.evaluate((role) => {
      window.fixtureMode = "provider";
      window.fixtureSession = {
        role,
        user: role ? { id: "fixture" } : null,
        isLoading: false,
      };
    }, role);
    await flow.addScriptTag({ content: bundle.outputFiles[0].text });
  }
  await flow.goto("https://soles-stg.vercel.app/store?utm_campaign=test-campaign");
  await mountFlow("admin");
  await flow.waitForTimeout(120);
  assert.equal(await flow.getByText("Shopping analytics").count(), 0);
  await flow.evaluate(() => {
    window.fixtureSession = { role: null, user: null, isLoading: false };
    window.renderProvider();
  });
  await flow.getByRole("button", { name: "Allow analytics" }).waitFor();
  assert.equal(flowWire.length, 0);
  assert.deepEqual(
    await flow.evaluate(() => [
      Object.keys(localStorage),
      Object.keys(sessionStorage),
      document.cookie,
    ]),
    [[], [], ""],
  );
  await flow.evaluate(() => window.actions.capture());
  await flow.getByRole("button", { name: "Allow analytics" }).click();
  await flow.getByRole("button", { name: "Privacy choices" }).waitFor();
  await flow.waitForTimeout(200);
  assert.deepEqual(
    flowWire
      .flatMap((req) => req.batch)
      .map((ev) => ev.event)
      .sort(),
    ["public_page_viewed", "storefront_viewed"],
  );
  const peer = await flow.context().newPage();
  await peer.goto("https://soles-stg.vercel.app/store");
  await peer.evaluate(() => {
    window.fixtureMode = "provider";
  });
  await peer.addScriptTag({ content: bundle.outputFiles[0].text });
  await peer.waitForFunction(() => !!window.actions?.context());
  await flow.getByRole("button", { name: "Privacy choices" }).click();
  await flow.getByRole("button", { name: "Decline", exact: true }).click();
  await flow.getByRole("button", { name: "Retry saving" }).waitFor();
  assert.equal(await flow.evaluate(() => window.actions.context()), null);
  await peer.getByRole("button", { name: "Retry saving" }).waitFor();
  assert.equal(await peer.evaluate(() => window.actions.context()), null);
  const priorCount = flowWire.length;
  await peer.evaluate(() => window.actions.capture());
  await flow.reload();
  await mountFlow();
  await flow.getByRole("button", { name: "Retry saving" }).waitFor();
  assert.equal(flowWire.length, priorCount);
  offline = false;
  await flow.getByRole("button", { name: "Retry saving" }).click();
  await flow.getByRole("button", { name: "Privacy choices" }).waitFor();
  assert.equal(choice.choice, "declined");
  assert.ok(preferencePosts >= 4);
  for (const tested of [page, peer, flow])
    assert.equal(
      await tested.evaluate(() => window.measurementSdkBoundaryTest.rawEntryPersisted),
      false,
      "no raw SDK write after reload, identity, or session transition",
    );
  await checkMeasurementLifecycle(browser, bundle.outputFiles[0].text);
  await peer.close();
  await flow.close();
  console.log(
    "PASS installed PostHog boundary: sanitized event dispatched; SDK failure preserved cart and checkout",
  );
} finally {
  await browser.close();
}
