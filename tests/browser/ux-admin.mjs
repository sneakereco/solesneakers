import { chromium, expect } from "@playwright/test";
import { compileUxHarness, openUxHarness } from "./helpers/ux-harness.mjs";

const bundle = await compileUxHarness(
  `
import { SessionProvider } from "./src/contexts/SessionContext";
import {createRoot,hydrateRoot} from "react-dom/client";
import {useState} from "react";
import {renderToString} from "react-dom/server.browser";
import {InventoryClient} from "@/app/admin/inventory/client";
import {CreateProductClient} from "@/app/admin/inventory/create/client";
import Detail from "@/app/admin/transactions/[orderId]/page";
import Settings from "@/app/admin/settings/shipping/page";
import {CreateLabelForm} from "@/components/admin/shipping/CreateLabelForm";
const product={id:"11111111-1111-4111-8111-111111111111",name:"Fixture shoe",category:"sneakers",condition:"new",images:[],variants:[]};
const order={id:"fixture-order",status:"paid",fulfillment:"pickup",fulfillment_status:"unfulfilled",items:[],total:80,subtotal:80,created_at:"2026-11-01",shipping:{name:"Fixture Customer",phone:"2025550112",line1:"1 Main St",city:"Columbia",state:"SC",postal_code:"29201",country:"US"}};
const initialSizes=[{id:"size7",label:"7",sizeType:"shoe"},{id:"size8",label:"8",sizeType:"shoe"}];
import Dashboard from "@/app/admin/dashboard/page";
import Transactions from "@/app/admin/transactions/page";
import Pickups from "@/app/admin/pickups/page";
import Shipping from "@/app/admin/shipping/page";
import Tags from "@/app/admin/tags/page";
import {StoreAccessSettingsPanel} from "@/components/admin/settings/StoreAccessSettingsPanel";
import {FeaturedItemsManager} from "@/app/admin/featured-items/client";
const views={settings:Settings,detail:Detail,product:()=> <CreateProductClient initialBrands={[{id:"brand",label:"Fixture"},{id:"other",label:"Other"}]} initialSizes={location.search === '?no-sizes' ? [] : initialSizes}/>,inventory:()=> <InventoryClient initialProducts={[product]} initialTotal={1} initialSkuTotal={0} initialInventoryUnitTotal={0} initialFilters={{}}/>,label:()=> <CreateLabelForm open order={order} originLine="Fixture origin" onClose={()=>{}} onSuccess={()=>{}}/>, dashboard: Dashboard, pickups: Pickups, transactions: Transactions, shipping: Shipping, tags: Tags, access: StoreAccessSettingsPanel, featured: FeaturedItemsManager };
const Selected=views[location.pathname.slice(1)];function View(){const [id,change]=useState("staff");window.changeStaff=change;return <SessionProvider initialUser={{id,email:id+"@example.test"}} initialRole="admin"><Selected/></SessionProvider>}
const root=document.getElementById("root");
if(location.search==="?hydrate") {
  root.innerHTML=renderToString(<View/>);
  window.hydrateForm=()=>hydrateRoot(root,<View/>);
} else createRoot(root).render(<View/>);`,
  {
    plugins: [
      {
        name: "fixture-next",
        setup(build) {
          // Hold a previously admitted label callback at the action boundary.
          build.onResolve({ filter: /^@\/components\/ui\/useAsyncAction$/ }, (args) =>
            args.importer.endsWith("CreateLabelForm.tsx")
              ? { path: args.path, namespace: "label-command" }
              : null,
          );
          build.onLoad({ filter: /.*/, namespace: "label-command" }, () => ({
            loader: "js",
            resolveDir: process.cwd(),
            contents: `
            import {useAsyncAction as useRealAction} from "./src/components/ui/useAsyncAction";
            export function useAsyncAction(){
              const action=useRealAction();
              return {...action,run:operation=>action.run(()=>{
                if(!window.holdLabelCommand)return operation();
                window.holdLabelCommand=false;
                return new Promise((resolve,reject)=>{window.releaseLabelCommand=()=>operation().then(resolve,reject);});
              })};
            }
          `,
          }));
          build.onResolve({ filter: /^next\/(navigation|image|link)$/ }, ({ path }) => ({
            path,
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents:
              path === "next/navigation"
                ? "export const useParams=()=>({orderId:'fixture-order'});export const useRouter=()=>({push(href){window.fixtureNavigation=href},refresh(){}});"
                : path === "next/link"
                  ? "export const useLinkStatus=()=>({pending:false});export default function Link({onNavigate,...props}){return <a {...props}/>;}"
                  : "export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}",
          }));
        },
      },
    ],
  },
);
const browser = await chromium.launch();
const failures = [];
async function check(name, body) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5500);
  page.on("pageerror", (error) => console.error(name, error.message));
  try {
    await page.route("**/*", (r) => r.abort());
    await body(page);
    console.log("PASS", name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL", name, error.message);
  } finally {
    await page.close();
  }
}
function inventoryRead(search, rows) {
  const sku = search.get("exactSku");
  const id = search.get("exactId");
  if (sku || id)
    return {
      product:
        rows.find((row) =>
          id ? row.id === id : row.variants.some((variant) => variant.sku === sku),
        ) ?? null,
    };
  const archived = search.get("stockStatus") === "archived";
  const matching = rows.filter(
    (row) =>
      Boolean(row.archived_at) === archived &&
      row.name.toLowerCase().includes((search.get("q") ?? "").toLowerCase()),
  );
  const page = Number(search.get("page") ?? 1),
    limit = Number(search.get("limit") ?? 20);
  return {
    products: matching.slice(0, 500).slice((page - 1) * limit, page * limit),
    total: matching.length,
    page,
    limit,
  };
}
function olderInventoryRecord(record) {
  return [
    ...Array.from({ length: 550 }, (_, i) => ({
      ...record,
      id: "similar-" + i,
      variants: [{ sku: "other-" + i }],
    })),
    record,
  ];
}
function deferred() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
try {
  for (const action of [
    "rates",
    "purchase",
    "submitted purchase",
    "purchased without tracking",
  ]) {
    await check("label scope denial " + action, async (page) => {
      const submitted =
        action === "submitted purchase" || action === "purchased without tracking";
      const counts = deferred(),
        result = deferred();
      let rates = 0,
        buys = 0;
      const address = {
        name: "Fixture Recipient",
        phone: "2025550112",
        line1: "77 Fixture Street",
        city: "Columbia",
        state: "SC",
        postal_code: "29201",
        country: "US",
      };
      await page.route("**/api/admin/**", async (r) => {
        const url = new URL(r.request().url());
        if (url.pathname.endsWith("/orders")) {
          if (url.searchParams.get("limit") === "1") {
            await counts.promise;
            return r.fulfill({ status: 403, json: {} });
          }
          return r.fulfill({
            json: {
              orders: [
                {
                  id: "fixture-order",
                  shipping: address,
                  status: "paid",
                  fulfillment: "ship",
                  fulfillment_status: "unfulfilled",
                  items: [],
                  total: 30,
                },
              ],
              count: 1,
            },
          });
        }
        if (url.pathname.endsWith("/origin"))
          return r.fulfill({ json: { origin: address } });
        if (url.pathname.endsWith("/defaults"))
          return r.fulfill({ json: { defaults: [] } });
        if (url.pathname.endsWith("/rates")) {
          rates++;
          return r.fulfill({
            json: {
              shipment: { id: "s", rates: [{ id: "r", carrier: "Fixture", rate: "5" }] },
            },
          });
        }
        if (url.pathname.endsWith("/labels")) {
          buys++;
          await result.promise;
          return action === "purchased without tracking"
            ? r.fulfill({
                status: 502,
                json: {
                  code: "shipping_label_purchased_without_tracking",
                  requestId: "fixture-ref",
                },
              })
            : r.abort();
        }
        return r.abort();
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(() => {
        window.labelRequests = [];
        const request = window.fetch;
        window.fetch = (...args) => {
          const url = new URL(
            args[0] instanceof Request ? args[0].url : args[0],
            location.href,
          );
          if (
            ["/api/admin/shipping/rates", "/api/admin/shipping/labels"].includes(
              url.pathname,
            )
          )
            window.labelRequests.push(url.pathname);
          return request(...args);
        };
      });
      await openUxHarness(page, bundle, "https://ux.test/shipping");
      await page
        .getByRole("button", { name: "Create label", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator('input[value="77 Fixture Street"]')).toHaveValue(
        "77 Fixture Street",
      );
      const get = dialog.getByRole("button", { name: /get shipping rates/i });
      if (action !== "rates") await get.click();
      if (!submitted) await page.evaluate(() => (window.holdLabelCommand = true));
      await (
        action === "rates"
          ? get
          : dialog.getByRole("button", { name: "Purchase shipping label" })
      ).click();
      if (submitted) await expect.poll(() => buys).toBe(1);
      else await page.waitForFunction(() => !!window.releaseLabelCommand);
      try {
        counts.release();
        await expect(
          page.getByText("Admin access could not be verified.", { exact: true }).first(),
        ).toBeAttached();
        if (!submitted)
          await page.evaluate(() => {
            void window.releaseLabelCommand();
          });
        else
          expect(
            await page.evaluate(() =>
              sessionStorage.getItem("admin-check:label:fixture-order"),
            ),
          ).toBe("support");
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('input[value="77 Fixture Street"]')).toHaveCount(0);
        if (submitted) {
          result.release();
          await expect
            .poll(() =>
              page.evaluate(() =>
                sessionStorage.getItem("admin-check:label:fixture-order"),
              ),
            )
            .toBe(
              action === "purchased without tracking"
                ? "purchased_without_tracking:fixture-ref"
                : "unknown",
            );
        }
        const requests = await page.evaluate(() => window.labelRequests);
        expect(requests).toEqual(
          action === "rates"
            ? []
            : submitted
              ? ["/api/admin/shipping/rates", "/api/admin/shipping/labels"]
              : ["/api/admin/shipping/rates"],
        );
        expect(rates).toBe(action === "rates" ? 0 : 1);
        expect(buys).toBe(submitted ? 1 : 0);
      } finally {
        counts.release();
        result.release();
      }
    });
  }
  for (const view of ["shipping", "pickups"]) {
    await check("private item dialog " + view, async (page) => {
      const nextOwner = deferred();
      const counts = deferred();
      let changed = false;
      await page.route("**/api/admin/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/orders")) {
          if (changed) {
            await nextOwner.promise;
            return route.fulfill({ json: { count: 0, orders: [] } });
          }
          if (url.searchParams.get("limit") === "1") {
            await counts.promise;
            return route.fulfill({ status: view === "shipping" ? 403 : 503, json: {} });
          }
          return route.fulfill({
            json: {
              count: 1,
              orders: [
                {
                  id: "fixture-order",
                  status: "paid",
                  fulfillment: view === "shipping" ? "ship" : "pickup",
                  fulfillment_status: "unfulfilled",
                  items: [
                    { id: "item", quantity: 1, product_name: "Private fixture item" },
                  ],
                  total: 30,
                },
              ],
            },
          });
        }
        return route.fulfill({ json: {} });
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await openUxHarness(page, bundle, "https://ux.test/" + view);
      await page.getByRole("button", { name: "Details for order fixture-order" }).click();
      await page.getByTitle("Private fixture item", { exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Private fixture item");
      try {
        counts.release();
        if (view === "pickups") {
          await expect(
            page.getByText("Unable to load queue counts.", { exact: true }),
          ).toBeAttached();
          await expect(dialog).toContainText("Private fixture item");
          changed = true;
          await page.evaluate(() => window.changeStaff("second"));
        }
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText("Private fixture item")).toHaveCount(0);
      } finally {
        counts.release();
        nextOwner.release();
      }
    });
  }
  await check("retained pagination and denial", async (page) => {
    let result = 503;
    const held = deferred();
    await page.route("**/api/admin/orders?**", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("limit") === "1")
        return route.fulfill({ json: { count: 30, orders: [] } });
      if (params.get("page") === "2") {
        await held.promise;
        return route.fulfill({ status: result, json: {} });
      }
      return route.fulfill({
        json: {
          count: 30,
          orders: [{ id: "first-page", status: "paid", items: [], total: 25 }],
        },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/transactions");
    const old = page.getByRole("link", { name: "View transaction first-page" });
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(old).toBeVisible();
    await next.press("Enter");
    try {
      await expect(old).toBeVisible();
      await expect(next).toBeFocused();
      await expect(
        page.getByRole("status").filter({ hasText: /showing page 1/i }),
      ).toBeVisible();
    } finally {
      held.release();
    }
    await expect(page.getByRole("alert")).toContainText(/showing page 1/i);
    await expect(old).toBeVisible();
    await expect(next).toBeFocused();
    result = 403;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(old).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("access");
  });
  await check("queue with changed staff owner", async (page) => {
    const gate = deferred();
    let owner = "first";
    await page.route("**/api/admin/orders?**", async (route) => {
      const id = owner;
      if (id === "next") await gate.promise;
      return route.fulfill({
        json: { count: 1, orders: [{ id, status: "paid", items: [], total: 25 }] },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/transactions");
    const old = page.getByRole("link", { name: "View transaction first" });
    await expect(old).toBeVisible();
    owner = "next";
    await page.evaluate(() => window.changeStaff("second"));
    try {
      await expect(old).toHaveCount(0);
    } finally {
      gate.release();
    }
    await expect(page.getByRole("link", { name: "View transaction next" })).toBeVisible();
  });
  for (const failure of [401, 429, 503, "network"]) {
    await check("dashboard " + failure, async (page) => {
      const gate = deferred();
      let recovering = false;
      await page.route("**/api/**", async (route) => {
        await gate.promise;
        if (!recovering) {
          if (failure === "network") return route.abort();
          return route.fulfill({ status: failure, json: { error: "Unavailable" } });
        }
        return route.fulfill({
          json: route.request().url().includes("/orders")
            ? { orders: [{ id: "fixture-order", status: "paid", total: 85 }] }
            : { total: 7 },
        });
      });
      await openUxHarness(page, bundle, "https://ux.test/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      try {
        await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
        await expect(page.locator("[aria-busy=true]").first()).toBeVisible();
      } finally {
        gate.release();
      }
      await expect(page.getByRole("alert").first()).toBeVisible();
      recovering = true;
      await page.getByRole("button", { name: "Retry", exact: true }).first().click();
      await expect(page.getByText("$85.00", { exact: true }).first()).toBeVisible();
    });
  }
  for (const view of [
    "transactions",
    "pickups",
    "shipping",
    "tags",
    "access",
    "featured",
  ]) {
    await check(view + " failed read", async (page) => {
      await page.route("**/api/**", (r) =>
        r.fulfill({ status: 503, json: { error: "Unavailable" } }),
      );
      await openUxHarness(page, bundle, "https://ux.test/" + view);
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }).first(),
      ).toBeVisible();
      await expect(
        page
          .getByText(/^(No transactions found|No orders in this queue|\$0\.00)/)
          .first(),
      ).toHaveCount(0);
    });
  }

  await check("confirmed tag plus failed refresh", async (page) => {
    let writes = 0;
    const gate = deferred();
    let failed = false;
    await page.route("**/api/admin/tags/**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") {
        writes++;
        await gate.promise;
        failed = true;
        return route.fulfill({ json: { success: true } });
      }
      if (failed) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({
        json: {
          [url.pathname.split("/").pop()]: url.pathname.endsWith("brands")
            ? [{ id: "brand-a", canonical_label: "Existing", is_active: true }]
            : [],
        },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/tags");
    await expect(page.getByText("Existing")).toBeVisible();
    await page.getByPlaceholder("New brand label").fill("Fixture");
    const add = page.getByRole("button", { name: "Add", exact: true });
    await add.evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: /saving/i })
          .first(),
      ).toBeVisible();
    } finally {
      gate.release();
    }
    await expect(page.getByText(/tag saved/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.getByText("Existing")).toBeVisible();
    if (writes !== 1) throw Error("Duplicate tag write");
  });
  await check(
    "server-rendered variant validation focuses the hydrated field",
    async (page) => {
      const hydration = [];
      page.on("console", (msg) => {
        if (/hydrated|hydration/i.test(msg.text()))
          hydration.push(msg.text().split("\n")[0]);
      });
      await page.route("**/api/admin/**", (r) => r.fulfill({ json: { models: [] } }));
      await openUxHarness(page, bundle, "https://ux.test/product?hydrate");
      await page.evaluate(() => {
        window.hydrateForm();
      });
      await page.getByLabel(/Full Title/).fill("Fixture");
      await page.getByLabel("Override Brand").fill("Fixture");
      const price = page.getByLabel(/Sale Price/);
      await page
        .getByRole("button", { name: "Create Product" })
        .evaluate((el) =>
          el.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      await expect(price).toBeFocused();
      await expect(price).toHaveAttribute("aria-invalid", "true");
      await expect.poll(() => hydration).toEqual([]);
    },
  );
  await check("product select, parse, upload and save", async (page) => {
    const parseGate = deferred(),
      uploadGate = deferred(),
      saveGate = deferred();
    let saves = 0,
      uploads = 0,
      parses = 0;
    await page.route("**/api/**", async (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path.endsWith("parse-title")) {
        parses++;
        if (parses === 1) {
          await parseGate.promise;
          return r.fulfill({ status: 503, json: {} });
        }
        return r.fulfill({
          json: { brand: { id: "brand", label: "Fixture" }, model: null },
        });
      }
      if (path.endsWith("product-image")) {
        uploads++;
        await uploadGate.promise;
        return r.fulfill({ status: 503, json: { error: "Upload failed" } });
      }
      if (path.endsWith("products")) {
        saves++;
        await saveGate.promise;
        return r.fulfill({ status: 422, json: { error: "Fixture validation error" } });
      }
      return r.fulfill({ json: { models: [] } });
    });
    await openUxHarness(page, bundle, "https://ux.test/product");
    const footer = page.locator("[data-admin-form-actions]");
    await expect(footer).toHaveCSS("position", "fixed");
    await expect(footer).toBeInViewport();
    await page.getByLabel("Full Title", { exact: false }).fill("Fixture model");
    await expect(page.getByText("Parsing...")).toBeVisible();
    parseGate.release();
    await page.getByRole("button", { name: "Retry parsing" }).click();
    await expect.poll(() => parses).toBe(2);
    await page.getByLabel(/^Size/).first().click();
    const search = page.getByRole("combobox", { name: /search sizes/i });
    await search.press("ArrowDown");
    const active = await search.getAttribute("aria-activedescendant");
    if (!active) throw Error("Missing active option");
    await expect(page.locator("[role=option][data-active=true]")).toHaveAttribute(
      "id",
      active,
    );
    await search.press("Enter");
    await page.getByLabel(/Sale Price/).fill("10");
    await page.locator("input[type=file]").setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71]),
    });
    try {
      await expect.poll(() => uploads).toBe(1);
      await expect(page.getByRole("button", { name: "Create Product" })).toBeDisabled();
    } finally {
      uploadGate.release();
    }
    await expect(page.getByText(/All 1 upload\(s\) failed/i)).toBeVisible();
    const idleSaveSize = await page
      .getByRole("button", { name: "Create Product" })
      .boundingBox();
    await page.getByRole("button", { name: "Create Product" }).evaluate((el) => {
      el.form.requestSubmit();
      el.form.requestSubmit();
    });
    try {
      await expect.poll(() => saves).toBe(1);
      const saving = page.getByRole("button", { name: /saving/i });
      await expect(saving).toBeDisabled();
      const size = await saving.boundingBox();
      expect(size.width).toBe(idleSaveSize.width);
      expect(size.height).toBe(idleSaveSize.height);
    } finally {
      saveGate.release();
    }
    await expect(page.getByText("Fixture validation error")).toBeVisible();
    await expect(page.getByLabel(/Full Title/)).toHaveValue("Fixture model");
  });
  await check("inventory archive and export", async (page) => {
    const gate = deferred();
    let writes = 0;
    await page.route("**/api/admin/products/**", async (r) => {
      if (r.request().method() === "PATCH") {
        writes++;
        await gate.promise;
        return r.fulfill({ json: { success: true } });
      }
      return r.fulfill({ status: 503, json: {} });
    });
    await openUxHarness(page, bundle, "https://ux.test/inventory");
    await page.getByRole("button", { name: "Archive product" }).evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(page.getByRole("status")).toContainText(/Updating Fixture shoe/);
    } finally {
      gate.release();
    }
    await expect(page.getByText("Fixture shoe archived.")).toBeVisible();
    if (writes !== 1) throw Error("Duplicate archive");
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("status")).toContainText(/Unable to export/);
  });

  await check("invalid product size focuses the closed invalid trigger", async (page) => {
    await page.route("**/api/admin/**", (route) =>
      route.fulfill({ json: { models: [] } }),
    );
    await openUxHarness(page, bundle, "https://ux.test/product?no-sizes");
    await page.getByLabel(/Full Title/).fill("Fixture");
    await page.getByLabel("Override Brand").fill("Fixture");
    await page.getByLabel(/Sale Price/).fill("10");
    await page
      .getByRole("button", { name: "Create Product" })
      .evaluate((el) =>
        el.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    const size = page.getByLabel(/^Size/).first();
    await expect(size).toBeFocused();
    await expect(size).toHaveAttribute("aria-invalid", "true");
    await expect(size).toHaveAccessibleDescription(/size is required/i);
  });
  await check("searchable variant option association", async (page) => {
    await openUxHarness(page, bundle, "https://ux.test/product");
    await page.getByLabel(/^Size/).first().click();
    await page.locator("[data-ui-select-search]").press("ArrowDown");
    await expect(page.locator("[data-ui-select-search]")).toHaveAttribute(
      "aria-activedescendant",
      /.+/,
    );
  });
  await check("rates retry and unknown label", async (page) => {
    let reads = 0,
      writes = 0;
    const rates = deferred(),
      purchase = deferred();
    await page.route("**/api/admin/shipping/**", async (r) => {
      if (r.request().url().endsWith("/rates")) {
        reads++;
        if (reads === 1) {
          await rates.promise;
          return r.fulfill({ status: 503, json: { error: "Rates unavailable" } });
        }
        return r.fulfill({
          json: {
            shipment: {
              id: "s1",
              rates: [{ id: "r1", carrier: "UPS", service: "Ground", rate: "5" }],
            },
          },
        });
      }
      writes++;
      await purchase.promise;
      return r.abort();
    });
    await openUxHarness(page, bundle, "https://ux.test/label");
    const get = page.getByRole("button", { name: /Get shipping rates/i });
    await get.evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(page.getByRole("button", { name: /Getting rates/ })).toBeDisabled();
    } finally {
      rates.release();
    }
    await get.click();
    await expect.poll(() => reads).toBe(2);
    const buy = page.getByRole("button", { name: "Purchase shipping label" });
    await buy.evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(page.getByRole("button", { name: /Purchasing label/ })).toBeDisabled();
    } finally {
      purchase.release();
    }
    await expect(page.getByRole("alert")).toContainText(/unconfirmed/);
    await expect(buy).toBeDisabled();
    if (writes !== 1) throw Error("Duplicate label");
  });
  await check("email preview and unconfirmed resend", async (page) => {
    const gate = deferred();
    let writes = 0,
      reads = 0;
    await page.route("**/api/admin/**", async (r) => {
      if (r.request().method() === "POST") {
        writes++;
        await gate.promise;
        return r.abort();
      }
      reads++;
      return r.fulfill({
        json: {
          order: {
            id: "fixture-order",
            status: "paid",
            fulfillment: "pickup",
            total: 10,
            items: [],
            created_at: "2026-11-01",
          },
          paymentTransaction: null,
          emailLogs: [
            {
              id: "log1",
              email_type: "order_confirmation",
              sent_at: "2026-11-01",
              delivery_status: "delivered",
              html_snapshot: "<p>Fixture preview</p>",
            },
          ],
        },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/detail");
    const view = page.getByRole("button", { name: "View", exact: true });
    await view.click();
    await expect(page.getByRole("dialog", { name: "Email preview" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(view).toBeFocused();
    const resend = page.getByRole("button", { name: "Resend", exact: true });
    await resend.evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(page.getByRole("button", { name: /sending/i })).toBeDisabled();
    } finally {
      gate.release();
    }
    await expect.poll(() => reads).toBe(2);
    await expect(resend).toBeDisabled();
    if (writes !== 1) throw Error("Duplicate resend");
  });

  await check("pickup completion and failed refresh", async (page) => {
    const gate = deferred();
    let writes = 0,
      refresh = false;
    await page.route("**/api/admin/orders**", async (r) => {
      const url = new URL(r.request().url());
      if (r.request().method() === "POST") {
        writes++;
        await gate.promise;
        refresh = true;
        return r.fulfill({ json: { success: true } });
      }
      if (refresh) return r.fulfill({ status: 503, json: {} });
      return r.fulfill({
        json: {
          count: 1,
          orders:
            url.searchParams.get("limit") === "1"
              ? []
              : [
                  {
                    id: "fixture-order",
                    status: "paid",
                    fulfillment_status: "unfulfilled",
                    items: [],
                    total: 50,
                    subtotal: 50,
                    created_at: "2026-11-01",
                  },
                ],
        },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/pickups");
    await page
      .getByRole("button", { name: "Details for order fixture-order" })
      .press("Enter");
    const mark = page
      .getByRole("checkbox", { name: "Mark order fixture-order picked up" })
      .last();
    await mark.evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(
        page.getByRole("status").filter({ hasText: "Completing pickup" }),
      ).toBeVisible();
    } finally {
      gate.release();
    }
    await expect(page.getByText("Pickup marked complete.")).toBeVisible();
    await expect(mark).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }).first(),
    ).toBeVisible();
    if (writes !== 1) throw Error("Duplicate pickup");
  });
  await check("featured add preserves list after refresh failure", async (page) => {
    const gate = deferred();
    let writes = 0,
      updated = false;
    const item = {
      id: "i",
      product_id: "a",
      sort_order: 0,
      product: {
        id: "a",
        name: "Current product",
        category: "sneakers",
        variants: [],
        images: [],
      },
    };
    await page.route("**/api/admin/**", async (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() === "POST") {
        writes++;
        await gate.promise;
        updated = true;
        return r.fulfill({ json: { success: true } });
      }
      if (u.pathname.endsWith("products"))
        return r.fulfill({
          json: {
            products: [
              {
                id: "b",
                name: "Another product",
                category: "sneakers",
                images: [],
                variants: [],
              },
            ],
          },
        });
      return updated
        ? r.fulfill({ status: 503, json: {} })
        : r.fulfill({ json: { items: [item] } });
    });
    await openUxHarness(page, bundle, "https://ux.test/featured");
    await expect(page.getByText("Current product")).toBeVisible();
    await page.getByRole("searchbox").fill("Another");
    await page.getByRole("button", { name: /Another product/ }).evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      await expect(
        page
          .getByRole("status", { name: "" })
          .filter({ hasText: "Adding featured item" }),
      ).toBeVisible();
    } finally {
      gate.release();
    }
    await expect(page.getByText("Product added to featured items")).toBeVisible();
    await expect(page.getByText("Current product")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    if (writes !== 1) throw Error("Duplicate featured item");
  });
  await check("access settings draft and duplicate save", async (page) => {
    let writes = 0;
    const gate = deferred();
    await page.route("**/api/admin/store-access", async (r) => {
      if (r.request().method() === "GET")
        return r.fulfill({
          json: {
            settings: {
              siteLockEnabled: false,
              siteUnlockAt: null,
              checkoutLockEnabled: false,
              checkoutLockMessage: "Old",
            },
          },
        });
      writes++;
      await gate.promise;
      return r.fulfill({ status: 422, json: { error: "Fixture invalid" } });
    });
    await openUxHarness(page, bundle, "https://ux.test/access");
    await page.getByLabel("Checkout Message").fill("New message");
    await page
      .getByRole("button", { name: "Save store access settings" })
      .evaluate((el) => {
        el.click();
        el.click();
      });
    try {
      await expect(page.getByRole("button", { name: /Saving/ })).toBeDisabled();
    } finally {
      gate.release();
    }
    await expect(page.getByRole("status")).toHaveText("Fixture invalid");
    await expect(page.getByLabel("Checkout Message")).toHaveValue("New message");
    if (writes !== 1) throw Error("Duplicate access save");
  });
  await check(
    "shipping settings initial failure, native modal and save retry",
    async (page) => {
      const gate = deferred();
      let writes = 0,
        ready = false;
      await page.route("**/api/admin/shipping/**", async (r) => {
        const url = r.request().url();
        if (r.request().method() === "POST") {
          writes++;
          await gate.promise;
          return r.fulfill({ status: 422, json: { error: "Fixture rejected" } });
        }
        if (!ready) return r.fulfill({ status: 503, json: {} });
        return r.fulfill({
          json: url.endsWith("/defaults")
            ? { defaults: [] }
            : url.endsWith("/origin")
              ? { origin: null }
              : { carriers: [] },
        });
      });
      await openUxHarness(page, bundle, "https://ux.test/settings");
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(
        0,
      );
      ready = true;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      const edit = page.getByRole("button", { name: "Edit", exact: true }).first();
      await edit.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Width (in)").fill("14");
      await dialog.getByRole("button", { name: "Save", exact: true }).evaluate((el) => {
        el.click();
        el.click();
      });
      try {
        await expect(dialog.getByRole("button", { name: /Saving/ })).toBeDisabled();
      } finally {
        gate.release();
      }
      await expect(dialog.getByText(/Fixture rejected/)).toBeVisible();
      await expect(dialog.getByLabel("Width (in)")).toHaveValue("14");
      await page.keyboard.press("Escape");
      await expect(edit).toBeFocused();
      if (writes !== 1) throw Error("Duplicate settings write");
    },
  );
  await check("product create unknown checks inventory", async (page) => {
    let writes = 0,
      reads = 0,
      draft;
    await page.route("**/api/admin/**", async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.endsWith("/parse-title"))
        return r.fulfill({ json: { brand: { id: "brand", label: "Fixture" } } });
      if (!u.pathname.endsWith("/products")) return r.fulfill({ json: { models: [] } });
      if (r.request().method() === "POST") {
        writes++;
        draft = r.request().postDataJSON();
        return r.abort();
      }
      reads++;
      const rows =
        reads === 1
          ? []
          : olderInventoryRecord({
              id: "new-product",
              name: draft.name,
              archived_at: null,
              variants:
                reads === 2 ? [...draft.variants, { sku: "extra" }] : draft.variants,
            });
      return r.fulfill({ json: inventoryRead(u.searchParams, rows) });
    });
    await openUxHarness(page, bundle, "https://ux.test/product");
    await page.getByLabel(/Full Title/).fill("Fixture product");
    await expect(page.getByText("Fixture", { exact: true }).first()).toBeVisible();
    await page.getByLabel(/Sale Price/).fill("15");
    await page.getByRole("button", { name: "Create Product" }).click();
    const check = page.getByRole("button", { name: "Check inventory", exact: true });
    await expect(page.locator("[data-admin-form] > [inert]")).toHaveCount(4);
    await expect(page.locator("input[type=file]")).toBeDisabled();
    await check.click();
    await expect(page.getByText(/still unconfirmed/)).toBeVisible();
    await check.click();
    await expect.poll(() => reads).toBe(2);
    await expect(page.getByText(/still unconfirmed/)).toBeVisible();
    await expect(check).toBeEnabled();
    expect(await page.evaluate(() => window.fixtureNavigation)).toBeUndefined();
    await check.click();
    await expect
      .poll(() => page.evaluate(() => window.fixtureNavigation))
      .toBe("/admin/inventory/new-product/edit");
    if (reads !== 3 || writes !== 1)
      throw Error("Expected three exact reads and one create");
  });
  await check("switching transaction tabs discards late rows", async (page) => {
    const gate = deferred();
    let pending = false;
    await page.route("**/api/admin/orders?**", async (r) => {
      const u = new URL(r.request().url());
      if (u.searchParams.get("limit") === "1")
        return r.fulfill({ json: { count: 1, orders: [] } });
      const failed = u.searchParams.get("status") === "failed";
      if (!failed) {
        pending = true;
        await gate.promise;
      }
      await r
        .fulfill({
          json: {
            count: 1,
            orders: [
              {
                id: failed ? "failed-order" : "old-id",
                status: failed ? "failed" : "paid",
                items: [],
                total: 3,
              },
            ],
          },
        })
        .catch(() => {});
    });
    await openUxHarness(page, bundle, "https://ux.test/transactions");
    await expect.poll(() => pending).toBe(true);
    await page.getByRole("button", { name: /^Failed/ }).click();
    await expect(
      page.getByRole("link", { name: "View transaction failed-order" }),
    ).toBeVisible();
    gate.release();
    await expect(page.getByRole("link", { name: "View transaction old-id" })).toHaveCount(
      0,
    );
  });
  await check("tag modes and candidate commands", async (page) => {
    let count = 0,
      gate = deferred();
    const brand = { id: "brand-a", canonical_label: "Existing", is_active: true };
    const model = {
      id: "model-a",
      canonical_label: "Model",
      brand_id: brand.id,
      is_active: true,
    };
    await page.route("**/api/admin/tags/**", async (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() !== "GET") {
        count++;
        await gate.promise;
        return r.fulfill({ json: { success: true } });
      }
      const key = u.pathname.split("/").pop();
      const values = {
        brands: [brand],
        models: [model],
        aliases: [],
        sizes: [],
        candidates: [{ id: "candidate-a", entity_type: "brand", raw_text: "Candidate" }],
      };
      return r.fulfill({ json: { [key]: values[key] } });
    });
    await openUxHarness(page, bundle, "https://ux.test/tags");
    await expect(page.getByText("Existing")).toBeVisible();
    async function submit(name) {
      const before = count;
      gate = deferred();
      await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
      await page.getByRole("button", { name, exact: true }).evaluate((el) => {
        el.click();
        el.click();
      });
      try {
        await expect(page.getByRole("status")).toContainText("Saving tag");
      } finally {
        gate.release();
      }
      await expect(
        page.getByRole("status").filter({ hasText: "Tag saved." }),
      ).toBeVisible();
      await expect(page.getByText("Loading tags…", { exact: true })).toHaveCount(0);
      await expect.poll(() => count).toBe(before + 1);
    }
    await submit("Active");
    for (const tab of ["Models", "Aliases", "Sizes"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await page.getByLabel("New tag label").fill("Fixture " + tab);
      if (tab === "Models")
        await page.getByLabel("Brand", { exact: true }).selectOption(brand.id);
      if (tab === "Aliases") await page.getByLabel("Alias target").selectOption(brand.id);
      await submit("Add");
    }
    await page.getByRole("button", { name: "Candidates" }).click();
    await submit("Accept");
    await submit("Reject");
  });
  await check("featured keyboard reorder and remove", async (page) => {
    const items = ["First", "Second"].map((name, i) => ({
      id: "i" + i,
      product_id: "p" + i,
      sort_order: i,
      product: { id: "p" + i, name, category: "sneakers", images: [], variants: [] },
    }));
    let gate = deferred(),
      writes = 0;
    await page.route("**/api/admin/featured-items**", async (r) => {
      if (r.request().method() === "GET") return r.fulfill({ json: { items } });
      writes++;
      await gate.promise;
      return r.fulfill({ json: { success: true } });
    });
    await openUxHarness(page, bundle, "https://ux.test/featured");
    await page.getByRole("button", { name: "Move Second up" }).press("Enter");
    try {
      await expect(page.getByRole("status")).toContainText(/Saving order/);
    } finally {
      gate.release();
    }
    await expect(page.getByText("Order updated successfully")).toBeVisible();
    gate = deferred();
    await page
      .getByRole("button", { name: "Remove from featured" })
      .first()
      .evaluate((el) => {
        el.click();
        el.click();
      });
    try {
      await expect(page.getByText(/Removing featured item/)).toBeVisible();
    } finally {
      gate.release();
    }
    await expect(page.getByText("Product removed from featured items")).toBeVisible();
    if (writes !== 2) throw Error("Duplicate reorder/remove");
  });
  await check("review audit availability and unresolved resend", async (page) => {
    let reads = 0,
      writes = 0;
    const log = (id, status, day) => ({
      id,
      email_type: "order_confirmation",
      sent_at: "2026-11-" + day,
      delivery_status: status,
    });
    await page.route("**/api/admin/**", async (r) => {
      if (r.request().method() === "POST") {
        writes++;
        return r.abort();
      }
      reads++;
      return r.fulfill({
        json: {
          order: {
            id: "fixture-order",
            status: "paid",
            fulfillment: "pickup",
            items: [],
            total: 10,
          },
          emailLogsAvailable: reads !== 3,
          emailLogs:
            reads === 3
              ? []
              : reads === 1
                ? [log("old", "sent", "01")]
                : [
                    log("old", "sent", "01"),
                    log("different", reads === 2 ? "pending" : "sent", "02"),
                  ],
        },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/detail");
    const resend = page.getByRole("button", { name: "Resend", exact: true });
    await resend.click();
    await expect.poll(() => reads).toBe(2);
    await expect(resend).toBeDisabled();
    await expect(page.getByRole("button", { name: /resolve email check/i })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Check email log" }).first().click();
    await expect(page.getByText(/email history unavailable/i)).toBeVisible();
    await expect(page.getByText("Not sent")).toHaveCount(0);
    await page.getByRole("button", { name: "Check email log" }).first().click();
    await expect(resend).toBeDisabled();
    await page.getByRole("checkbox", { name: /verified.*email provider/i }).check();
    await page.getByRole("button", { name: "Resolve email check" }).click();
    await expect(resend).toBeEnabled();
    if (writes !== 1) throw Error("Resolution sent email");
  });
  for (const code of [
    "shipping_order_not_fulfillment_ready",
    "shipping_label_already_purchased",
    "shipping_label_purchased_without_tracking",
    "storage unavailable",
    "storage discarded",
    "storage quota",
    "storage unknown transition",
    "interrupted",
  ]) {
    await check("review label " + code, async (page) => {
      if (code.startsWith("storage ")) {
        await page.addInitScript((mode) => {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith("admin-check:label:")) {
              if (mode === "storage discarded") return;
              if (
                mode === "storage unavailable" ||
                (mode === "storage quota" && value.length > 7) ||
                (mode === "storage unknown transition" && this.getItem(key) !== null)
              )
                throw new DOMException("Storage unavailable", "QuotaExceededError");
            }
            return original.call(this, key, value);
          };
        }, code);
      }
      let writes = 0,
        checks = 0;
      await page.route("**/api/admin/**", async (r) => {
        const url = new URL(r.request().url());
        if (url.pathname.endsWith("/rates"))
          return r.fulfill({
            json: {
              shipment: {
                id: "s",
                rates: [{ id: "r", carrier: "UPS", service: "Ground", rate: "5" }],
              },
            },
          });
        if (r.request().method() === "GET") {
          checks++;
          return r.fulfill({
            json: {
              order: {
                id: "fixture-order",
                tracking_number:
                  code === "shipping_label_already_purchased" ? "tracking-fixture" : null,
                fulfillment_status: "unfulfilled",
              },
            },
          });
        }
        writes++;
        if (
          code === "shipping_label_purchased_without_tracking" ||
          code === "storage quota"
        )
          return r.fulfill({
            status: 502,
            json: {
              code: "shipping_label_purchased_without_tracking",
              error:
                "Label purchase succeeded but returned no tracking number. Please contact support.",
              requestId: "fixture-support",
            },
          });
        return code === "interrupted" || code === "storage unknown transition"
          ? r.abort()
          : r.fulfill({
              status: 409,
              json: {
                code,
                error:
                  code === "shipping_order_not_fulfillment_ready"
                    ? "This order is not paid and ready for shipping."
                    : "A label already exists.",
              },
            });
      });
      await openUxHarness(page, bundle, "https://ux.test/label");
      await page.getByRole("button", { name: /get shipping rates/i }).click();
      const buy = page.getByRole("button", { name: "Purchase shipping label" });
      await buy.click();
      if (code === "storage unavailable" || code === "storage discarded") {
        await expect(page.getByRole("alert")).toContainText(/tab storage/i);
        expect(writes).toBe(0);
        return;
      }
      if (code === "storage quota" || code === "storage unknown transition") {
        for (const reload of [false, true]) {
          if (reload) await openUxHarness(page, bundle, "https://ux.test/label");
          expect(
            await page.evaluate(() =>
              sessionStorage.getItem("admin-check:label:fixture-order"),
            ),
          ).toBe("support");
          await page.getByRole("button", { name: "Check order label" }).click();
          await expect(
            page.getByRole("region", { name: "Label recovery" }).getByRole("status"),
          ).toBeVisible();
          await expect(
            page.getByRole("region", { name: "Label recovery" }),
          ).toContainText(/support/i);
          await expect(
            page.getByRole("checkbox", { name: /verified in Shippo/i }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Resolve label check" }),
          ).toHaveCount(0);
          await expect(buy).toBeDisabled();
        }
      } else if (code === "shipping_order_not_fulfillment_ready") {
        await expect(page.getByRole("alert")).toContainText("not paid");
        await expect(page.getByText(/purchase is unconfirmed/i)).toHaveCount(0);
      } else if (code === "shipping_label_purchased_without_tracking") {
        for (const reload of [false, true]) {
          if (reload) await openUxHarness(page, bundle, "https://ux.test/label");
          await page.getByRole("button", { name: "Check order label" }).click();
          await expect(
            page.getByRole("region", { name: "Label recovery" }),
          ).toContainText(/purchased.*support/i);
          await expect(
            page.getByRole("region", { name: "Label recovery" }),
          ).toContainText("fixture-support");
          await expect(page.getByLabel("Weight (oz)")).toBeDisabled();
          await expect(
            page.getByRole("checkbox", { name: /verified in Shippo/i }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Resolve label check" }),
          ).toHaveCount(0);
          await expect(buy).toBeDisabled();
          await expect(
            page.getByRole("button", { name: /get shipping rates/i }),
          ).toBeDisabled();
        }
      } else {
        await page.getByRole("button", { name: "Check order label" }).click();
        await expect.poll(() => checks).toBe(1);
        await expect(buy).toBeDisabled();
        if (code === "interrupted") {
          await openUxHarness(page, bundle, "https://ux.test/label");
          await page.getByRole("button", { name: "Check order label" }).click();
          await page.getByRole("checkbox", { name: /verified in Shippo/i }).check();
          await page.getByRole("button", { name: "Resolve label check" }).click();
          await expect(
            page.getByRole("button", { name: /get shipping rates/i }),
          ).toBeEnabled();
        } else await expect(page.getByText(/tracking-fixture/)).toBeVisible();
      }
      if (writes !== 1) throw Error("Resolution purchased an additional label");
    });
  }
  await check("review held fulfillment", async (page) => {
    const gate = deferred();
    let writes = 0;
    await page.route("**/api/admin/**", async (r) => {
      const u = new URL(r.request().url());
      if (r.request().method() === "POST") {
        writes++;
        await gate.promise;
        return r.fulfill({ json: { order: { id: "fixture-order" } } });
      }
      if (!u.pathname.endsWith("/orders"))
        return r.fulfill({ json: { origin: null, defaults: [] } });
      if (writes) return r.fulfill({ json: { orders: [], count: 0 } });
      return r.fulfill({
        json: {
          orders: [
            {
              id: "fixture-order",
              status: "paid",
              fulfillment_status: "ready_to_ship",
              items: [],
              created_at: "2026-11-01",
            },
          ],
          count: 1,
        },
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openUxHarness(page, bundle, "https://ux.test/shipping");
    await page.getByRole("button", { name: /Need to Ship/ }).click();
    const mark = page.getByRole("button", { name: "Mark shipped", exact: true }).first();
    await mark.click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(mark).toBeFocused();
    await mark.click();
    await dialog.getByRole("button", { name: "Mark shipped anyway" }).evaluate((el) => {
      el.click();
      el.click();
    });
    try {
      for (const btn of await dialog.getByRole("button").all())
        await expect(btn).toBeDisabled();
      const heading = dialog.getByRole("heading");
      await expect(heading).toBeFocused();
      for (const key of ["Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        await expect(heading).toBeFocused();
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
    } finally {
      gate.release();
    }
    await expect(dialog).toHaveCount(0);
    await expect(mark).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Need to Ship/ })).toBeFocused();
    if (writes !== 1) throw Error("Duplicate fulfillment");
  });
  await check("review unreadable delete", async (page) => {
    let deletes = 0,
      reads = 0;
    page.on("dialog", (d) => d.accept());
    await page.route("**/api/admin/products**", async (r) => {
      if (r.request().method() === "DELETE") {
        deletes++;
        return r.fulfill({ status: 200, body: "{" });
      }
      reads++;
      if (reads === 1)
        return r.fulfill({ status: 503, json: { error: "read unavailable" } });
      const rows = olderInventoryRecord({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Fixture shoe",
        archived_at: "2026-11-01",
        variants: [],
      });
      return r.fulfill({
        json: inventoryRead(new URL(r.request().url()).searchParams, rows),
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/inventory");
    await page.getByRole("button", { name: "Delete product" }).click();
    await expect(page.getByRole("button", { name: "Delete product" })).toBeDisabled();
    await page.getByRole("button", { name: "Check inventory" }).click();
    await expect(page.getByRole("status").filter({ hasText: /archived/i })).toBeVisible();
    await expect(page.getByText("Fixture shoe deleted.")).toHaveCount(0);
    if (reads !== 2 || deletes !== 1)
      throw Error("Delete reconciliation did not use GET");
  });
  await check("review model options follow current brand", async (page) => {
    const gate = deferred();
    await page.route("**/api/admin/**", async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.endsWith("parse-title"))
        return r.fulfill({ json: { brand: { id: "brand", label: "Fixture" } } });
      if (u.searchParams.get("brandId") === "other") {
        await gate.promise;
        return r.fulfill({ status: 503, json: {} });
      }
      return r.fulfill({
        json: { models: [{ id: "model1", canonical_label: "Old model" }] },
      });
    });
    await openUxHarness(page, bundle, "https://ux.test/product");
    const brand = page.getByLabel("Override Brand");
    await brand.fill("Fixture");
    await expect(page.locator('datalist option[value="Old model"]')).toHaveCount(1);
    await brand.fill("Other");
    try {
      await expect(page.locator('datalist option[value="Old model"]')).toHaveCount(0);
    } finally {
      gate.release();
    }
    await expect(
      page.getByText("Tag options unavailable.", { exact: false }),
    ).toBeVisible();
  });

  await check("review clearing held or failed title parsing", async (page) => {
    const gate = deferred();
    let parses = 0;
    await page.route("**/api/admin/**", async (r) => {
      if (!r.request().url().endsWith("parse-title"))
        return r.fulfill({ json: { models: [] } });
      parses++;
      if (parses === 1) await gate.promise;
      await r.fulfill({ status: 503, json: {} }).catch(() => {});
    });
    await openUxHarness(page, bundle, "https://ux.test/product");
    const title = page.getByLabel(/Full Title/);
    await title.fill("Held");
    await expect.poll(() => parses).toBe(1);
    await title.fill("");
    await expect(page.getByText("Parsing...")).toHaveCount(0);
    gate.release();
    await title.fill("Failed");
    await expect(page.getByRole("button", { name: "Retry parsing" })).toBeVisible();
    await title.fill("");
    await expect(page.getByRole("button", { name: "Retry parsing" })).toHaveCount(0);
  });
} finally {
  await browser.close();
}
if (failures.length) throw new Error(failures.join(", "));
