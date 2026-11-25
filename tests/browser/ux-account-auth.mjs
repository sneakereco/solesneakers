import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const bundle = await compileUxHarness(
  `
  import { createRoot } from "react-dom/client";
  import { useState } from "react";
  import { AccountProfile } from "./src/components/account/AccountProfile";
  import { ContactForm } from "./src/components/contact/ContactForm";
  import { PasswordLoginForm } from "./src/components/auth/login/PasswordLoginForm";
  import { OtpLoginForm } from "./src/components/auth/login/OtpLoginForm";
  import { ForgotPasswordForm } from "./src/components/auth/login/ForgotPasswordForm";
  import { VerifyEmailForm } from "./src/components/auth/login/VerifyEmailForm";
  import { RegisterForm } from "./src/components/auth/register/RegisterForm";
  import { ChallengeForm } from "./src/components/auth/2fa/ChallengeForm";
  import { EnrollmentForm } from "./src/components/auth/2fa/EnrollmentForm";
  import { SessionProvider } from "./src/contexts/SessionContext";
  import { Navbar } from "./src/components/shell/Navbar";

  const views = {
    "/contact": <ContactForm />,
    "/login": <PasswordLoginForm onRequiresEmailVerification={() => {}} onSwitchToOtp={() => {}} onForgotPassword={() => {}} />,
    "/otp": <OtpLoginForm onRequiresEmailVerification={() => {}} />,
    "/forgot": <ForgotPasswordForm onBackToLogin={() => {}} />,
    "/verify": <VerifyEmailForm email="customer@example.test" />,
    "/register": <RegisterForm />,
    "/challenge": <ChallengeForm />,
    "/enrollment": <EnrollmentForm />,
    "/header": <Navbar />,
    "/known": <Navbar />,
    "/initial-unavailable": <Navbar />,
    "/server-update": <Navbar />,
  };
  function Fixture() {
    const initialAccount = { id: "account-a", email: "loaded-account@example.test" };
    const [account, setAccount] = useState(initialAccount);
    const [initial, setInitial] = useState({
      user: location.pathname === "/account" ? initialAccount :
        ["/known", "/server-update"].includes(location.pathname) ? { id: "fixture", email: "customer@example.test" } : null,
      unavailable: location.pathname === "/initial-unavailable",
      id: "initial",
    });
    window.updateServerSession = setInitial;
    window.updateAccount = setAccount;
    return <SessionProvider
        initialUser={initial.user}
        initialRole={initial.user ? "customer" : null}
        initialUnavailable={initial.unavailable}
        serverReadId={initial.id}
      >
        {location.pathname === "/account" ? <AccountProfile userId={account.id} userEmail={account.email} /> : views[location.pathname]}
    </SessionProvider>;
  }
  createRoot(document.getElementById("root")).render(<Fixture />);
  `,
  {
    plugins: [
      {
        name: "account-auth-next-boundaries",
        setup(builder) {
          builder.onResolve(
            { filter: /^next\/(link|image|navigation)$/ },
            ({ path }) => ({
              path,
              namespace: "next-boundary",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "next-boundary" }, ({ path }) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              path === "next/navigation"
                ? "export const usePathname = () => location.pathname; export const useRouter = () => ({push() {}, replace() {}, refresh() {}}); export const useSearchParams = () => new URLSearchParams(location.search);"
                : path === "next/link"
                  ? "export const useLinkStatus = () => ({pending: false}); export default function Link({onNavigate, ...props}) {return <a {...props}/>;}"
                  : "export default function Image({priority, unoptimized, fill, ...props}) {return <img {...props}/>;}",
          }));
        },
      },
    ],
  },
);

function holdResponse() {
  let markReceived;
  let release;
  let finish;
  const received = new Promise((resolve) => {
    markReceived = resolve;
  });
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  return {
    get received() {
      let timer;
      return Promise.race([
        received,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Fixture request not received")),
            4000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    },
    release,
    finished,
    async fulfill(route) {
      markReceived(route.request());
      await route.fulfill(await response).catch(() => {});
      finish();
    },
  };
}

const browser = await chromium.launch({ headless: true });
const failures = [];
const json = (body, status = 200) => ({ status, json: body });
const unavailable = json({ error: "Unavailable" }, 503);
const address = {
  id: "fixture-address",
  name: "Sally Test",
  line1: "123 Test Street",
  city: "Salem",
  state: "NC",
  postal_code: "27012",
  country: "US",
};

async function check(name, run, options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
    ...options,
  });
  page.setDefaultTimeout(5000);
  try {
    await page.route("**/*", (route) => route.abort());
    await run(page);
    console.log("PASS", name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL", name, error);
  } finally {
    await page.close();
  }
}

async function openAccount(page, read = {}) {
  await page.route("**/api/account/**", (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1);
    if (read[resource]) return read[resource](route);
    return route.fulfill(
      json(
        resource === "orders"
          ? { orders: [] }
          : resource === "addresses"
            ? { addresses: [] }
            : {},
      ),
    );
  });
  await openUxHarness(page, bundle, "https://ux.test/account");
}

