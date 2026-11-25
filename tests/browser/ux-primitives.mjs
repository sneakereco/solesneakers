// Run: node tests/browser/ux-primitives.mjs
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const bundle = await compileUxHarness(`
  import { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { ActionButton } from "./src/components/ui/ActionButton";
  import { RequestError } from "./src/components/ui/RequestError";
  import { LoadingState, Skeleton } from "./src/components/ui/Skeleton";
  import { useAsyncAction } from "./src/components/ui/useAsyncAction";
  import { readJsonResponse } from "./src/lib/http/read-json-response";

  window.saveAttempts = [];

  function Harness() {
    const { pending, run } = useAsyncAction();
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(0);
    const [unrelated, setUnrelated] = useState(false);

    async function save(event) {
      event?.preventDefault();
      try {
        const result = await run(async () => {
          const response = await fetch("/fixture/save", { method: "POST" });
          return readJsonResponse(response, "Changes could not be saved.");
        });
        window.saveAttempts.push(result ? "admitted" : "skipped");
        if (result) {
          setError(null);
          setSaved((previous) => previous + 1);
        }
      } catch (error) {
        window.saveAttempts.push(error.status);
        setError(error.message);
      }
    }

    return (
      <main>
        <form onSubmit={save}>
          <ActionButton
            id="save"
            type="submit"
            className="bg-white px-3 py-2 text-zinc-950"
            pending={pending}
            pendingLabel="Saving your changes"
          >
            Save
          </ActionButton>
          <ActionButton type="button" aria-pressed={unrelated} onClick={() => setUnrelated(!unrelated)}>
            Independent action
          </ActionButton>
        </form>
        <p>Saved {saved}</p>
        {error && <RequestError message={error} onRetry={save} retrying={pending} />}
        <LoadingState label="Loading order details">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-12" />
        </LoadingState>
      </main>
    );
  }

  createRoot(document.getElementById("root")).render(<Harness />);
`);

async function mount(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const requests = [];
  await page.route("https://ux.test/fixture/save", async (route) => {
    assert.equal(route.request().method(), "POST");
    const status = await new Promise((release) => requests.push(release));
    await route.fulfill({
      status,
      json: status === 200 ? { saved: true } : { error: "Private upstream detail" },
    });
  });

  await openUxHarness(page, bundle);
  const save = page.locator("#save");
  await expect(save).toBeEnabled();

  return { save, errors, requests };
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const { save, errors, requests } = await mount(page);
  const initialBox = await save.boundingBox();
  await expect(save).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.evaluate(() => {
    const button = document.getElementById("save");
    button.click();
    button.click();
  });
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.saveAttempts)).toEqual(["skipped"]);
  await expect(save).toHaveAccessibleName("Saving your changes");
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toBeDisabled();
  assert.deepEqual(
    await save.boundingBox(),
    initialBox,
    "Pending keeps the button in place",
  );
  const independent = page.getByRole("button", { name: "Independent action" });
  await independent.click();
  await expect(independent).toHaveAttribute("aria-pressed", "true");

  requests[0](503);
  await expect(save).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveText("Changes could not be saved.");
  assert.deepEqual(await page.evaluate(() => window.saveAttempts), ["skipped", 503]);
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await retry.click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  requests[1](200);
  await expect(page.getByText("Saved 1")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await independent.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await expect(save).toHaveCSS("outline-style", "solid");
  await save.press("Space");
  await expect.poll(() => requests.length).toBe(3);
  requests[2](200);
  await expect(page.getByText("Saved 2")).toBeVisible();

  await save.press("Enter");
  await expect.poll(() => requests.length).toBe(4);
  requests[3](200);
  await expect(page.getByText("Saved 3")).toBeVisible();

  const box = await save.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(save).not.toHaveCSS("filter", "none");
  assert.equal(requests.length, 4, "Press feedback starts before the request");
  await page.mouse.up();
  await expect.poll(() => requests.length).toBe(5);
  requests[4](200);
  await expect(page.getByText("Saved 4")).toBeVisible();
  assert.deepEqual(errors, []);

  const touch = await browser.newPage({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const mobile = await mount(touch);
  const skeletons = touch.locator("[data-ui-skeleton]");
  await expect(skeletons).toHaveCount(2);
  await expect(skeletons.first()).not.toHaveCSS("animation-name", "none");
  await touch.emulateMedia({ reducedMotion: "reduce" });
  await expect(skeletons.first()).toHaveCSS("animation-name", "none");
  await expect(skeletons.first()).toBeVisible();
  await expect(skeletons.first()).toHaveAttribute("aria-hidden", "true");
  await expect(touch.getByRole("status")).toHaveText("Loading order details");
  await mobile.save.tap();
  await expect.poll(() => mobile.requests.length).toBe(1);
  await expect(mobile.save).toBeDisabled();
  mobile.requests[0](200);
  await expect(touch.getByText("Saved 1")).toBeVisible();
  assert.deepEqual(mobile.errors, []);

  console.info(
    "PASS: shared UX primitives handle pending requests, recovery, keyboard and touch, and reduced motion",
  );
} finally {
  await browser.close();
}
