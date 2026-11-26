import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { registry } from "playwright-core/lib/server/registry/index";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "https://checkout-fixture.invalid";
const viewPaths = {
  product: "/product",
  password: "/password",
  otp: "/otp",
  profile: "/account",
  navbar: "/navbar",
  cart: "/cart",
  checkout: "/checkout",
  receipt: "/checkout/success",
};
const framework = {
  "next/navigation": `
    import { useSyncExternalStore } from "react";
    const subscribe = callback => {
      window.addEventListener("popstate", callback);
      return () => window.removeEventListener("popstate", callback);
    };
    const currentURL = () => location.href;
    const navigate = (method, url) => {
      history[method]({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    };
    const router = {
      push: url => navigate("pushState", url),
      replace: url => navigate("replaceState", url),
      back: () => history.back(),
      refresh: () => window.dispatchEvent(new PopStateEvent("popstate")),
    };
    export const useRouter = () => router;
    export const usePathname = () => new URL(useSyncExternalStore(subscribe, currentURL)).pathname;
    export const useSearchParams = () => new URL(useSyncExternalStore(subscribe, currentURL)).searchParams;
  `,
  "next/link": "export default props => <a {...props} />;",
  "next/image": `
    export default ({ src, fill, priority, unoptimized, loader, ...props }) =>
      <img {...props} data-image-src={src} src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" />;
  `,
  "@/lib/measurement/client": `
    export const captureProductAddedToCart = () => {window.fixtureAdded=(window.fixtureAdded??0)+1};
    export const captureProductViewed = () => {};
    export const captureCheckoutStarted = () => {};
  `,
};

