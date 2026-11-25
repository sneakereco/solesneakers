// Real claim components in Chromium. Provider/HTTP responses are fixtures, not hosted capacity evidence.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { mkdir } from "node:fs/promises";

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
    import { ClaimRecoveryPanel } from "./src/Modules/SpecialtyProducts/Source/Features/Claim/ClaimRecoveryPanel";
    const product = { id: "${productId}", name: "Cash prize", description: null, imageUrl: null, claimable: true };
    createRoot(document.getElementById("root")).render(<><h1>Giveaway fixture</h1>{!location.search && <ClaimButton product={product} />}<ClaimRecoveryPanel /></>);
  `,
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"' },
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
      ],
    }),
  ]).process("@tailwind base; @tailwind components; @tailwind utilities;", {
    from: undefined,
  })
).css;
const browser = await chromium.launch({ headless: true });
let mode = "correction";
const requests = [];
let storedDecision = null;
async function newPage(blockStorage = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 640 } });
  if (blockStorage)
    await context.addInitScript(() =>
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new Error("blocked storage");
        },
      }),
    );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://specialty-ui.test/**", async (route) => {
    const url = new URL(route.request().url());
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
    if (url.pathname.endsWith("/result"))
      return route.fulfill({
        status: storedDecision ? 200 : 202,
        headers: { "Retry-After": "1" },
        json: storedDecision
          ? { result: storedDecision, replayed: true }
          : { status: "pending", retryAfterSeconds: 1 },
      });
    if (mode === "uncertain")
      return route.fulfill({ status: 503, json: { status: "unavailable" } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    storedDecision =
      mode === "sold_out"
        ? { status: "sold_out" }
        : mode === "already_claimed"
          ? { status: "already_claimed" }
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
  const { page, context, errors } = await newPage();
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "You claimed it!" })).toBeVisible();
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
  await page.getByText("Check your giveaway claim results", { exact: true }).click();
  await page.getByRole("button", { name: "Check claim result", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You claimed it!" })).toBeVisible();
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
    assert.deepEqual(current.errors, []);
    await current.context.close();
  }
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
  const submitCount = requests.filter(
    (item) => item.path === "/api/specialty/claims",
  ).length;
  storedDecision = { status: "won", receipt };
  await current.page
    .getByRole("button", { name: "Check result again", exact: true })
    .click();
  await expect(
    current.page.getByRole("heading", { name: "You claimed it!" }),
  ).toBeVisible();
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
  await expect(
    refreshed.page.getByRole("heading", { name: "You claimed it!" }),
  ).toBeVisible();
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
  await expect(
    limited.page.getByRole("heading", { name: "You claimed it!" }),
  ).toBeVisible();
  await expect(
    limited.page.getByText(/Your browser cannot save this claim/),
  ).toBeVisible();
  assert.deepEqual(limited.errors, []);
  await limited.context.close();
  console.log(
    "PASS: real claim dialog keyboard/mobile, corrections, duplicate click, private storage, refresh recovery, truthful loss and uncertain-outcome recovery (mocked HTTP)",
  );
} finally {
  await browser.close();
}
