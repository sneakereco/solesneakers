import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const bundle = await compileUxHarness(
  `
    import { StrictMode, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { AdminSidebar } from "./src/components/admin/AdminSidebar";
    import ShippingSettingsPage from "./src/app/admin/settings/shipping/page";
    import { CartDrawer } from "./src/components/cart/CartDrawer";
    import { CartProvider } from "./src/components/cart/CartProvider";
    import { SessionProvider } from "./src/contexts/SessionContext";
    import { SearchOverlay } from "./src/components/search/SearchOverlay";
    import { StoreMenuDrawer } from "./src/components/shell/StoreMenuDrawer";
    import { StorefrontHeader } from "./src/components/shell/StorefrontHeader";
    import { ConfirmDialog } from "./src/components/ui/ConfirmDialog";
    import { ModalPortal } from "./src/components/ui/ModalPortal";
    import { RdkSelect } from "./src/components/ui/Select";

    function OverlayFixture({ admin = false, storefront = false }) {
      const [open, setOpen] = useState("");
      const [confirm, setConfirm] = useState(false);
      const [invoker, setInvoker] = useState(null);
      const [confirmInvoker, setConfirmInvoker] = useState(null);
      const [showRemovableLauncher, setShowRemovableLauncher] = useState(true);
      const [value, setValue] = useState("ground");
      const [submits, setSubmits] = useState(0);
      const [backgroundClicks, setBackgroundClicks] = useState(0);
      const close = () => setOpen("");

      return (
        <>
          <button onClick={() => setBackgroundClicks(backgroundClicks + 1)}>
            Background clicks {backgroundClicks}
          </button>
          {storefront ? (
            <StorefrontHeader />
          ) : admin ? (
            <div data-admin-shell>
              <AdminSidebar userEmail="admin@example.test" role="admin" />
              <main data-admin-content className="md:ml-72">
                <div><ShippingSettingsPage /></div>
              </main>
            </div>
          ) : (
            <>
              <button onClick={() => setOpen("cart")}>Open cart</button>
              <button onClick={() => setOpen("search")}>Open search</button>
              <button onClick={() => setOpen("menu")}>Open store menu</button>
              <button onClick={(event) => {
                setInvoker(event.currentTarget);
                setOpen("example");
              }}>Open example editor</button>
              {showRemovableLauncher && <button onClick={(event) => {
                setInvoker(event.currentTarget);
                setOpen("removable");
              }}>Open and remove launcher</button>}
              <CartDrawer isOpen={open === "cart"} onClose={close} />
              <SearchOverlay isOpen={open === "search"} onClose={close} />
              <StoreMenuDrawer isOpen={open === "menu"} onClose={close} />
              <ModalPortal open={open === "example" || open === "removable"} onClose={close} invoker={invoker} label="Example editor">
                <form className="w-72 bg-white p-4" onSubmit={(event) => {
                  event.preventDefault();
                  setSubmits(submits + 1);
                }}>
                  <label htmlFor="service" id="service-label">Service</label>
                  <RdkSelect
                    id="service"
                    aria-labelledby="service-label"
                    value={value}
                    onChange={setValue}
                    searchable
                    options={[
                      {value: "ground", label: "Ground"},
                      {value: "express", label: "Express"},
                    ]}
                  />
                  <output>{value} / {submits} submissions</output>
                  <button type="button" onClick={(event) => {
                    setConfirmInvoker(event.currentTarget);
                    setConfirm(true);
                  }}>Review change</button>
                  <button type="submit">Submit</button>
                  {open === "removable" && <button type="button" onClick={() => setShowRemovableLauncher(false)}>
                    Remove launcher
                  </button>}
                  <ConfirmDialog
                    isOpen={confirm}
                    invoker={confirmInvoker}
                    title="Confirm service change"
                    description="The new service will apply to this order."
                    onCancel={() => setConfirm(false)}
                    onConfirm={() => setConfirm(false)}
                  />
                </form>
              </ModalPortal>
            </>
          )}
        </>
      );
    }

    document.body.style.overflow = "scroll";
    createRoot(document.getElementById("root")).render(
      <StrictMode>
        <SessionProvider initialUser={null} initialRole={null}>
          <CartProvider>
            <OverlayFixture
              admin={location.pathname === "/admin"}
              storefront={location.pathname === "/storefront"}
            />
          </CartProvider>
        </SessionProvider>
      </StrictMode>
    );
  `,
  {
    plugins: [
      {
        name: "overlay-routing-boundaries",
        setup(builder) {
          builder.onResolve(
            { filter: /^next\/(image|link|navigation)$/ },
            ({ path }) => ({
              path,
              namespace: "routing-boundary",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "routing-boundary" }, ({ path }) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              path === "next/navigation"
                ? `export const usePathname = () => "/admin/settings/shipping";
                   export const useRouter = () => ({push() {}});`
                : path === "next/link"
                  ? "export const useLinkStatus = () => ({ pending: false }); export default function Link({ onNavigate, ...props }) { return <a {...props} />; }"
                  : "export default function Image({ priority, unoptimized, ...props }) { return <img {...props} />; }",
          }));
        },
      },
    ],
  },
);