let bundle;
function browserBundle() {
  bundle ??= build({
    absWorkingDir: root,
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import { useEffect, useState } from "react";
        import { createRoot } from "react-dom/client";
        import { usePathname } from "next/navigation";
        import { CartProvider, useCart } from "./src/components/cart/CartProvider";
        import { CartDrawer } from "./src/components/cart/CartDrawer";
        import { SessionProvider, useSession } from "./src/contexts/SessionContext";
        import { CheckoutClient } from "./src/components/checkout/CheckoutClient";
        import CheckoutLayout from "./src/app/checkout/layout";
        import CancelPage from "./src/app/checkout/cancel/page";
        import ProcessingPage from "./src/app/checkout/processing/page";
        import ReceiptPage from "./src/app/checkout/success/page";

        import {ProductDetail} from "./src/components/store/ProductDetail";
        import {PasswordLoginForm} from "./src/components/auth/login/PasswordLoginForm";
        import {OtpLoginForm} from "./src/components/auth/login/OtpLoginForm";
        import {AccountProfile} from "./src/components/account/AccountProfile";
        import {Navbar} from "./src/components/shell/Navbar";
        function Probe() {
          const cart = useCart();
          const session = useSession();
          useEffect(() => {
            window.testCart = cart;
            window.testSession = session;
          });
          return null;
        }

        const { initialUser, view } = window.checkoutFixture;
        const initialData = {
          isGuest: !initialUser,
          customer: {
            email: initialUser?.email ?? "",
            address: { name: "", phone: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" },
          },
          paymentConfig: { applicationId: "fixture-square", locationId: "fixture-location", environment: "sandbox" },
        };
        function CheckoutView() {
          const path = usePathname();
          if (path === "/checkout/processing") return <ProcessingPage />;
          if (path === "/checkout/cancel") return <CancelPage />;
          if (path === "/checkout/success" || view === "receipt") return <ReceiptPage />;
          return <CheckoutClient initialData={initialData} />;
        }

        function View() {
          const [open, setOpen] = useState(true);
          if(location.pathname==="/password")return <PasswordLoginForm onRequiresEmailVerification={()=>{}} onSwitchToOtp={()=>{}} onForgotPassword={()=>{}}/>;
          if(location.pathname==="/otp")return <OtpLoginForm onRequiresEmailVerification={()=>{}}/>;
          if(view==="profile")return <AccountProfile userEmail={initialUser?.email??""}/>;
          if(view==="navbar" || location.pathname==="/navbar")return <Navbar/>;
          if(view==="product")return <ProductDetail product={{id:"shoe",name:"Missing photo",condition:"new",brand:{label:"Sole"},images:[],variants:[{id:"shoe-v",size:{id:"size",label:"10"},stock:7,sale_price_cents:1100}]}}/>;
          return view === "cart"
            ? <CartDrawer isOpen={open} onClose={() => setOpen(false)} />
            : <CheckoutLayout><CheckoutView /></CheckoutLayout>;
        }

        createRoot(document.getElementById("root")).render(
          <SessionProvider initialUser={initialUser} initialRole={initialUser ? "customer" : null}>
            <CartProvider userId={initialUser?.id}>
              <Probe />
              <View />
            </CartProvider>
          </SessionProvider>
        );
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.NEXT_PUBLIC_SITE_URL": JSON.stringify(origin),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(origin),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '"fixture-key"',
      "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY": "undefined",
    },
    plugins: [
      {
        name: "checkout-fixture-framework-and-analytics",
        setup(builder) {
          builder.onResolve(
            { filter: /^next\/(navigation|link|image)$|^@\/lib\/measurement\/client$/ },
            ({ path }) => ({ path, namespace: "checkout-fixture" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "checkout-fixture" }, ({ path }) => ({
            loader: "jsx",
            resolveDir: root,
            contents: framework[path],
          }));
        },
      },
    ],
  }).then((result) => result.outputFiles[0].text);
  return bundle;
}

function bootstrapDocument({ initialUser, guestItems, accountItems, view, seedGuest }) {
  if (!localStorage.getItem("checkout_fixture_initialized_accounts")) {
    for (const [id, items] of Object.entries(accountItems)) {
      localStorage.setItem("rdk_cart_user_" + id, JSON.stringify(items));
    }
    localStorage.setItem("checkout_fixture_initialized_accounts", "1");
  }
  if (seedGuest && !sessionStorage.getItem("checkout_fixture_initialized_guest")) {
    sessionStorage.setItem("rdk_cart_session", JSON.stringify(guestItems));
    sessionStorage.setItem("checkout_fixture_initialized_guest", "1");
  }
  window.checkoutFixture = { initialUser, view };
  // Install the synthetic SDK before the real checkout mounts.
  window.Square = {
    payments: () => ({
      card: async () => ({
        attach: async () => {},
        destroy: async () => true,
        tokenize: async () => ({ status: "OK", token: "synthetic-fixture-token" }),
      }),
      paymentRequest: () => ({ addEventListener: () => {}, update: () => true }),
      applePay: async () => {
        throw new Error("Unavailable in the checkout fixture");
      },
      cashAppPay: async () => {
        throw new Error("Unavailable in the checkout fixture");
      },
      afterpayClearpay: async () => {
        throw new Error("Unavailable in the checkout fixture");
      },
    }),
  };
}

const bundlePath = "/__checkout-fixture/bootstrap.js";

export async function mountCheckoutBrowser({
  initialUser = null,
  guestItems = [],
  accountItems = {},
  path,
  view = "cart",
  route,
  sessionRoute,
  setupDocument,
  documentData,
  waitReady = true,
} = {}) {
  assert.ok(Object.hasOwn(viewPaths, view), "Unknown checkout fixture view");
  const target = new URL(path ?? viewPaths[view], origin);
  assert.equal(
    target.origin,
    origin,
    "Checkout fixture path must stay on the fixture origin",
  );
  const executablePath = registry
    .findExecutable("chromium-headless-shell")
    .executablePath();
  await access(executablePath).catch(() => {
    throw new Error(
      "Playwright Chromium is missing. Install Chromium for this Playwright version or set PLAYWRIGHT_BROWSERS_PATH.",
    );
  });
  const script = await browserBundle();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--host-resolver-rules=MAP * ~NOTFOUND",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
  });
  const errors = [];
  let closed;
  const close = () => {
    closed ??= browser.close().then(() => {
      if (errors.length) throw new Error(errors.map((error) => error.message).join("\n"));
    });
    return closed;
  };

  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error)));
    await context.routeWebSocket("**/*", (socket) => {
      errors.push(new Error("Unexpected WebSocket request in checkout fixture"));
      return socket.close();
    });
    const page = await context.newPage();
    await context.route("**/*", async (intercepted) => {
      const request = intercepted.request();
      const url = new URL(request.url());
      try {
        if (url.origin !== origin) {
          throw new Error("Unexpected external request to " + url.origin);
        }
        if (request.isNavigationRequest()) {
          const config = JSON.stringify({
            initialUser,
            guestItems,
            accountItems,
            view,
            seedGuest: request.frame().page() === page,
          }).replaceAll("<", "\\u003c");
          await intercepted.fulfill({
            contentType: "text/html",
            body:
              '<!doctype html><html lang="en"><meta charset="utf-8"><div id="root"></div>' +
              "<script>(" +
              bootstrapDocument.toString() +
              ")(" +
              config +
              ")</script>" +
              (setupDocument
                ? "<script>(" +
                  setupDocument.toString() +
                  ")(" +
                  JSON.stringify(documentData ?? {}).replaceAll("<", "\\u003c") +
                  ")</script>"
                : "") +
              '<script defer src="' +
              bundlePath +
              '"></script></html>',
          });
        } else if (url.pathname === bundlePath && request.resourceType() === "script") {
          await intercepted.fulfill({ contentType: "text/javascript", body: script });
        } else if (url.pathname === "/api/auth/session" && !sessionRoute) {
          await intercepted.fulfill({
            json: { user: initialUser, role: initialUser ? "customer" : null },
          });
        } else if (route || (url.pathname === "/api/auth/session" && sessionRoute)) {
          await (url.pathname === "/api/auth/session" ? sessionRoute : route)(
            Object.freeze({
              request: () => request,
              fulfill: (options) => intercepted.fulfill(options),
              abort: (code) => intercepted.abort(code),
            }),
            url,
          );
        } else {
          throw new Error("Unexpected checkout fixture request to " + url.pathname);
        }
      } catch (error) {
        errors.push(error);
        await intercepted.abort().catch(() => {});
      }
    });
    await page.goto(target.href);
    await page.waitForFunction(
      (ready) =>
        window.testCart && (!ready || window.testCart.isReady) && window.testSession,
      waitReady,
    );
    return { page, context, close };
  } catch (error) {
    await close();
    throw error;
  }
}
