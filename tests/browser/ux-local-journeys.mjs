import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { measureSurfaces } from "./helpers/measure-local-surfaces.mjs";
import { checkLocalSession, checkLocalLogout } from "./helpers/check-local-session.mjs";
import { checkLocalCatalog } from "./helpers/check-local-catalog.mjs";
import { startLocalAcceptance } from "./helpers/local-next-acceptance.mjs";

const app = await startLocalAcceptance();
const backend = createClient(app.backend, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users = [];
const hydrationProblems = new WeakMap();
let product, browser;
const journal = "test-results/ux-implementation/local-run-" + randomUUID() + ".json";
async function recordOwnership(closed = false) {
  await mkdir("test-results/ux-implementation", { recursive: true });
  await writeFile(
    journal,
    JSON.stringify({
      backend: app.backend,
      appOrigin: app.origin,
      nextPid: app.nextPid,
      proxyPort: app.proxyPort,
      userIds: users,
      productId: product ?? null,
      closed,
    }),
  );
}
function data(result) {
  if (result.error)
    throw Error("Local fixture operation failed: " + result.error.message);
  return result.data;
}
async function createUser(role, tenant) {
  const email = "ux-" + randomUUID() + "@example.test",
    password = randomUUID() + "A!";
  const { user } = data(
    await backend.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  assert.equal(user.email, email);
  users.push(user.id);
  await recordOwnership();
  data(
    await backend
      .from("profiles")
      .upsert({ id: user.id, email, role, tenant_id: tenant }),
  );
  return { id: user.id, email, password };
}
async function post(context, path, body) {
  const response = await context.request.post(app.origin + path, {
    data: body,
    headers: { Origin: app.origin },
  });
  if (!response.ok())
    throw Error(
      path + " returned " + response.status() + ": " + (await response.json()).error,
    );
  return response.json();
}
function totp(uri) {
  const secret = new URL(uri).searchParams.get("secret");
  const bits = [...secret.replace(/=+$/, "")]
    .map((c) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0"),
    )
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const step = Buffer.alloc(8);
  step.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(step).digest();
  return String((h.readUInt32BE(h.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function area(context) {
  await context.route("**/*", (route) => {
    const target = new URL(route.request().url());
    if (target.origin !== app.origin) return route.abort();
    if (
      target.pathname === "/_next/image" &&
      new URL(target.searchParams.get("url") || "/", app.origin).origin !== app.origin
    )
      return route.fulfill({ status: 404, body: "Local fixture image unavailable" });
    return route.continue();
  });
  const page = await context.newPage();
  hydrationProblems.set(page, []);
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      const message = msg
        .text()
        .split("\n")[0]
        .replace(/[\w.+-]+@[\w.-]+/g, "[fixture email]")
        .replace(/https?:\/\/\S+/g, "[URL]")
        .slice(0, 300);
      if (/hydration|tree hydrated/i.test(message))
        hydrationProblems.get(page).push(message);
      console.log("Browser " + msg.type() + ": " + message);
    }
  });
  page.on("pageerror", (error) =>
    console.log(
      "Browser error: " + error.name + " " + error.message.split("\n")[0].slice(0, 200),
    ),
  );
  return page;
}
async function checkSpecialRoutes(shopper) {
  const special = await area(shopper);
  await special.goto(app.origin + "/brands");
  await expect(special.getByRole("main")).toHaveCount(1);
  await expect(special.getByRole("heading", { name: "Brands", exact: true })).toHaveCount(
    1,
  );
  const missing = app.origin + "/store/" + randomUUID();
  await shopper.request.get(missing);
  await special.goto(missing, { waitUntil: "domcontentloaded" });
  await expect(special.getByRole("main")).toHaveCount(1);
  await expect(special.getByRole("heading", { name: /find this page/i })).toBeVisible();
  await special.evaluate(() => {
    sessionStorage.setItem("checkout_idempotency_key", "newer-local-attempt");
    sessionStorage.setItem("rdk_guest_shipping_address_v1", "newer-draft");
  });
  await special.goto(app.origin + "/checkout/cancel");
  await expect(special.getByRole("heading", { name: "Checkout Canceled" })).toBeVisible();
  assert.deepEqual(
    await special.evaluate(() => [
      sessionStorage.getItem("checkout_idempotency_key"),
      sessionStorage.getItem("rdk_guest_shipping_address_v1"),
    ]),
    ["newer-local-attempt", "newer-draft"],
  );
  await special.close();
  console.log(
    "PASS actual missing product and unscoped checkout cancel with newer draft",
  );
}
try {
  await recordOwnership();
  if (process.argv.includes("--special")) {
    browser = await chromium.launch({ channel: "chromium" });
    await checkSpecialRoutes(await browser.newContext());
  } else if (process.argv.includes("--catalog")) {
    browser = await chromium.launch({ channel: "chromium" });
    const page = await area(
      await browser.newContext({ viewport: { width: 390, height: 844 } }),
    );
    await checkLocalCatalog(app, page);
  } else {
    const dummy = randomUUID();
    for (const select of [
      "id,name,archived_at,variants:product_variants(sku)",
      "id,name,archived_at,variants:product_variants(sku),matched:product_variants!inner(sku)",
    ])
      assert.deepEqual(
        data(
          await backend.from("products").select(select).eq("tenant_id", dummy).limit(0),
        ),
        [],
      );
    browser = await chromium.launch({ channel: "chromium" });
    const tenant = data(await backend.from("tenants").select("id").limit(1).single()).id;
    const customer = await createUser("customer", tenant);
    const recovery = await browser.newContext();
    const { properties } = data(
      await backend.auth.admin.generateLink({ type: "recovery", email: customer.email }),
    );
    const verified = await post(recovery, "/api/auth/forgot-password/verify-code", {
      email: customer.email,
      code: properties.email_otp,
    });
    assert.equal(verified.recoveryOwnerId, customer.id);
    customer.password = randomUUID() + "B!";
    assert.equal(
      (
        await post(recovery, "/api/auth/update-password", {
          recoveryOwnerId: verified.recoveryOwnerId,
          password: customer.password,
        })
      ).ok,
      true,
    );
    await recovery.close();
    console.log("PASS actual local recovery OTP, owner DTO and matching password update");
    const staff = await createUser("admin", tenant),
      admin = await browser.newContext();
    assert.equal(
      (
        await post(admin, "/api/auth/login", {
          email: staff.email,
          password: staff.password,
        })
      ).requiresTwoFASetup,
      true,
    );
    const enrolled = await post(admin, "/api/auth/2fa/enroll?skipQR=true", {});
    assert.equal(
      (
        await post(admin, "/api/auth/2fa/verify-enrollment", {
          factorId: enrolled.factorId,
          code: totp(enrolled.uri),
        })
      ).ok,
      true,
    );
    const brand = data(
      await backend.from("tag_brands").select("id").limit(1).single(),
    ).id;
    const sizes = data(
      await backend.from("tag_sizes").select("id").eq("size_type", "shoe").limit(2),
    );
    assert.equal(sizes.length, 2);
    const id = randomUUID(),
      skus = ["UX-A-" + id, "UX-B-" + id];
    data(
      await backend.from("products").insert({
        id,
        name: "UX acceptance sample",
        brand_id: brand,
        category: "sneakers",
        condition: "new",
        size_type: "shoe",
        tenant_id: tenant,
        is_active: true,
      }),
    );
    product = id;
    await recordOwnership();
    data(
      await backend.from("product_variants").insert(
        sizes.map((size, i) => ({
          product_id: id,
          tenant_id: tenant,
          size_id: size.id,
          sku: skus[i],
          sale_price_cents: 5000,
          stock: 1,
        })),
      ),
    );
    for (const archived of [false, true]) {
      if (archived)
        data(
          await backend
            .from("products")
            .update({ archived_at: new Date().toISOString() })
            .eq("id", id),
        );
      for (const query of ["exactId=" + id, ...skus.map((sku) => "exactSku=" + sku)]) {
        const response = await admin.request.get(
          app.origin + "/api/admin/products?" + query,
        );
        assert.equal(response.status(), 200);
        const { product: found } = await response.json();
        assert.equal(found.id, id);
        assert.equal(Boolean(found.archived_at), archived);
        assert.deepEqual(found.variants.map((x) => x.sku).sort(), [...skus].sort());
      }
    }
    console.log(
      "PASS actual local inventory, six active/archived ID and sibling-SKU reads through MFA",
    );
    const shopper = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await area(shopper);
    await page.goto(app.origin + "/auth/login?next=%2Fstore");
    await page.locator("input[type=email]").fill(customer.email);
    await page.locator("input[type=password]").fill(customer.password);
    await page.evaluate(() => {
      window.localUxDocument = true;
    });
    await page.getByTestId("login-submit").click();
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible({
      timeout: 60000,
    });
    assert.equal(await page.evaluate(() => window.localUxDocument), true);
    assert.equal(
      (await (await shopper.request.get(app.origin + "/api/auth/session")).json()).user
        .id,
      customer.id,
    );
    console.log("PASS actual soft login and session header");

    if (process.argv.includes("--logout")) {
      await checkLocalLogout(app, shopper);
    } else {
      const adminPage = await area(admin);
      await adminPage.goto(app.origin + "/admin/inventory/create");
      const title = adminPage.getByLabel(/Full Title/);
      await adminPage
        .locator("label")
        .filter({ hasText: /^Full Title/ })
        .click();
      await expect(title).toBeFocused();
      await title.fill("UX validation sample");
      const brandInput = adminPage.getByLabel("Override Brand");
      const brandOption = await brandInput.evaluate(
        (input) => input.list.options[0].value,
      );
      await brandInput.fill(brandOption);
      const price = adminPage.getByLabel(/Sale Price/).first();
      await adminPage
        .getByRole("button", { name: "Create Product", exact: true })
        .evaluate((button) =>
          button.form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
        );
      await expect(price).toBeFocused();
      await expect(price).toHaveAttribute("aria-invalid", "true");
      assert.deepEqual(hydrationProblems.get(adminPage), []);
      await adminPage.reload();
      console.log(
        "PASS real SSR form label activation, validation focus and clean hydration",
      );
      const directory = "test-results/ux-implementation";
      await mkdir(directory, { recursive: true });
      const measurements = [];
      for (const width of [320, 390, 768, 1440]) {
        for (const [name, p] of [
          ["catalog", page],
          ["product-create", adminPage],
        ]) {
          await p.setViewportSize({ width, height: 900 });
          await p.emulateMedia({ reducedMotion: "reduce" });
          await expect(p.getByRole("main")).toHaveCount(1);
          if (name === "product-create")
            await expect(p.getByLabel(/Full Title/)).toBeVisible();
          else await expect(p.getByRole("heading", { name: "Shop All" })).toBeVisible();
          if (name === "catalog")
            await expect
              .poll(
                () =>
                  p
                    .getByTestId("product-card")
                    .first()
                    .evaluate((card) => {
                      const img = card.querySelector("img");
                      return img
                        ? img.complete && img.naturalWidth > 0
                        : card.textContent.includes("Image unavailable") ||
                            !card.querySelector("[aria-busy=true]");
                    }),
                { timeout: 20000 },
              )
              .toBe(true);
          await p.evaluate(() => document.fonts.ready);
          const portal = p.locator("nextjs-portal");
          await expect(
            portal.getByRole("button", { name: /open.*issues?/i }),
          ).toHaveCount(0);
          await p.screenshot({
            path: directory + "/" + name + "-" + width + ".png",
            style: "nextjs-portal { display:none !important }",
          });
        }
        measurements.push(await measureSurfaces(width, page, adminPage));
      }
      await writeFile(
        directory + "/geometry.json",
        JSON.stringify(measurements, null, 2),
      );
      console.log("PASS rendered customer/admin at 320/390/768/1440 with one main");
      await checkLocalSession(app, shopper, admin, page);
      await checkSpecialRoutes(shopper);
      await page.setViewportSize({ width: 390, height: 844 });
      await checkLocalCatalog(app, page);
      await checkLocalLogout(app, shopper);
    }
  }
} catch (error) {
  // Playwright includes request cookies in its multi-line call log. The first line identifies the failed operation.
  throw Error(String(error).split("\n")[0]);
} finally {
  const cleanup = [];
  const checkAbsent = async (table, column, id) => {
    const result = await backend.from(table).select("id").eq(column, id);
    return {
      error:
        result.error || (result.data?.length ? Error("Disposable row remains") : null),
    };
  };
  if (browser)
    await browser
      .close()
      .catch(() => cleanup.push({ error: Error("Owned browser did not close") }));
  if (product) {
    cleanup.push(
      await backend.from("product_variants").delete().eq("product_id", product),
    );
    cleanup.push(await backend.from("products").delete().eq("id", product));
    cleanup.push(
      await checkAbsent("product_variants", "product_id", product),
      await checkAbsent("products", "id", product),
    );
  }
  for (const id of users) {
    cleanup.push(await backend.auth.admin.deleteUser(id));
    const removed = await backend.auth.admin.getUserById(id);
    cleanup.push({
      error:
        removed.error?.code === "user_not_found" || removed.error?.status === 404
          ? null
          : Error("Disposable account deletion was not confirmed"),
    });
    cleanup.push(await checkAbsent("profiles", "id", id));
  }
  await app.close();
  assert.ok(
    cleanup.every((r) => !r.error),
    "Exact-ID fixture cleanup failed",
  );
  if (product && users.length) {
    await mkdir("test-results/ux-implementation", { recursive: true });
    await writeFile(
      "test-results/ux-implementation/local-fixture-cleanup.json",
      JSON.stringify(
        {
          backend: app.backend,
          productId: product,
          userIds: users,
          productsRemaining: 0,
          variantsRemainingForProduct: 0,
          profilesRemainingForUsers: 0,
          accountsRemaining: 0,
          ownedNextAndBrowserClosed: true,
        },
        null,
        2,
      ),
    );
  }
  await recordOwnership(true);
  console.log("Cleaned local acceptance accounts, fixture rows and server");
}