const fixtures = {
  "/api/admin/shipping/defaults": { defaults: [] },
  "/api/admin/shipping/origin": { origin: null },
  "/api/admin/shipping/carriers": { carriers: [] },
  "/api/store/taxonomy": { brands: [], sizes: [] },
};

async function openPage(page, path = "") {
  await page.route("**/api/**", (route) => {
    const payload = fixtures[new URL(route.request().url()).pathname];
    return payload ? route.fulfill({ json: payload }) : route.abort();
  });
  await openUxHarness(page, bundle, `https://ux.test/${path}`);
}

async function pointerOpenWithoutFocus(trigger, previouslyFocused) {
  await previouslyFocused.focus();
  await trigger.evaluate((element) => {
    element.addEventListener("mousedown", (event) => event.preventDefault(), {
      once: true,
    });
  });
  await trigger.click();
}

async function dragAcross(page, start, end) {
  await page.mouse.move(...start);
  await page.mouse.down();
  await page.mouse.move(...end, { steps: 5 });
  await page.mouse.up();
}

async function pointerSequence(dialog, events) {
  await dialog.evaluate((element, steps) => {
    const backdrop = document.elementFromPoint(4, 4);
    if (!element.contains(backdrop)) throw new Error("No modal backdrop at (4, 4)");
    for (const [type, pointerId, point = [4, 4]] of steps) {
      backdrop.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          pointerType: "touch",
          button: 0,
          clientX: point[0],
          clientY: point[1],
          detail: type === "click" ? 1 : 0,
        }),
      );
    }
  }, events);
}