async function fillAddress(page) {
  await page.getByLabel("Full Name").fill(address.name);
  await page.getByLabel("Address Line 1", { exact: false }).fill(address.line1);
  await page.getByLabel("City", { exact: false }).fill(address.city);
  await page.getByLabel("State", { exact: false }).fill(address.state);
  await page.getByLabel("Postal Code", { exact: false }).fill(address.postal_code);
  await page.getByLabel("Country", { exact: false }).fill(address.country);
}

async function submitTwice(form) {
  await form.evaluate((element) => {
    const submit = element.querySelector('button[type="submit"]');
    element.requestSubmit(submit);
    submit.click();
  });
}

async function sessionUpdate(page) {
  await page.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
}

try {
  await check(
    "account first load stays busy, shows static placeholders with reduced motion, and retries a failed read before confirming empty",
    async (page) => {
      const first = holdResponse();
      let attempts = 0;
      await openAccount(page, {
        addresses: (route) =>
          ++attempts === 1
            ? first.fulfill(route)
            : route.fulfill(json({ addresses: [] })),
      });
      await first.received;
      const addressRegion = page.locator("#addresses");
      const addressesLoading = addressRegion.getByText("Loading addresses", {
        exact: true,
      });
      await expect(addressesLoading).toHaveCount(1);
      await expect(
        addressRegion.locator("[aria-busy=true] [data-ui-skeleton]").first(),
      ).toHaveCSS("animation-name", "none");
      await expect(addressRegion.getByText("No saved addresses yet.")).toHaveCount(0);
      first.release(unavailable);
      await expect(addressRegion.getByRole("alert")).toContainText(/address/i);
      await expect(addressRegion.getByText("No saved addresses yet.")).toHaveCount(0);
      await addressRegion.getByRole("button", { name: "Retry" }).click();
      await expect(addressRegion.getByText("No saved addresses yet.")).toBeVisible();
      assert.equal(attempts, 2);
    },
    { reducedMotion: "reduce" },
  );

  await check(
    "address POST is admitted once, successful address stays visible after default failure, and retry only writes the default",
    async (page) => {
      const save = holdResponse();
      const defaultSave = holdResponse();
      let addressWrites = 0;
      let defaultWrites = 0;
      await openAccount(page, {
        addresses: (route) =>
          route.request().method() === "GET"
            ? route.fulfill(json({ addresses: [] }))
            : (addressWrites++, save.fulfill(route)),
        shipping: (route) => {
          if (route.request().method() === "GET") return route.fulfill(json({}));
          defaultWrites++;
          return defaultWrites === 1
            ? defaultSave.fulfill(route)
            : route.fulfill(
                json({
                  address_line1: address.line1,
                  city: address.city,
                  state: address.state,
                  postal_code: address.postal_code,
                  country: address.country,
                }),
              );
        },
      });
      await fillAddress(page);
      await page.getByLabel("Set as default shipping address").check();
      await submitTwice(page.locator("#addresses form"));
      await save.received;
      await expect(page.getByRole("button", { name: /saving/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(page.getByRole("button", { name: "Change Password" })).toBeEnabled();
      save.release(json({ address, addresses: [address] }));
      await defaultSave.received;
      defaultSave.release(unavailable);
      await expect(page.getByRole("alert")).toContainText(/address saved.*default/i);
      await expect(page.getByText(address.name)).toBeVisible();
      await page.getByRole("button", { name: /retry.*default/i }).click();
      await expect(page.getByText(/default shipping address updated/i)).toBeVisible();
      assert.equal(addressWrites, 1);
      assert.equal(defaultWrites, 2);
    },
    { hasTouch: true, isMobile: true, viewport: { width: 390, height: 820 } },
  );

  await check(
    "shipping profile and order reads use independent placeholders, then distinguish unavailable from signed out",
    async (page) => {
      const shipping = holdResponse();
      const orders = holdResponse();
      await openAccount(page, { shipping: shipping.fulfill, orders: orders.fulfill });
      await Promise.all([shipping.received, orders.received]);
      await expect(
        page.getByText("Loading shipping profile", { exact: true }),
      ).toHaveCount(1);
      await expect(page.getByText("Loading orders", { exact: true })).toHaveCount(1);
      await expect(page.getByText("No default address selected yet.")).toHaveCount(0);
      await expect(page.getByText("You have not placed an order yet.")).toHaveCount(0);
      shipping.release(unavailable);
      orders.release(json({ error: "Unauthorized" }, 401));
      await expect(page.locator("#addresses").getByRole("alert")).toContainText(
        /default shipping address/i,
      );
      await expect(
        page.locator("#orders").getByRole("link", { name: "Sign in" }),
      ).toHaveAttribute("href", "/auth/login?next=%2Faccount");
      await expect(page.getByText("No default address selected yet.")).toHaveCount(0);
      await expect(page.getByText("You have not placed an order yet.")).toHaveCount(0);
    },
  );

  await check(
    "a committed address remains visible when the list is unavailable and refresh only reads",
    async (page) => {
      let reads = 0;
      let writes = 0;
      await openAccount(page, {
        addresses: (route) => {
          if (route.request().method() === "POST") {
            writes++;
            return route.fulfill(json({ address }));
          }
          reads++;
          return route.fulfill(json({ addresses: reads === 1 ? [] : [address] }));
        },
      });
      await fillAddress(page);
      await page.getByRole("button", { name: "Add Address" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: /^Address saved/ }),
      ).toBeVisible();
      await expect(page.getByText(address.name)).toBeVisible();
      await page.getByRole("button", { name: "Refresh saved addresses" }).click();
      await expect(
        page.getByRole("button", { name: "Refresh saved addresses" }),
      ).toHaveCount(0);
      assert.equal(reads, 2);
      assert.equal(writes, 1);
    },
  );

  await check(
    "a lost address response gates resubmission until an owner-bound read confirms the saved draft",
    async (page) => {
      let reads = 0;
      let writes = 0;
      const readOwners = [];
      await openAccount(page, {
        addresses: (route) => {
          if (route.request().method() === "POST") {
            writes++;
            return route.abort("failed");
          }
          readOwners.push(route.request().headers()["x-account-owner"]);
          reads++;
          return route.fulfill(
            reads === 2 ? unavailable : json({ addresses: reads === 3 ? [address] : [] }),
          );
        },
      });
      await fillAddress(page);
      const street = page.getByLabel("Address Line 1", { exact: false });
      const submit = page.getByRole("button", { name: "Add Address" });
      await submit.click();
      await expect(page.getByRole("alert")).toContainText(
        /could not confirm.*address.*saved/i,
      );
      await expect(street).toHaveValue(address.line1);
      await expect(submit).toBeDisabled();
      const checkSaved = page.getByRole("button", { name: "Check saved addresses" });
      await checkSaved.click();
      await expect(checkSaved).toBeEnabled();
      await expect(submit).toBeDisabled();
      await expect(street).toHaveValue(address.line1);
      await checkSaved.click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: /this address is in your saved addresses/i }),
      ).toBeVisible();
      await expect(page.getByText(address.name)).toBeVisible();
      await expect(submit).toBeEnabled();
      assert.deepEqual(readOwners, ["account-a", "account-a", "account-a"]);
      assert.equal(writes, 1);
    },
  );

  await check(
    "an unconfirmed address can be submitted again explicitly after a successful empty read",
    async (page) => {
      let saves = 0;
      await openAccount(page, {
        addresses: (route) => {
          if (route.request().method() === "GET")
            return route.fulfill(json({ addresses: [] }));
          saves++;
          return route.fulfill(
            saves === 1 ? unavailable : json({ address, addresses: [address] }),
          );
        },
      });
      await fillAddress(page);
      const submit = page.getByRole("button", { name: "Add Address" });
      await submit.click();
      await expect(submit).toBeDisabled();
      await page.getByRole("button", { name: "Check saved addresses" }).click();
      await expect(page.getByRole("alert")).toContainText(/review your draft/i);
      await expect(page.getByLabel("Address Line 1", { exact: false })).toHaveValue(
        address.line1,
      );
      await expect(submit).toBeEnabled();
      assert.equal(saves, 1);
      await submit.click();
      await expect(page.getByText(address.name)).toBeVisible();
      assert.equal(saves, 2);
    },
  );

  await check(
    "ordinary upsert of a changed saved row invalidates its old default retry",
    async (page) => {
      let saves = 0;
      const defaultBodies = [];
      const revised = { ...address, name: "Updated recipient", line2: "Apartment 22" };
      await openAccount(page, {
        addresses: (route) => {
          if (route.request().method() === "GET")
            return route.fulfill(json({ addresses: [] }));
          const saved = ++saves === 1 ? address : revised;
          return route.fulfill(json({ address: saved, addresses: [saved] }));
        },
        shipping: (route) => {
          if (route.request().method() === "GET") return route.fulfill(json({}));
          defaultBodies.push(route.request().postDataJSON());
          return route.fulfill(
            defaultBodies.length === 1 ? unavailable : json(defaultBodies.at(-1)),
          );
        },
      });
      await fillAddress(page);
      await page.getByLabel("Set as default shipping address").check();
      await page.getByRole("button", { name: "Add Address" }).click();
      const retry = page.getByRole("button", { name: "Retry default update" });
      await expect(retry).toBeVisible();
      await fillAddress(page);
      await page.getByLabel("Full Name").fill(revised.name);
      await page.getByLabel("Apartment / Unit").fill(revised.line2);
      await page.getByRole("button", { name: "Add Address" }).click();
      await expect(page.getByText(revised.line2, { exact: true })).toBeVisible();
      await expect(retry).toHaveCount(0);
      await page.getByRole("button", { name: "Set as default", exact: true }).click();
      await expect(
        page.getByText("Default shipping address updated.", { exact: true }),
      ).toBeVisible();
      assert.equal(defaultBodies.length, 2);
      assert.equal(defaultBodies[1].address_line2, revised.line2);
      assert.equal(defaultBodies[1].full_name, revised.name);
    },
  );

  await check(
    "a changed account owner gates stale commands, cancels old reads, and stops the old address default step",
    async (page) => {
      const addressesA = holdResponse();
      const ordersA = holdResponse();
      const profileA = holdResponse();
      const saveA = holdResponse();
      let shippingWrites = 0;
      let account = "account-a";
      await openAccount(page, {
        addresses: (route) => {
          if (route.request().method() === "POST") return saveA.fulfill(route);
          return account === "account-a"
            ? addressesA.fulfill(route)
            : route.fulfill(json({ addresses: [] }));
        },
        orders: (route) =>
          account === "account-a"
            ? ordersA.fulfill(route)
            : route.fulfill(json({ orders: [] })),
        shipping: (route) => {
          if (route.request().method() === "POST") {
            shippingWrites++;
            return route.fulfill(json({ address_line1: address.line1 }));
          }
          return account === "account-a"
            ? profileA.fulfill(route)
            : route.fulfill(json({}));
        },
      });
      await Promise.all([addressesA.received, ordersA.received, profileA.received]);
      await fillAddress(page);
      await page.getByLabel("Set as default shipping address").check();
      await page.getByRole("button", { name: "Add Address" }).press("Enter");
      await saveA.received;
      assert.equal((await saveA.received).headers()["x-account-owner"], "account-a");
      account = "account-b";
      await page.evaluate(() =>
        window.updateServerSession({
          user: { id: "account-b", email: "updated-account@example.test" },
          id: "account-b",
          unavailable: false,
        }),
      );
      await expect(page.getByRole("alert")).toContainText(/account/i);
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add Address" })).toHaveCount(0);
      await page.evaluate(() =>
        window.updateAccount({ id: "account-b", email: "updated-account@example.test" }),
      );
      await expect(page.getByText("updated-account@example.test")).toBeVisible();
      await expect(page.getByText("No saved addresses yet.")).toBeVisible();
      addressesA.release(json({ addresses: [address] }));
      ordersA.release(
        json({ orders: [{ id: "leaked-order", created_at: "2026-11-25T00:00:00Z" }] }),
      );
      profileA.release(json({ address_line1: "Private account A address" }));
      saveA.release(json({ address, addresses: [address] }));
      await Promise.all([
        addressesA.finished,
        ordersA.finished,
        profileA.finished,
        saveA.finished,
      ]);
      await expect(page.getByText(address.name)).toHaveCount(0);
      await expect(page.getByText(/leaked-order|Private account A address/)).toHaveCount(
        0,
      );
      assert.equal(shippingWrites, 0);
    },
  );

  await check(
    "account owner conflict response gates the current account view without auto-replaying a read",
    async (page) => {
      let attempts = 0;
      await openAccount(page, {
        shipping: (route) => {
          attempts++;
          assert.equal(route.request().headers()["x-account-owner"], "account-a");
          return route.fulfill(json({ error: "Account changed" }, 409));
        },
      });
      await expect(page.getByRole("alert")).toContainText(
        "Your account session changed.",
      );
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Add Address" })).toHaveCount(0);
      assert.equal(attempts, 1);
    },
  );

  await check(
    "removing a default address reports a failed clear and retries only clearing it",
    async (page) => {
      const remove = holdResponse();
      let deletes = 0;
      let defaults = 0;
      const profile = {
        address_line1: address.line1,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
        country: address.country,
      };
      await openAccount(page, {
        addresses: (route) => route.fulfill(json({ addresses: [address] })),
        [address.id]: (route) => {
          assert.equal(route.request().method(), "DELETE");
          assert.equal(route.request().headers()["x-account-owner"], "account-a");
          deletes++;
          return remove.fulfill(route);
        },
        shipping: (route) => {
          if (route.request().method() === "GET") return route.fulfill(json(profile));
          defaults++;
          return route.fulfill(
            defaults === 1 ? unavailable : json({ address_line1: null }),
          );
        },
      });
      await page.getByRole("button", { name: "Remove", exact: true }).press("Enter");
      await remove.received;
      await expect(page.getByRole("button", { name: /removing/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      remove.release(json({ ok: true }));
      await expect(page.getByRole("alert")).toContainText(/address removed.*clear/i);
      await expect(page.getByText("No saved addresses yet.")).toBeVisible();
      await page.getByRole("button", { name: /retry.*default/i }).click();
      await expect(
        page.getByText("Default shipping address cleared.", { exact: true }),
      ).toBeVisible();
      assert.equal(deletes, 1);
      assert.equal(defaults, 2);
    },
  );

  await check(
    "address and password fields are named, failed address writes retain the draft, and visibility controls have a touch-sized target",
    async (page) => {
      await openAccount(page, {
        addresses: (route) =>
          route.fulfill(
            route.request().method() === "GET" ? json({ addresses: [] }) : unavailable,
          ),
      });
      await fillAddress(page);
      await page.getByRole("button", { name: "Add Address" }).click();
      await expect(page.getByRole("alert")).toContainText(/confirm.*address.*saved/i);
      await expect(page.getByLabel("Address Line 1", { exact: false })).toHaveValue(
        address.line1,
      );
      await page.getByLabel("New Password", { exact: true }).fill("Example1!Secure");
      await page.getByLabel("Confirm Password", { exact: true }).fill("Example1!Secure");
      const toggle = page.getByRole("button", { name: "Show password" }).first();
      const box = await toggle.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44);
      await toggle.click();
      await expect(page.getByLabel("New Password", { exact: true })).toHaveAttribute(
        "type",
        "text",
      );
    },
  );

  await check(
    "contact pending survives duplicate keyboard and touch admission and preserves input after error",
    async (page) => {
      const send = holdResponse();
      let sends = 0;
      await page.route("**/api/contact", (route) => {
        sends++;
        return send.fulfill(route);
      });
      await openUxHarness(page, bundle, "https://ux.test/contact");
      await page.getByLabel("Name").fill(address.name);
      await page.getByLabel("Email").fill("customer@example.test");
      await page.getByLabel("Message").fill("Synthetic contact draft");
      await page.getByRole("button", { name: "Send Message" }).tap();
      await page.keyboard.press("Enter");
      await send.received;
      await expect(page.getByRole("button", { name: /sending/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      send.release(unavailable);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByLabel("Message")).toHaveValue("Synthetic contact draft");
      assert.equal(sends, 1);
    },
    { hasTouch: true, isMobile: true, viewport: { width: 390, height: 820 } },
  );

  await check(
    "account password and sign out report independent failures without discarding the password draft",
    async (page) => {
      const passwordWrite = holdResponse();
      const logout = holdResponse();
      await page.route("**/api/auth/logout", logout.fulfill);
      await openAccount(page, { password: passwordWrite.fulfill });
      const password = page.getByLabel("New Password", { exact: true });
      await password.fill("Example1!Secure");
      await page.getByLabel("Confirm Password", { exact: true }).fill("Example1!Secure");
      await page.getByRole("button", { name: "Change Password" }).press("Enter");
      await passwordWrite.received;
      await expect(
        page.getByRole("button", { name: /changing password/i }),
      ).toHaveAttribute("aria-busy", "true");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await logout.received;
      passwordWrite.release(unavailable);
      logout.release(unavailable);
      await expect(page.locator("#security").getByRole("alert")).toContainText(
        /change your password/i,
      );
      await expect(
        page.getByRole("alert").filter({ hasText: /sign out/i }),
      ).toBeVisible();
      await expect(password).toHaveValue("Example1!Secure");
      await expect(page.getByRole("heading", { name: "My Account" })).toBeVisible();
    },
  );

  await check(
    "password login fields retain accessible names and values after a held synthetic failure",
    async (page) => {
      const login = holdResponse();
      let requests = 0;
      await page.route("**/api/auth/login", (route) => {
        requests++;
        return login.fulfill(route);
      });
      await openUxHarness(page, bundle, "https://ux.test/login");
      await page.getByLabel("Email", { exact: true }).fill("customer@example.test");
      const password = page.getByLabel("Password", { exact: true });
      await password.fill("Synthetic1!");
      await submitTwice(page.locator("form"));
      await login.received;
      await expect(page.getByRole("button", { name: /logging in/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      login.release(json({ ok: false, error: "Incorrect password" }, 401));
      await expect(page.getByRole("alert")).toContainText("Incorrect password");
      await expect(password).toHaveValue("Synthetic1!");
      assert.equal(requests, 1);
    },
  );

  await check(
    "email code is synthetic, focuses the code input, and exposes held verification and a rejected code",
    async (page) => {
      const verify = holdResponse();
      await page.route("**/api/auth/otp/request", (route) =>
        route.fulfill(json({ ok: true })),
      );
      await page.route("**/api/auth/otp/verify", (route) => verify.fulfill(route));
      await openUxHarness(page, bundle, "https://ux.test/otp");
      await page.getByLabel("Email", { exact: true }).fill("customer@example.test");
      await page.getByRole("button", { name: "Send code" }).click();
      const code = page.getByLabel("Verification code");
      await expect(code).toBeFocused();
      await code.fill("123456");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await verify.received;
      await expect(page.getByRole("button", { name: /signing in/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      verify.release(json({ ok: false, error: "Invalid code" }, 400));
      await expect(page.getByRole("alert")).toContainText("Invalid code");
      await expect(code).toHaveValue("123456");
    },
  );

  await check(
    "registration has named credentials, guards submission, and keeps fields after synthetic failure",
    async (page) => {
      const registration = holdResponse();
      let writes = 0;
      await page.route("**/api/auth/register", (route) => {
        writes++;
        return registration.fulfill(route);
      });
      await openUxHarness(page, bundle, "https://ux.test/register");
      await page.getByLabel("Email", { exact: true }).fill("customer@example.test");
      await page.getByLabel("Password", { exact: true }).fill("Example1!Secure");
      await page.getByLabel("Confirm password", { exact: true }).fill("Example1!Secure");
      await submitTwice(page.locator("form"));
      await registration.received;
      await expect(
        page.getByRole("button", { name: /creating account/i }),
      ).toHaveAttribute("aria-busy", "true");
      registration.release(unavailable);
      await expect(page.getByRole("alert")).toContainText(/create your account/i);
      await expect(page.getByLabel("Confirm password", { exact: true })).toHaveValue(
        "Example1!Secure",
      );
      assert.equal(writes, 1);
    },
  );

  await check(
    "verification resend survives rate limiting and reports confirmed delivery as a separate result",
    async (page) => {
      await page.clock.install();
      const resend = holdResponse();
      let writes = 0;
      await page.route("**/api/auth/resend-verification", (route) => {
        writes++;
        return writes === 1 ? resend.fulfill(route) : route.fulfill(json({ ok: true }));
      });
      await openUxHarness(page, bundle, "https://ux.test/verify");
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
        "customer@example.test",
      );
      await expect(page.getByRole("button", { name: /resend \(/i })).toBeDisabled();
      await page.clock.fastForward(61_000);
      await page.getByRole("button", { name: "Resend code", exact: true }).press("Enter");
      await resend.received;
      await expect(page.getByRole("button", { name: /resending code/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      resend.release(json({ error: "Try again in a moment" }, 429));
      await expect(page.getByRole("alert")).toContainText("Try again in a moment");
      await page.getByRole("button", { name: "Resend code", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Code sent.");
      assert.equal(writes, 2);
    },
  );

  await check(
    "password reset retries only the password update after accepting the synthetic recovery code",
    async (page) => {
      const update = holdResponse();
      const ownerId = "3fd71135-d895-4d08-a964-56bdebedd2dc";
      const updateOwners = [];
      let verifies = 0;
      let writes = 0;
      await page.route("**/api/auth/forgot-password", (route) =>
        route.fulfill(json({ ok: true })),
      );
      await page.route("**/api/auth/forgot-password/verify-code", (route) => {
        verifies++;
        return route.fulfill(json({ ok: true, recoveryOwnerId: ownerId }));
      });
      await page.route("**/api/auth/update-password", (route) => {
        writes++;
        updateOwners.push(route.request().postDataJSON().recoveryOwnerId);
        return writes === 1 ? update.fulfill(route) : route.fulfill(json({ ok: true }));
      });
      await page.route("**/api/auth/session", (route) =>
        route.fulfill(json({ user: null, role: null })),
      );
      await openUxHarness(page, bundle, "https://ux.test/forgot");
      await page.getByLabel("Email", { exact: true }).fill("customer@example.test");
      await page.getByRole("button", { name: "Send reset code" }).press("Enter");
      const code = page.getByLabel("Reset code", { exact: true });
      await expect(code).toBeFocused();
      await code.fill("123456");
      await page.getByLabel("New password", { exact: true }).fill("Example1!Secure");
      await page.getByLabel("Confirm password", { exact: true }).fill("Example1!Secure");
      await submitTwice(page.locator("form"));
      await update.received;
      await expect(
        page.getByRole("button", { name: /updating password/i }),
      ).toHaveAttribute("aria-busy", "true");
      update.release(unavailable);
      await expect(page.getByRole("alert")).toContainText(/update your password/i);
      await expect(page.getByLabel("New password", { exact: true })).toHaveValue(
        "Example1!Secure",
      );
      await page.getByRole("button", { name: "Update password", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Your password has been updated.",
      );
      await expect(page.getByRole("link", { name: "Continue to sign in" })).toBeVisible();
      assert.equal(verifies, 1);
      assert.equal(writes, 2);
      assert.deepEqual(updateOwners, [ownerId, ownerId]);
    },
  );

  await check(
    "a recovery owner conflict discards the accepted code before another password write",
    async (page) => {
      const owners = [];
      let verifications = 0;
      const ownerId = "3fd71135-d895-4d08-a964-56bdebedd2dc";
      await page.route("**/api/auth/forgot-password", (route) =>
        route.fulfill(json({ ok: true })),
      );
      await page.route("**/api/auth/forgot-password/verify-code", (route) => {
        verifications++;
        return route.fulfill(json({ ok: true, recoveryOwnerId: ownerId }));
      });
      await page.route("**/api/auth/update-password", (route) => {
        owners.push(route.request().postDataJSON().recoveryOwnerId);
        return route.fulfill(
          json(
            { error: "Your recovery session changed. Request a new reset code." },
            409,
          ),
        );
      });
      await openUxHarness(page, bundle, "https://ux.test/forgot");
      await page.getByLabel("Email", { exact: true }).fill("customer@example.test");
      await page.getByRole("button", { name: "Send reset code" }).press("Enter");
      const code = page.getByLabel("Reset code", { exact: true });
      await code.fill("123456");
      await page.getByLabel("New password", { exact: true }).fill("Example1!Secure");
      await page.getByLabel("Confirm password", { exact: true }).fill("Example1!Secure");
      const update = page.getByRole("button", { name: "Update password", exact: true });
      await update.click();
      await expect(page.getByRole("alert")).toContainText(/new reset code/i);
      await expect(code).toHaveValue("");
      await update.click();
      await expect(page.getByRole("alert")).toContainText(/6-digit reset code/i);
      assert.equal(verifications, 1);
      assert.deepEqual(owners, [ownerId]);
    },
  );

  await check(
    "TOTP verification handles an unavailable challenge and preserves the named code",
    async (page) => {
      const verify = holdResponse();
      let writes = 0;
      await page.route("**/api/auth/2fa/challenge/verify", (route) => {
        writes++;
        return verify.fulfill(route);
      });
      await openUxHarness(page, bundle, "https://ux.test/challenge");
      const code = page.getByLabel("Authentication code");
      await expect(code).toBeFocused();
      await code.fill("123456");
      await submitTwice(page.locator("form"));
      await verify.received;
      await expect(page.getByRole("button", { name: /verifying/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      verify.release(unavailable);
      await expect(page.getByRole("alert")).toContainText(
        /verify the authentication code/i,
      );
      await expect(code).toHaveValue("123456");
      assert.equal(writes, 1);
    },
  );

  await check(
    "TOTP setup guards generation and reports keyboard clipboard results before verification",
    async (page) => {
      const enrollment = holdResponse();
      let generated = 0;
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText(key) {
              window.copiedKeys = [...(window.copiedKeys ?? []), key];
              return new Promise((resolve) => {
                window.finishCopy = resolve;
              });
            },
          },
        });
      });
      await page.route("**/api/auth/2fa/enroll*", (route) => {
        generated++;
        return enrollment.fulfill(route);
      });
      await openUxHarness(page, bundle, "https://ux.test/enrollment");
      await page.getByRole("button", { name: "Generate QR code" }).evaluate((button) => {
        button.click();
        button.click();
      });
      await enrollment.received;
      await expect(
        page.getByRole("button", { name: /generating qr code/i }),
      ).toHaveAttribute("aria-busy", "true");
      enrollment.release(
        json({
          factorId: "synthetic-factor",
          qrCode:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E",
          uri: "otpauth://totp/fixture?secret=ABCD2345",
        }),
      );
      await expect(page.getByLabel("Verification code")).toBeFocused();
      await page.getByRole("button", { name: "Copy setup key" }).press("Enter");
      await expect(page.getByRole("button", { name: /copying key/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await page.evaluate(() => window.finishCopy());
      await expect(
        page.getByRole("status").filter({ hasText: "Setup key copied." }),
      ).toBeVisible();
      assert.deepEqual(await page.evaluate(() => window.copiedKeys), ["ABCD2345"]);
      assert.equal(generated, 1);
    },
  );

  await check(
    "session 503 preserves known identity, and the actual header offers a retry",
    async (page) => {
      let requests = 0;
      await page.route("**/api/auth/session", (route) =>
        route.fulfill(
          ++requests === 1
            ? unavailable
            : json({
                user: { id: "fixture", email: "next@example.test" },
                role: "customer",
              }),
        ),
      );
      await openUxHarness(page, bundle, "https://ux.test/known");
      await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
      await sessionUpdate(page);
      await expect(page.getByRole("alert")).toContainText(/account/i);
      await expect(page.getByText("customer@example.test")).toBeVisible();
      await expect(page.getByRole("link", { name: "Login" })).toHaveCount(0);
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByText("next@example.test")).toBeVisible();
      assert.equal(requests, 2);
    },
  );

  await check(
    "unresolved header provides retry and a superseded session response cannot replace newer identity",
    async (page) => {
      const earlier = holdResponse();
      let requests = 0;
      await page.route("**/api/auth/session", (route) => {
        requests++;
        if (requests === 1) return route.fulfill(unavailable);
        if (requests === 2) return earlier.fulfill(route);
        return route.fulfill(
          json({ user: { id: "newer", email: "newer@example.test" }, role: "customer" }),
        );
      });
      await openUxHarness(page, bundle, "https://ux.test/header");
      await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
      await sessionUpdate(page);
      await expect(page.getByRole("alert")).toContainText(/account/i);
      await expect(page.getByRole("link", { name: "Login" })).toHaveCount(0);
      await page.getByRole("button", { name: "Retry" }).click();
      await earlier.received;
      await sessionUpdate(page);
      await expect(page.getByText("newer@example.test")).toBeVisible();
      earlier.release(json({ user: null, role: null }));
      await expect(page.getByText("newer@example.test")).toBeVisible();
      assert.equal(requests, 3);
    },
  );

  await check(
    "mobile header offers recovery for an unavailable initial identity and clears it only after confirmed sign-out",
    async (page) => {
      const recovery = holdResponse();
      let requests = 0;
      await page.route("**/api/auth/session", (route) => {
        requests++;
        return requests === 1 ? route.abort("failed") : recovery.fulfill(route);
      });
      await openUxHarness(page, bundle, "https://ux.test/initial-unavailable");
      await expect(page.getByRole("alert")).toContainText(/load your account/i);
      await page.getByRole("button", { name: "Retry" }).tap();
      await expect.poll(() => requests).toBe(1);
      await page.getByRole("button", { name: "Retry" }).tap();
      await recovery.received;
      await expect(page.getByRole("button", { name: /retrying/i })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await page.setViewportSize({ width: 1200, height: 900 });
      await expect(page.getByRole("link", { name: "Login" })).toHaveCount(0);
      recovery.release(json({ user: null, role: null }));
      await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
    },
    { hasTouch: true, isMobile: true, viewport: { width: 390, height: 820 } },
  );

  await check(
    "new server session props update a mounted header and invalidate an older client refresh",
    async (page) => {
      const earlier = holdResponse();
      await page.route("**/api/auth/session", earlier.fulfill);
      await openUxHarness(page, bundle, "https://ux.test/server-update");
      await expect(page.getByText("customer@example.test")).toBeVisible();
      await sessionUpdate(page);
      await earlier.received;
      await page.evaluate(() =>
        window.updateServerSession({
          user: { id: "server", email: "server@example.test" },
          unavailable: false,
          id: "newer-server-result",
        }),
      );
      await expect(page.getByText("server@example.test")).toBeVisible();
      earlier.release(
        json({ user: { id: "older", email: "older@example.test" }, role: "customer" }),
      );
      await earlier.finished;
      await expect(page.getByText("server@example.test")).toBeVisible();
      await page.evaluate(() =>
        window.updateServerSession({
          user: null,
          unavailable: true,
          id: "server-unavailable",
        }),
      );
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByText("server@example.test")).toBeVisible();
      await page.evaluate(() =>
        window.updateServerSession({
          user: null,
          unavailable: false,
          id: "server-guest",
        }),
      );
      await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
    },
  );

  await check(
    "a hung session refresh reaches its deadline and leaves known identity recoverable",
    async (page) => {
      await page.clock.install();
      const pending = holdResponse();
      await page.route("**/api/auth/session", pending.fulfill);
      await openUxHarness(page, bundle, "https://ux.test/known");
      await expect(page.getByText("customer@example.test")).toBeVisible();
      await sessionUpdate(page);
      await pending.received;
      await page.clock.fastForward(15_001);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByText("customer@example.test")).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
      pending.release(json({ user: null, role: null }));
      await pending.finished;
      await expect(page.getByText("customer@example.test")).toBeVisible();
    },
  );
} finally {
  await browser.close();
}

assert.deepEqual(failures, []);
