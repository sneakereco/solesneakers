// Real claim components in Chromium. Provider/HTTP responses are fixtures, not hosted capacity evidence.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { mkdir, readFile } from "node:fs/promises";

const productId = "11111111-1111-4111-8111-111111111111";
const address = {
  line1: "123 MAIN ST",
  line2: "APT 4",
  city: "COLUMBIA",
  state: "SC",
  postalCode: "29201",
  country: "US",
};
const receipt = {
  claimId: "33333333-3333-4333-8333-333333333333",
  productId,
  productName: "Cash prize",
  instagramHandle: "sole",
  instructions: "Keep this confirmation. <b>Plain text only</b>",
  acceptedAt: "2026-11-25T18:00:00Z",
  decisionOrdinal: 1,
};
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import { createRoot } from "react-dom/client";
    import { ClaimButton } from "./src/Modules/SpecialtyProducts/Source/Features/Claim/ClaimButton";
    import { ClaimedPrizeNotice } from "./src/Modules/SpecialtyProducts/Source/Features/Discovery/ClaimedPrizeNotice";
    import { Navbar } from "./src/components/shell/Navbar";
    import { Footer } from "./src/components/shell/Footer";
    const product = { id: "${productId}", name: "Cash prize", description: null, imageUrl: null, claimable: true };
    createRoot(document.getElementById("root")).render(<><Navbar /><h1>Giveaway fixture</h1>{(!location.search || location.search.includes("claimed-copy")) && <ClaimButton product={product} />}{location.search.includes("claimed-copy") && <ClaimedPrizeNotice productId={product.id} />}<Footer /></>);
  `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "framework-and-session-fixtures",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(next\/(navigation|image|link)|@\/contexts\/SessionContext|\.\/StoreMenuDrawer)$/,
          },
          (args) => ({ path: args.path, namespace: "header-fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "header-fixture" }, (args) => ({
          loader: "tsx",
          resolveDir: process.cwd(),
          contents:
            args.path === "next/navigation"
              ? "export function usePathname() { return location.pathname; }"
              : args.path === "next/image"
                ? "export default function Image({priority,unoptimized,...props}) { return <img {...props} />; }"
                : args.path === "next/link"
                  ? "export default function Link(props) { return <a {...props} />; }"
                  : args.path === "./StoreMenuDrawer"
                    ? "export function StoreMenuDrawer() { return null; }"
                    : 'export function useSession() { const signedIn = location.search.includes("signed-in"); return {user: signedIn ? {email: "fixture-long-customer-address-123456789@example.invalid"} : null, role: signedIn ? "customer" : null, isAuthenticated: signedIn, isLoading: false}; }',
        }));
      },
    },
  ],
});
assert.equal(
  Object.keys(bundle.metafile.inputs).some((name) =>
    /claim-dependencies|normalize-identity|service-role/.test(name),
  ),
  false,
  "no server dependencies in the browser bundle",
);
const css = (
  await postcss([
    tailwindcss({
      content: [
        "./src/Modules/SpecialtyProducts/Source/Features/Claim/*.tsx",
        "./src/components/ui/ModalPortal.tsx",
        "./src/components/shell/Navbar.tsx",
        "./src/components/shell/Footer.tsx",
      ],
    }),
  ]).process("@tailwind base; @tailwind components; @tailwind utilities;", {
    from: undefined,
  })
).css;
const browser = await chromium.launch({ headless: true });
const logo = await readFile("public/images/logo.png");
let mode = "correction";
const requests = [];
let storedDecision = null;
const historyDecisions = new Map();
async function newPage(blockStorage = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 640 } });
  if (blockStorage === true)
    await context.addInitScript(() =>
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new Error("blocked storage");
        },
      }),
    );
  if (blockStorage === "quota")
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "sole:specialty:attempts:v1")
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        original.call(this, key, value);
      };
    });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://specialty-ui.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/images/logo.png")
      return route.fulfill({ contentType: "image/png", body: logo });
    if (url.pathname === "/bundle.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles[0].text,
      });
    if (!url.pathname.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
      });
    const body = route.request().postDataJSON();
    requests.push({ path: url.pathname, body });
    if (url.pathname.endsWith("/eligibility")) {
      if (body.instagramHandle === "@@bad")
        return route.fulfill({
          status: 422,
          json: {
            status: "invalid",
            fields: { instagramHandle: "Enter a valid Instagram handle." },
          },
        });
      const corrected = { ...address, line1: "125 MAIN ST" };
      const response =
        mode === "correction" && !body.correctionToken
          ? {
              status: "correction_required",
              address: corrected,
              correctionToken: "confirm-address",
            }
          : {
              status: "valid",
              address: body.address,
              validationToken: "fixture-validation-token",
              expiresAt: Date.now() + 600000,
            };
      return route.fulfill({ json: response });
    }
    if (url.pathname.endsWith("/result")) {
      const decision = historyDecisions.get(body.attemptId) ?? storedDecision;
      return route.fulfill({
        status: decision ? 200 : 202,
        headers: { "Retry-After": "1" },
        json: decision
          ? { result: decision, replayed: true }
          : { status: "pending", retryAfterSeconds: 1 },
      });
    }
    if (mode === "uncertain")
      return route.fulfill({ status: 503, json: { status: "unavailable" } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    storedDecision =
      mode === "sold_out"
        ? { status: "sold_out" }
        : mode === "already_claimed"
          ? { status: "already_claimed" }
          : mode === "closed"
            ? { status: "closed" }
            : { status: "won", receipt };
    return route.fulfill({ json: { result: storedDecision, replayed: false } });
  });
  await page.goto("https://specialty-ui.test/");
  return { page, context, errors };
}
async function fill(page) {
  await page.getByLabel("Instagram handle", { exact: true }).fill("@Sole");
  await page.getByLabel("Street address", { exact: true }).fill(address.line1);
  await page
    .getByLabel("Apartment / unit (optional)", { exact: true })
    .fill(address.line2);
  await page.getByLabel("City", { exact: true }).fill(address.city);
  await page.getByLabel("State", { exact: true }).fill(address.state);
  await page.getByLabel("ZIP code", { exact: true }).fill(address.postalCode);
}
try {
  const exhaustedCopy = await newPage();
  await exhaustedCopy.page.goto("https://specialty-ui.test/?claimed-copy=1");
  await expect(
    exhaustedCopy.page.getByRole("button", { name: "Claim", exact: true }),
  ).toBeEnabled();
  await expect(exhaustedCopy.page.getByText(/by another customer/)).toHaveCount(0);
  await expect(
    exhaustedCopy.page.getByText("This product has already been claimed.", {
      exact: true,
    }),
  ).toBeVisible();
  await exhaustedCopy.context.close();
  const { page, context, errors } = await newPage();
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Opening this form does not reserve/)).toBeVisible();
  await page.getByLabel("Instagram handle", { exact: true }).fill("@typing-only");
  assert.equal(requests.length, 0, "opening and typing create no hold or award");
  await page.getByRole("button", { name: "Submit claim", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close claim form" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Submit claim", exact: true }),
  ).toBeFocused();
  assert.equal(
    await dialog.evaluate((node) => getComputedStyle(node).overscrollBehavior),
    "contain",
  );
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  assert.equal(
    await dialog.evaluate((node) => node.getBoundingClientRect().width <= innerWidth),
    true,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Claim", exact: true })).toBeFocused();
  assert.equal(requests.length, 0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await fill(page);
  await page.getByLabel("Instagram handle", { exact: true }).fill("@@bad");
  await page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(
    page.getByText("Enter a valid Instagram handle.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Instagram handle", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Instagram handle", { exact: true }).fill("@Sole");
  await page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(page.getByText("Confirm the recommended address")).toBeVisible();
  assert.equal(
    requests.filter((item) => item.path === "/api/specialty/claims").length,
    0,
  );
  await page.getByLabel("Instagram handle", { exact: true }).fill("@sole");
  await expect(
    page.getByRole("button", { name: "Submit claim", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm address and claim" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm address and claim" })
    .evaluate((button) => {
      button.click();
      button.click();
    });
  await expect(page.getByText(receipt.instructions, { exact: true })).toBeVisible();
  assert.deepEqual(
    {
      heading: await dialog.getByRole("heading", { level: 2 }).innerText(),
      entryInstructions: await dialog
        .getByText(/Opening this form does not reserve/)
        .count(),
    },
    { heading: "Congrats!", entryInstructions: 0 },
    "confirmed winners receive an unambiguous result without entry instructions",
  );
  assert.equal(
    requests.filter((item) => item.path === "/api/specialty/claims").length,
    1,
    "double click submits once",
  );
  await expect(page.getByText(receipt.instructions, { exact: true })).toBeVisible();
  assert.equal(await dialog.locator("b").count(), 0, "instructions remain plain text");
  const saved = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("sole:specialty:attempts:v1")),
  );
  assert.deepEqual(Object.keys(saved[0]).sort(), [
    "attemptId",
    "productId",
    "recoverySecret",
  ]);
  const beforeReopen = requests.length;
  await page.goto("https://specialty-ui.test/?sold=1");
  await page.getByRole("button", { name: "Check giveaway status", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  assert.deepEqual(
    requests.slice(beforeReopen).map((item) => item.path),
    ["/api/specialty/claims/result"],
    "reopen recovers without validation or a new award",
  );
  await mkdir(".superpowers/sdd/2026-11-25-specialty-giveaway-claims/browser", {
    recursive: true,
  });
  await page.screenshot({
    path: ".superpowers/sdd/2026-11-25-specialty-giveaway-claims/browser/claim-won-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Check giveaway status", exact: true }),
  ).toBeFocused();
  const latestAttempt = {
    productId: "22222222-2222-4222-8222-222222222222",
    attemptId: "44444444-4444-4444-8444-444444444444",
    recoverySecret: "a".repeat(64),
  };
  historyDecisions.set(saved[0].attemptId, { status: "won", receipt });
  historyDecisions.set(latestAttempt.attemptId, { status: "sold_out" });
  const beforeHistory = requests.length;
  await page.evaluate((latest) => {
    const key = "sole:specialty:attempts:v1";
    sessionStorage.setItem(
      key,
      JSON.stringify([...JSON.parse(sessionStorage.getItem(key)), latest]),
    );
    window.dispatchEvent(new Event("specialty-attempt-updated"));
  }, latestAttempt);
  await expect(
    page.getByRole("button", { name: "Check giveaway status", exact: true }),
  ).toBeVisible();
  assert.equal(
    requests.length,
    beforeHistory,
    "saving history does not fetch every result",
  );
  await page.getByRole("button", { name: "Check giveaway status", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Already claimed", exact: true }),
  ).toBeVisible();
  const history = page.getByLabel("Choose a giveaway claim", { exact: true });
  await expect(history).toHaveValue(latestAttempt.productId);
  await expect(history).toBeFocused();
  await history.selectOption(productId);
  await expect(
    page.getByRole("heading", { name: "Congrats!", exact: true }),
  ).toBeVisible();
  const historyRequests = requests.slice(beforeHistory);
  assert.deepEqual(
    historyRequests.map((item) => item.path),
    ["/api/specialty/claims/result", "/api/specialty/claims/result"],
    "history only recovers selected attempts",
  );
  assert.deepEqual(
    historyRequests.map((item, index) => {
      const expected = index === 0 ? latestAttempt : saved[0];
      return (
        item.body.attemptId === expected.attemptId &&
        item.body.recoverySecret === expected.recoverySecret
      );
    }),
    [true, true],
    "each selection retains its own recovery credentials",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check giveaway status", exact: true }),
  ).toBeFocused();
  for (const query of ["?sold=1", "?signed-in=1"]) {
    await page.goto("https://specialty-ui.test/" + query);
    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const nav = page.getByRole("navigation");
      const status = nav.getByRole("button", {
        name: "Check giveaway status",
        exact: true,
      });
      const cart = nav.getByRole("button", { name: /^Cart \(/ });
      await expect(status).toBeVisible();
      await expect(cart).toBeVisible();
      const statusBox = await status.boundingBox(),
        cartBox = await cart.boundingBox();
      assert.ok(
        statusBox.x >= cartBox.x + cartBox.width,
        "status sits to the right of Cart",
      );
      assert.ok(
        Math.abs(statusBox.y + statusBox.height / 2 - cartBox.y - cartBox.height / 2) < 2,
        "Cart and status share a row",
      );
      const logoBox = await nav
        .getByRole("link", { name: "Home", exact: true })
        .boundingBox();
      const account = nav.getByRole("button", { name: "Account", exact: true });
      for (const action of [
        status,
        cart,
        nav.getByRole("button", { name: "Search", exact: true }),
        ...((await account.isVisible()) ? [account] : []),
      ]) {
        const box = await action.boundingBox();
        assert.ok(
          box.x + box.width <= logoBox.x ||
            box.x >= logoBox.x + logoBox.width ||
            box.y >= logoBox.y + logoBox.height ||
            box.y + box.height <= logoBox.y,
          "header actions clear logo at " + width + query,
        );
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await expect(
        page.locator("footer").getByRole("button", { name: /giveaway/i }),
      ).toHaveCount(0);
    }
    await page.screenshot({
      path:
        ".superpowers/sdd/specialty-claim-result-clarity/browser/status-header-" +
        (query.includes("signed-in") ? "desktop-signed-in" : "desktop-guest") +
        ".png",
    });
  }
  await page.evaluate(() => {
    window.cartOpened = false;
    window.addEventListener(
      "openCart",
      () => {
        window.cartOpened = true;
      },
      { once: true },
    );
  });
  await page.getByRole("button", { name: /^Cart \(/ }).click();
  assert.equal(
    await page.evaluate(() => window.cartOpened),
    true,
    "Cart keeps its existing event",
  );
  historyDecisions.clear();
  assert.deepEqual(errors, []);
  await context.close();
  for (const [nextMode, text] of [
    ["sold_out", "Unfortunately, someone else claimed this item before you."],
    ["already_claimed", "You have already claimed a specialty product in this giveaway."],
  ]) {
    mode = nextMode;
    storedDecision = null;
    const current = await newPage();
    await current.page.getByRole("button", { name: "Claim", exact: true }).click();
    await fill(current.page);
    await current.page.getByRole("button", { name: "Submit claim", exact: true }).click();
    await expect(current.page.getByText(text, { exact: true })).toBeVisible();
    await expect(
      current.page.getByText(/Opening this form does not reserve/),
    ).toHaveCount(0);
    assert.deepEqual(current.errors, []);
    await current.context.close();
  }
  mode = "closed";
  storedDecision = null;
  const paused = await newPage();
  await paused.page.getByRole("button", { name: "Claim", exact: true }).click();
  await fill(paused.page);
  await paused.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(
    paused.page.getByText("This giveaway is currently closed.", { exact: true }),
  ).toBeVisible();
  await expect(paused.page.getByText(/Opening this form does not reserve/)).toHaveCount(
    0,
  );
  const closedAttempt = requests
    .filter((item) => item.path === "/api/specialty/claims")
    .at(-1).body;
  mode = "won";
  storedDecision = null;
  await expect(
    paused.page.getByRole("button", { name: "Try claiming again", exact: true }),
  ).toBeVisible();
  await paused.page
    .getByRole("button", { name: "Try claiming again", exact: true })
    .click();
  await expect(paused.page.getByLabel("Instagram handle", { exact: true })).toBeFocused();
  await paused.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(paused.page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  const reopenedAttempt = requests
    .filter((item) => item.path === "/api/specialty/claims")
    .at(-1).body;
  assert.equal(
    reopenedAttempt.attemptId !== closedAttempt.attemptId &&
      reopenedAttempt.recoverySecret !== closedAttempt.recoverySecret,
    true,
  );
  await expect(
    paused.page.getByRole("button", { name: "Try claiming again", exact: true }),
  ).toHaveCount(0);
  await paused.context.close();
  mode = "uncertain";
  storedDecision = null;
  const current = await newPage();
  await current.page.clock.install();
  await current.page.getByRole("button", { name: "Claim", exact: true }).click();
  await fill(current.page);
  await current.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(
    current.page.getByText("Checking your claim. Please keep this confirmation open…"),
  ).toBeVisible();
  await current.page.clock.fastForward(31000);
  await expect(
    current.page.getByRole("button", { name: "Check result again", exact: true }),
  ).toBeVisible();
  await expect(current.page.getByText(/someone else claimed/)).toHaveCount(0);
  await expect(
    current.page.getByRole("button", { name: "Try claiming again", exact: true }),
  ).toHaveCount(0);
  const submitCount = requests.filter(
    (item) => item.path === "/api/specialty/claims",
  ).length;
  storedDecision = { status: "won", receipt };
  await current.page
    .getByRole("button", { name: "Check result again", exact: true })
    .click();
  await expect(current.page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  assert.equal(
    requests.filter((item) => item.path === "/api/specialty/claims").length,
    submitCount,
  );
  assert.deepEqual(current.errors, []);
  await current.context.close();
  mode = "uncertain";
  storedDecision = null;
  const refreshed = await newPage();
  await refreshed.page.clock.install();
  await refreshed.page.getByRole("button", { name: "Claim", exact: true }).click();
  await fill(refreshed.page);
  await refreshed.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(
    refreshed.page.getByText("Checking your claim. Please keep this confirmation open…"),
  ).toBeVisible();
  const originalAttempt = await refreshed.page.evaluate(
    () => JSON.parse(sessionStorage.getItem("sole:specialty:attempts:v1"))[0],
  );
  await refreshed.page.reload();
  await expect(
    refreshed.page.getByRole("button", { name: "Claim", exact: true }),
  ).toBeVisible();
  await refreshed.page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(
    refreshed.page.getByText("Checking your claim. Please keep this confirmation open…"),
  ).toBeVisible();
  await refreshed.page.clock.fastForward(31000);
  await refreshed.page
    .getByRole("button", { name: "Re-enter original details", exact: true })
    .click();
  await fill(refreshed.page);
  mode = "won";
  await refreshed.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(refreshed.page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  assert.equal(
    requests.filter((item) => item.path === "/api/specialty/claims").at(-1).body
      .attemptId,
    originalAttempt.attemptId,
  );
  assert.deepEqual(refreshed.errors, []);
  await refreshed.context.close();
  mode = "won";
  storedDecision = null;
  const limited = await newPage(true);
  await limited.page.getByRole("button", { name: "Claim", exact: true }).click();
  await fill(limited.page);
  await limited.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(limited.page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  await expect(
    limited.page.getByText(/Your browser cannot save this claim/),
  ).toBeVisible();
  assert.deepEqual(limited.errors, []);
  await limited.context.close();
  mode = "won";
  storedDecision = null;
  const quota = await newPage("quota");
  await quota.page.getByRole("button", { name: "Claim", exact: true }).click();
  await fill(quota.page);
  await quota.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(quota.page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  const quotaAttempt = requests
    .filter((item) => item.path === "/api/specialty/claims")
    .at(-1).body;
  await expect(quota.page.getByText(/Your browser cannot save this claim/)).toBeVisible();
  await quota.page.getByRole("button", { name: "Close claim form", exact: true }).click();
  await quota.page
    .getByRole("button", { name: "Check giveaway status", exact: true })
    .click();
  await expect(quota.page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
  const quotaRecovery = requests
    .filter((item) => item.path === "/api/specialty/claims/result")
    .at(-1).body;
  assert.equal(
    quotaRecovery.attemptId === quotaAttempt.attemptId &&
      quotaRecovery.recoverySecret === quotaAttempt.recoverySecret,
    true,
  );
  await expect(quota.page.getByText(/Your browser cannot save this claim/)).toBeVisible();
  assert.deepEqual(quota.errors, []);
  await quota.context.close();
  console.log(
    "PASS: real claim dialog keyboard/mobile, corrections, duplicate click, private storage, refresh recovery, truthful loss and uncertain-outcome recovery (mocked HTTP)",
  );
} finally {
  await browser.close();
}
