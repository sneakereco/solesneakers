// Actual Next app. Auth and address-provider fixtures are explicit; database mode uses real claim/admin HTTP and PostgreSQL transactions.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
import {
  startBrowserTestApp,
  stopBrowserTestApp,
  seedBrowserPrize,
  readBrowserRunState,
  addFixtureBrowserCookies,
  fixtureEligibilityResponse,
} from "./fixtures/specialty-claims.mjs";
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const split = arg.indexOf("=");
    return [arg.slice(2, split), arg.slice(split + 1)];
  }),
);
const mode = args.get("mode") ?? "mocked",
  origin = args.get("base-url") ?? "http://localhost:3000";
assert.ok(["mocked", "database"].includes(mode));
let browser,
  app,
  stage = "setup";
let enteredPrivateFields = false;
const handles = {
  winner: "@Sole.Test",
  addressDuplicate: "different.handle",
  loser: "another.winner",
};
const address = {
  line1: "123 MAIN ST",
  line2: "APT 4",
  city: "COLUMBIA",
  state: "SC",
  postalCode: "29201",
  country: "US",
};
const paths = [];
const publicResponses = [],
  pages = [],
  publicErrors = [];
async function customerPage(role = "guest", viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.25" },
  });
  const browserId = await addFixtureBrowserCookies(context, role);
  const page = await context.newPage();
  pages.push(page);
  page.on("pageerror", (error) => {
    if (!enteredPrivateFields) publicErrors.push(String(error.message).split("\n")[0]);
  });
  page.on("response", async (response) => {
    const path = new URL(response.url()).pathname;
    if (!["/api/featured-items", "/api/specialty/discovery"].includes(path)) return;
    const record = { path, status: response.status() };
    publicResponses.push(record);
    try {
      const data = await response.json();
      record.itemCount = (data.featured ?? data.products ?? []).length;
    } catch {
      record.unreadable = true;
    }
  });
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  await page.route("**/api/specialty/eligibility", async (route) => {
    const response = await fixtureEligibilityResponse(
      route.request().postDataJSON(),
      browserId,
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    paths.push(url.pathname);
    for (const key of ["recoverySecret", "validationToken", "instagramHandle", "address"])
      assert.equal(url.searchParams.has(key), false);
  });
  return { context, page };
}
async function fill(page, handle = handles.winner, values = address) {
  enteredPrivateFields = true;
  await page.getByLabel("Instagram handle", { exact: true }).fill(handle);
  await page.getByLabel("Street address", { exact: true }).fill(values.line1);
  await page
    .getByLabel("Apartment / unit (optional)", { exact: true })
    .fill(values.line2 ?? "");
  await page.getByLabel("City", { exact: true }).fill(values.city);
  await page.getByLabel("State", { exact: true }).fill(values.state);
  await page.getByLabel("ZIP code", { exact: true }).fill(values.postalCode);
}
async function openPrize(page, productId) {
  const response = await page.goto(origin + "/store/" + productId);
  publicResponses.push({ path: "/store/product", status: response.status() });
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Instagram handle", { exact: true }),
  ).toBeVisible();
}
async function postResponseJSON(route, result) {
  await route.fulfill({
    json: { result, replayed: false },
    headers: { "Cache-Control": "private, no-store" },
  });
}
try {
  app = await startBrowserTestApp(origin);
  browser = await chromium.launch({ headless: true });
  const guest = await customerPage();
  stage = "discovery";
  await guest.page.goto(origin + "/store");
  stage = "discovery: Shop All prize";
  await expect(guest.page.getByTestId("specialty-product-card")).toHaveCount(1);
  stage = "discovery: ordinary count";
  await expect(guest.page.getByTestId("product-card")).toHaveCount(2);
  const gridOrder = () =>
    guest.page.getByTestId("product-grid").evaluate((node) =>
      Array.from(node.children)
        .map(
          (child) =>
            child.getAttribute("data-product-id") ??
            child.querySelector("[data-product-id]")?.getAttribute("data-product-id"),
        )
        .filter(Boolean),
    );
  const beforeOrder = await gridOrder();
  await guest.page.setViewportSize({ width: 800, height: 900 });
  assert.deepEqual(
    await gridOrder(),
    beforeOrder,
    "rerendering preserves the prize position and ordinary order",
  );
  const homeResponse = await guest.page.goto(origin + "/");
  publicResponses.push({ path: "/", status: homeResponse.status() });
  stage = "discovery: first homepage section";
  await expect(
    guest.page
      .getByRole("region", { name: "Featured products", exact: true })
      .getByTestId("specialty-product-card"),
  ).toHaveCount(1);
  await expect(
    guest.page
      .getByRole("region", { name: "Clothing products", exact: true })
      .getByTestId("specialty-product-card"),
  ).toHaveCount(0);
  await expect(guest.page.getByTestId("specialty-product-card")).toHaveCount(1);
  for (const query of [
    "q=Browser",
    "category=clothing",
    "condition=new",
    "priceMin=0",
    "priceMax=10000",
    "brandIds=" + app.brandId,
    "sizeIds=" + app.ordinary[0].sizeId,
    "modelIds=" + randomUUID(),
  ]) {
    stage = "discovery: active filter exclusion";
    await guest.page.goto(origin + "/store?" + query);
    await expect(
      guest.page
        .getByTestId("product-grid")
        .or(guest.page.getByRole("heading", { name: "No products found" })),
    ).toBeVisible();
    await expect(guest.page.getByTestId("specialty-product-card")).toHaveCount(0);
  }
  await guest.page.goto(origin + "/store?view=list&sort=price_asc");
  await expect(guest.page.getByTestId("specialty-product-card")).toHaveCount(1);
  const publicPool = await guest.context.request.get(origin + "/api/specialty/discovery");
  stage = "private proxy cache policy";
  assert.equal(
    publicPool.headers()["cache-control"],
    "public, max-age=0, s-maxage=5, must-revalidate",
  );
  const anonymousAdmin = await guest.context.request.get(
    origin + "/api/admin/specialty/claims",
  );
  assert.equal(anonymousAdmin.status(), 401);
  assert.match(anonymousAdmin.headers()["cache-control"] ?? "", /no-store/);

  stage = "claim form";
  const loser = await customerPage();
  await loser.page.goto(origin + "/store/" + app.probe.productId); // Keep a legitimately stale card alive before the win.
  await openPrize(guest.page, app.probe.productId);
  await expect(
    guest.page
      .getByRole("dialog")
      .getByLabel(/card number|email|phone|pickup|shipping method/i),
  ).toHaveCount(0);
  assert.deepEqual(await readBrowserRunState(app.runId), {
    winningClaims: 0,
    remainingStock: 1,
    ordinaryPrizeOrderItems: 0,
  });
  assert.equal(
    (
      await app.db.query(
        "select count(*)::int n from public.inventory_reservations where variant_id=$1",
        [app.probe.variantId],
      )
    ).rows[0].n,
    0,
  );
  let wonReceipt = null,
    dropped = false;
  await guest.page.route("**/api/specialty/claims", async (route) => {
    if (mode === "mocked") {
      wonReceipt = {
        claimId: randomUUID(),
        productId: app.probe.productId,
        productName: "Browser specialty prize",
        instagramHandle: "sole.test",
        instructions:
          "Keep this confirmation. The reseller will contact you on Instagram.",
        acceptedAt: new Date().toISOString(),
        decisionOrdinal: 1,
      };
      return postResponseJSON(route, { status: "won", receipt: wonReceipt });
    }
    const backend = await route.fetch();
    assert.equal(
      backend.status(),
      200,
      "real claim route must accept a prepared valid request",
    );
    const body = await backend.json();
    assert.equal(body.result.status, "won");
    wonReceipt = body.result.receipt;
    assert.deepEqual(await readBrowserRunState(app.runId), {
      winningClaims: 1,
      remainingStock: 0,
      ordinaryPrizeOrderItems: 0,
    });
    dropped = true;
    await route.abort("failed"); // The transaction is already committed. Only its browser response is lost.
  });
  await fill(guest.page);
  await guest.page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await expect(guest.page.getByRole("heading", { name: "You claimed it!" })).toBeVisible({
    timeout: 30000,
  });
  assert.ok(wonReceipt);
  const savedKeys = await guest.page.evaluate(() =>
    Object.keys(
      JSON.parse(sessionStorage.getItem("sole:specialty:attempts:v1"))[0],
    ).sort(),
  );
  assert.deepEqual(savedKeys, ["attemptId", "productId", "recoverySecret"]);
  assert.equal(
    await guest.page.evaluate(
      (id) =>
        JSON.parse(sessionStorage.getItem("rdk_cart_session") ?? "[]").filter(
          (item) => item.productId === id,
        ).length,
      app.probe.productId,
    ),
    0,
  );
  if (mode === "mocked") {
    assert.deepEqual(await readBrowserRunState(app.runId), {
      winningClaims: 0,
      remainingStock: 1,
      ordinaryPrizeOrderItems: 0,
    });
    console.log(
      "PASS: actual Next discovery/filter/form UI with fabricated award response; no database award claimed (mocked mode)",
    );
  } else {
    stage = "lost response and loser";
    assert.equal(dropped, true);
    await loser.page.getByRole("button", { name: "Claim", exact: true }).click();
    await fill(loser.page, handles.loser, {
      ...address,
      line1: "900 DIFFERENT AVE",
      line2: null,
    });
    await loser.page.getByRole("button", { name: "Submit claim", exact: true }).click();
    await expect(
      loser.page.getByText("Unfortunately, someone else claimed this item before you.", {
        exact: true,
      }),
    ).toBeVisible();
    await guest.page.goto(origin + "/store");
    await expect(guest.page.getByTestId("specialty-product-card")).toHaveCount(0);
    await guest.page
      .getByText("Check your giveaway claim results", { exact: true })
      .click();
    const beforeRecovery = paths.length;
    await guest.page
      .getByRole("button", { name: "Check claim result", exact: true })
      .click();
    await expect(
      guest.page.getByRole("heading", { name: "You claimed it!" }),
    ).toBeVisible();
    assert.ok(paths.slice(beforeRecovery).includes("/api/specialty/claims/result"));

    stage = "staff follow-up and campaign close";
    const admin = await customerPage("admin", { width: 1280, height: 900 });
    await admin.page.goto(origin + "/admin/specialty-claims");
    const row = admin.page.locator("[data-specialty-claim='" + wonReceipt.claimId + "']");
    await expect(row).toBeVisible();
    await row.getByRole("combobox").selectOption("contacted");
    await expect(row.getByRole("combobox")).toHaveValue("contacted");
    await expect
      .poll(
        async () =>
          (
            await app.db.query(
              "select count(*)::int n from public.specialty_claim_status_audit where claim_id=$1",
              [wonReceipt.claimId],
            )
          ).rows[0].n,
      )
      .toBe(1);
    stage = "staff: close campaign";
    await admin.page.getByRole("switch", { name: "Giveaway claims enabled" }).click();
    await expect(admin.page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    stage = "recovery after campaign close";
    await guest.page.keyboard.press("Escape");
    await expect(guest.page.getByRole("dialog")).toHaveCount(0);
    await guest.page
      .getByRole("button", { name: "Check claim result", exact: true })
      .click();
    await expect(
      guest.page.getByRole("heading", { name: "You claimed it!" }),
    ).toBeVisible();
    assert.deepEqual(await readBrowserRunState(app.runId), {
      winningClaims: 1,
      remainingStock: 0,
      ordinaryPrizeOrderItems: 0,
    });
    const addressPrize = await seedBrowserPrize(randomUUID(), 1),
      instagramPrize = await seedBrowserPrize(randomUUID(), 1);
    stage = "staff: reopen campaign";
    await admin.page.getByRole("switch", { name: "Giveaway claims enabled" }).click();
    await expect(admin.page.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    stage = "guest and signed-in campaign-wide identity caps";
    const customer = await customerPage("customer");
    const denied = await customer.context.request.get(
      origin + "/api/admin/specialty/claims",
    );
    assert.equal(denied.status(), 403);
    await openPrize(customer.page, addressPrize.productId);
    await fill(customer.page, handles.addressDuplicate, {
      ...address,
      line1: "123 main street",
      line2: "#4",
      city: "columbia",
      postalCode: "29201-1234",
    });
    await customer.page
      .getByRole("button", { name: "Submit claim", exact: true })
      .click();
    await expect(
      customer.page.getByText(
        "You have already claimed a specialty product in this giveaway.",
        { exact: true },
      ),
    ).toBeVisible();
    const anotherGuest = await customerPage();
    await openPrize(anotherGuest.page, instagramPrize.productId);
    await fill(anotherGuest.page, " @SOLE.TEST ", {
      ...address,
      line1: "901 NEW ST",
      line2: "UNIT 9",
    });
    await anotherGuest.page
      .getByRole("button", { name: "Submit claim", exact: true })
      .click();
    await expect(
      anotherGuest.page.getByText(
        "You have already claimed a specialty product in this giveaway.",
        { exact: true },
      ),
    ).toBeVisible();
    assert.equal(
      (
        await app.db.query(
          "select count(*)::int n from public.specialty_claims where campaign_id=$1",
          [app.campaignId],
        )
      ).rows[0].n,
      1,
    );
    for (const prize of [addressPrize, instagramPrize])
      assert.equal(
        (
          await app.db.query("select stock from public.product_variants where id=$1", [
            prize.variantId,
          ])
        ).rows[0].stock,
        1,
      );

    stage = "ordinary cart and forged specialty line";
    const ordinary = await customerPage();
    await ordinary.page.goto(origin + "/store/" + app.ordinary[0].productId);
    await ordinary.page.getByRole("button", { name: /add to (?:cart|bag)/i }).click();
    await expect
      .poll(async () =>
        ordinary.page.evaluate(
          () => JSON.parse(sessionStorage.getItem("rdk_cart_session") ?? "[]").length,
        ),
      )
      .toBe(1);
    const cartCheck = await ordinary.context.request.post(origin + "/api/cart/validate", {
      headers: { Origin: origin },
      data: {
        items: [
          {
            productId: addressPrize.productId,
            variantId: addressPrize.variantId,
            quantity: 1,
          },
        ],
      },
    });
    assert.equal(cartCheck.status(), 200);
    assert.deepEqual(await cartCheck.json(), {
      items: [],
      removed: [
        {
          productId: addressPrize.productId,
          variantId: addressPrize.variantId,
          reason: "not_found",
        },
      ],
    });
    assert.equal(
      (
        await app.db.query(
          "select count(*)::int n from public.order_items where product_id=any($1::uuid[])",
          [[app.probe.productId, addressPrize.productId, instagramPrize.productId]],
        )
      ).rows[0].n,
      0,
    );
    console.log(
      "PASS: actual Next customer/admin routes, real PostgreSQL win/loss, dropped committed response recovery, cross-product normalized identity caps, guest/customer parity, audited follow-up and ordinary cart (database mode; Auth/address providers are fixtures; BotID uses supported development verdict)",
    );
  }
} catch (error) {
  console.error(
    "FAIL: specialty browser integration at " +
      stage +
      " — " +
      String(error.message).split("\n")[0],
  );
  if (!enteredPrivateFields && pages[0] && app) {
    console.error(String(error.message).split("\n").slice(0, 12).join("\n"));
    const counts = await app.db.query(
      "select count(*)::int total,count(*) filter(where tenant_id is null)::int global from public.featured_items where product_id=any($1::uuid[])",
      [app.ordinary.map((item) => item.productId)],
    );
    const flags = (
      await app.db.query(
        "select p.is_active,p.is_out_of_stock,p.archived_at is null unarchived,p.go_live_at<=now() live,b.is_active brand_active,s.is_active size_active,v.stock from public.products p join public.specialty_product_config c on c.product_id=p.id join public.product_variants v on v.id=c.variant_id join public.tag_brands b on b.id=p.brand_id join public.tag_sizes s on s.id=v.size_id where p.id=$1",
        [app.probe.productId],
      )
    ).rows[0];
    const log = await readFile(join(app.privateDir, "next.log"), "utf8").catch(() => "");
    console.error(
      JSON.stringify({
        publicResponses,
        publicErrors,
        pagePath: new URL(pages[0].url()).pathname,
        pageTitle: await pages[0].title(),
        featuredFixtureCounts: counts.rows[0],
        probeFlags: flags,
        missingBrand: log.includes("missing its brand relation"),
        missingSize: log.includes("missing its size relation"),
        specialtyDomCount: await pages[0].getByTestId("specialty-product-card").count(),
        featuredRegionCount: await pages[0]
          .getByRole("region", { name: "Featured products", exact: true })
          .count(),
        specialtyParents: await pages[0]
          .getByTestId("specialty-product-card")
          .evaluateAll((nodes) =>
            nodes.map(
              (node) => node.closest("[role=region]")?.getAttribute("aria-label") ?? null,
            ),
          ),
      }),
    );
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stopBrowserTestApp();
}