async function verifyNativeDialog(page, dialog) {
  await expect(dialog).toBeVisible();
  assert.equal(await dialog.evaluate((element) => element.matches("dialog:modal")), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");

  const background = page.getByText("Background clicks 0", { exact: true });
  await background.evaluate((element) => element.focus());
  assert.equal(
    await dialog.evaluate((element) => element.contains(document.activeElement)),
    true,
    "attempting to focus a background control must leave focus in the dialog",
  );
}

async function verifyTabLoop(page, first, last) {
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
}

async function verifyClosed(page, dialog, trigger) {
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  assert.equal(await page.evaluate(() => document.body.style.overflow), "scroll");
  await expect(page.getByRole("button", { name: "Background clicks 0" })).toBeVisible();
}

async function verifyPlacement(locator, x, y, width, height) {
  await expect
    .poll(async () => {
      const bounds = await locator.boundingBox();
      return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
    })
    .toEqual([x, y, width, height]);
}

async function verifySidebarContrast(sidebar) {
  for (const control of [
    sidebar.getByText("Management", { exact: true }),
    sidebar.getByText("Operations", { exact: true }),
    sidebar.getByText("Admin", { exact: true }),
    sidebar.getByRole("link", { name: "Store access" }),
    sidebar.getByRole("link", { name: "View storefront" }),
  ]) {
    const contrast = await control.evaluate((element) => {
      function luminance(color) {
        const [red, green, blue] = color.match(/[\d.]+/g).map((part) => {
          const value = Number(part) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
      const foreground = getComputedStyle(element).color;
      let background = "rgba(0, 0, 0, 0)";
      for (
        let ancestor = element;
        ancestor && background === "rgba(0, 0, 0, 0)";
        ancestor = ancestor.parentElement
      ) {
        background = getComputedStyle(ancestor).backgroundColor;
      }
      const [dark, light] = [luminance(foreground), luminance(background)].sort(
        (a, b) => a - b,
      );
      return (light + 0.05) / (dark + 0.05);
    });
    assert.ok(
      contrast >= 4.5,
      `Insufficient sidebar text contrast: ${contrast.toFixed(2)}:1`,
    );
  }
}

async function verifyTouchTarget(control) {
  const bounds = await control.boundingBox();
  assert.ok(
    bounds && bounds.width >= 44 && bounds.height >= 44,
    "expected a 44×44 touch target",
  );
}

const browser = await chromium.launch({ headless: true });
const failures = [];

async function check(viewport, name, run) {
  const page = await browser.newPage({
    viewport,
    reducedMotion: viewport.width < 768 ? "reduce" : "no-preference",
  });
  page.setDefaultTimeout(2500);
  page.on("pageerror", (error) => {
    failures.push(error);
    console.error(error);
  });
  try {
    await run(page);
    console.log(`PASS ${viewport.width}×${viewport.height} ${name}`);
  } catch (error) {
    failures.push(
      new Error(`${viewport.width}×${viewport.height} ${name}`, { cause: error }),
    );
    console.error(`FAIL ${viewport.width}×${viewport.height} ${name}: ${error.message}`);
  } finally {
    await page.close();
  }
}

try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await check(
      viewport,
      "cart starts at Close and contains focus on repeat opening",
      async (page) => {
        await openPage(page);
        const trigger = page.getByRole("button", { name: "Open cart" });
        const dialog = page.getByRole("dialog", { name: /^My cart/ });
        for (const key of ["Escape", "Space"]) {
          await trigger.press("Space");
          await verifyNativeDialog(page, dialog);
          const close = dialog.getByRole("button", { name: "Close cart" });
          await expect(close).toBeFocused();
          const width = Math.min(viewport.width, 544);
          await verifyPlacement(
            dialog.getByRole("complementary"),
            viewport.width - width,
            0,
            width,
            viewport.height,
          );
          await verifyTouchTarget(close);
          await verifyTabLoop(
            page,
            close,
            dialog.getByRole("link", { name: "Shop Now" }),
          );
          await close.press(key);
          await verifyClosed(page, dialog, trigger);
        }
      },
    );

    await check(
      viewport,
      "search starts at its input and cycles through Close",
      async (page) => {
        await openPage(page);
        const trigger = page.getByRole("button", { name: "Open search" });
        const dialog = page.getByRole("dialog", { name: "Search products" });
        for (const key of ["Escape", "Enter"]) {
          await trigger.press("Enter");
          await verifyNativeDialog(page, dialog);
          const input = dialog.getByRole("searchbox", { name: "Search for products" });
          await expect(input).toBeFocused();
          const close = dialog.getByRole("button", { name: "Close search" });
          await verifyPlacement(
            dialog.getByRole("search"),
            0,
            128,
            viewport.width,
            viewport.width < 640 ? 80 : 96,
          );
          await verifyTouchTarget(close);
          await verifyTabLoop(page, input, close);
          await close.press(key);
          await verifyClosed(page, dialog, trigger);
        }
      },
    );

    await check(
      viewport,
      "store menu traps focus and releases it after Escape",
      async (page) => {
        await openPage(page);
        const trigger = page.getByRole("button", { name: "Open store menu" });
        await trigger.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Store menu" });
        await verifyNativeDialog(page, dialog);
        await expect(dialog).toBeFocused();
        const close = dialog.getByRole("button", { name: "Close menu" });
        await page.keyboard.press("Tab");
        await expect(close).toBeFocused();
        await verifyPlacement(
          dialog.getByRole("complementary"),
          0,
          0,
          Math.min(viewport.width, 392),
          viewport.height,
        );
        await verifyTouchTarget(close);
        await verifyTabLoop(page, close, dialog.getByRole("link", { name: "Shop All" }));

        if (viewport.width < 768) {
          const categories = dialog.getByRole("button", { name: "Shop by Category" });
          await categories.press("Enter");
          const back = dialog.getByRole("button", { name: "Back to main menu" });
          await expect(back).toBeFocused();
          await close.evaluate((element) => element.focus());
          await expect(back).toBeFocused();
          await verifyTabLoop(
            page,
            back,
            dialog.getByRole("link", { name: "Electronics" }),
          );
          await verifyTouchTarget(back);
          await back.press("Enter");
          await expect(categories).toBeFocused();
        }

        await page.keyboard.press("Escape");
        await verifyClosed(page, dialog, trigger);
      },
    );

    await check(
      viewport,
      "shipping editor traps focus and closes via Escape or backdrop",
      async (page) => {
        await openPage(page, "admin");
        const trigger = page.getByRole("button", { name: "Edit", exact: true }).first();
        const dialog = page.getByRole("dialog", { name: "Edit package defaults" });
        for (const dismiss of [
          () => page.keyboard.press("Escape"),
          () => page.mouse.click(4, 4),
        ]) {
          await trigger.press("Enter");
          await verifyNativeDialog(page, dialog);
          await verifyPlacement(dialog, 0, 0, viewport.width, viewport.height);
          const close = dialog.getByRole("button", { name: "Close", exact: true });
          await expect(close).toBeFocused();
          await verifyTabLoop(
            page,
            close,
            dialog.getByRole("button", { name: "Save", exact: true }),
          );
          await dismiss();
          await verifyClosed(page, dialog, trigger);
        }
      },
    );

    await check(
      viewport,
      "only the active select or nested dialog handles Escape",
      async (page) => {
        await openPage(page);
        const trigger = page.getByRole("button", { name: "Open example editor" });
        await trigger.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Example editor" });
        await verifyNativeDialog(page, dialog);
        const select = dialog.getByRole("button", { name: "Service" });
        assert.equal(await select.getAttribute("id"), "service");

        await select.press("Enter");
        const menu = dialog.getByRole("listbox");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("textbox")).toBeFocused();
        await page.evaluate(() => {
          window.escapesObserved = 0;
          window.addEventListener("keydown", (event) => {
            if (event.key === "Escape") window.escapesObserved++;
          });
        });
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(dialog).toBeVisible();
        await expect(select).toBeFocused();
        assert.equal(await page.evaluate(() => window.escapesObserved), 0);

        await select.press("Enter");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect(dialog.getByText("express / 0 submissions")).toBeVisible();
        await expect(select).toBeFocused();

        await select.press("Enter");
        await menu.getByRole("option", { name: "Ground" }).press("Enter");
        await expect(dialog.getByText("ground / 0 submissions")).toBeVisible();
        await expect(select).toBeFocused();

        const review = dialog.getByRole("button", { name: "Review change" });
        await pointerOpenWithoutFocus(review, select);
        const confirmation = page.getByRole("alertdialog", {
          name: "Confirm service change",
        });
        await verifyNativeDialog(page, confirmation);
        await expect(confirmation).toHaveAccessibleDescription(
          "The new service will apply to this order.",
        );
        await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(confirmation).toBeHidden();
        await expect(review).toBeFocused();
        assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
        await page.keyboard.press("Escape");
        await verifyClosed(page, dialog, trigger);
      },
    );
  }

  await check(
    { width: 390, height: 844 },
    "mobile admin menu traps focus and closes on desktop resize",
    async (page) => {
      await openPage(page, "admin");
      const trigger = page.getByRole("button", { name: "Open admin menu" });
      await verifyTouchTarget(trigger);
      const background = page.getByRole("button", { name: "Background clicks 0" });
      await pointerOpenWithoutFocus(trigger, background);
      const dialog = page.getByRole("dialog", { name: "Admin menu" });
      await verifyNativeDialog(page, dialog);
      const close = dialog.getByRole("button", { name: "Close admin menu" });
      await expect(close).toBeFocused();
      await verifyTouchTarget(close);
      const mobileSidebar = dialog.getByRole("complementary");
      await verifyPlacement(mobileSidebar, 0, 0, 304, 844);
      await verifySidebarContrast(mobileSidebar);
      await verifyTabLoop(
        page,
        close,
        dialog.getByRole("link", { name: "View storefront" }),
      );
      await page.keyboard.press("Escape");
      await verifyClosed(page, dialog, trigger);
      await trigger.press("Enter");
      await expect(dialog).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.body.style.overflow))
        .toBe("scroll");
      await verifySidebarContrast(page.getByRole("complementary"));
    },
  );

  const wide = { width: 1440, height: 1000 };
  for (const scenario of [
    {
      trigger: "Edit",
      dialog: "Edit package defaults",
      path: "admin",
      inside: [720, 470],
    },
    { trigger: "Open cart", dialog: /^My cart/, path: "", inside: [1190, 470] },
  ]) {
    await check(
      wide,
      `${scenario.trigger} ignores drags across the backdrop boundary`,
      async (page) => {
        await openPage(page, scenario.path);
        const trigger = page
          .getByRole("button", { name: scenario.trigger, exact: true })
          .first();
        const dialog = page.getByRole("dialog", { name: scenario.dialog });
        await trigger.press("Enter");
        await expect(dialog).toBeVisible();
        if (!scenario.path) {
          await verifyPlacement(dialog.getByRole("complementary"), 896, 0, 544, 1000);
        }
        await dragAcross(page, scenario.inside, [4, 4]);
        await expect(dialog.getByRole("button", { name: /Close/ })).toBeEnabled();
        await dragAcross(page, [4, 4], scenario.inside);
        await expect(dialog).toBeVisible();
        if (!scenario.path) {
          await expect(dialog.getByRole("complementary")).not.toHaveAttribute("inert");
        }
        await page.mouse.click(4, 4);
        await verifyClosed(page, dialog, trigger);
      },
    );
  }

  await check(
    wide,
    "only a matching uncancelled backdrop pointer can dismiss",
    async (page) => {
      await openPage(page);
      const trigger = page.getByRole("button", { name: "Open example editor" });
      const dialog = page.getByRole("dialog", { name: "Example editor" });
      await trigger.press("Enter");
      await expect(dialog).toBeVisible();
      await pointerSequence(dialog, [
        ["pointerdown", 8],
        ["pointerup", 9],
        ["click", 9],
      ]);
      await expect(dialog).toBeVisible();
      await pointerSequence(dialog, [
        ["pointerdown", 8],
        ["pointercancel", 8],
        ["pointerup", 8],
        ["click", 8],
      ]);
      await expect(dialog).toBeVisible();
      await pointerSequence(dialog, [
        ["pointerdown", 8],
        ["pointerup", 8, [720, 500]],
        ["click", 8, [720, 500]],
      ]);
      await expect(dialog).toBeVisible();
      await pointerSequence(dialog, [
        ["pointerdown", 8],
        ["pointercancel", 9],
        ["pointerup", 8],
        ["click", 8],
      ]);
      await verifyClosed(page, dialog, trigger);
    },
  );

  for (const scenario of [
    { trigger: "Search", dialog: "Search products", path: "storefront" },
    { trigger: "Cart (0)", dialog: /^My cart/, path: "storefront" },
    { trigger: "Open menu", dialog: "Store menu", path: "storefront" },
    { trigger: "Edit", dialog: "Edit package defaults", path: "admin" },
  ]) {
    await check(
      wide,
      `${scenario.trigger} restores its real launcher after unfocused pointer activation`,
      async (page) => {
        await openPage(page, scenario.path);
        const trigger = page
          .getByRole("button", { name: scenario.trigger, exact: true })
          .first();
        const background = page.getByRole("button", { name: "Background clicks 0" });
        const dialog = page.getByRole("dialog", { name: scenario.dialog });
        await pointerOpenWithoutFocus(trigger, background);
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await verifyClosed(page, dialog, trigger);
        if (scenario.trigger === "Cart (0)") {
          await background.focus();
          await page.evaluate(() => window.dispatchEvent(new Event("openCart")));
          await expect(dialog).toBeVisible();
          await page.keyboard.press("Escape");
          await verifyClosed(page, dialog, background);
        }
      },
    );
  }

  await check(
    wide,
    "falls back to the earlier focus when the launcher is removed",
    async (page) => {
      await openPage(page);
      const trigger = page.getByRole("button", { name: "Open and remove launcher" });
      const background = page.getByRole("button", { name: "Background clicks 0" });
      const dialog = page.getByRole("dialog", { name: "Example editor" });
      await pointerOpenWithoutFocus(trigger, background);
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Remove launcher" }).click();
      await expect(trigger).toHaveCount(0);
      await page.keyboard.press("Escape");
      await verifyClosed(page, dialog, background);
    },
  );
} finally {
  await browser.close();
}

if (failures.length) throw new AggregateError(failures, "Overlay regressions failed");
