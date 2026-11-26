import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { mountCheckoutBrowser } from "../../../../../../tests/browser/fixtures/checkout-hardening.mjs";
const line = (id, quantity = 1) => ({
  productId: id,
  variantId: id + "-v",
  sizeLabel: "10",
  brand: "Sole",
  name: id,
  titleDisplay: id,
  imageUrl: "/images/logo.png",
  quantity,
  priceCents: 1100,
  maxStock: 7,
});
const repriced = (id) => ({ ...line(id), priceCents: 900 });
const guest = "rdk_cart_session";
const account = (id) => "rdk_cart_user_" + id;

async function open(
  t,
  initial = "a",
  {
    detail = false,
    checkout = false,
    seed = true,
    shared,
    lockMode,
    savedRaw,
    denyRead = false,
    waitReady = true,
  } = {},
) {
  const user = initial ? { id: initial, email: initial + "@fixture.invalid" } : null;
  if (shared) {
    const page = await shared.newPage();
    await page.goto("https://checkout-fixture.invalid/cart");
    await page.waitForFunction(() => window.testCart?.isReady);
    return { page, ctx: shared };
  }
  const config = { initial, lockMode, savedRaw, denyRead };
  const fixture = await mountCheckoutBrowser({
    initialUser: user,
    accountItems: seed ? { a: [line("a")], b: [line("b")] } : {},
    guestItems: seed ? [line("guest")] : [],
    view: detail ? "product" : checkout ? "checkout" : "cart",
    waitReady,
    documentData: config,
    setupDocument: ({ initial, lockMode, savedRaw, denyRead }) => {
      window.requests = [];
      window.nextSession = {
        user: initial ? { id: initial, email: initial + "@fixture.invalid" } : null,
        role: initial ? "customer" : null,
      };
      const currentKey = initial ? "rdk_cart_user_" + initial : "rdk_cart_session";
      if (savedRaw !== undefined)
        (initial ? localStorage : sessionStorage).setItem(currentKey, savedRaw);
      if (denyRead) {
        window.restoreGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === currentKey)
            throw new DOMException("Storage denied", "SecurityError");
          return window.restoreGetItem.call(this, key);
        };
      }
      if (lockMode === "missing")
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value: undefined,
        });
      if (lockMode === "failed")
        navigator.locks.request = () => Promise.reject(Error("blocked"));
      const fetch = window.fetch.bind(window);
      window.fetch = async (path, init) => {
        if (path === "/api/cart/validate")
          return new Promise((resolve, reject) =>
            window.requests.push({ body: JSON.parse(init.body), resolve, reject }),
          );
        if (path === "/api/auth/session") {
          if (window.holdSession)
            await new Promise((resolve) => (window.releaseSession = resolve));
          return Response.json(window.nextSession, {
            status: window.sessionStatus ?? 200,
          });
        }
        return fetch(path, init);
      };
    },
    route: async (route, url) => {
      if (url.pathname === "/api/checkout/quote")
        return route.fulfill({ status: 503, json: { error: "Controlled quote" } });
      throw Error("Unexpected route " + url.pathname);
    },
  });
  t.after(fixture.close);
  return { page: fixture.page, ctx: fixture.context };
}
async function rawTab(ctx) {
  const tab = await ctx.newPage();
  await tab.route("**/basket-raw", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" }),
  );
  await tab.goto("https://checkout-fixture.invalid/basket-raw");
  return tab;
}
async function count(page, n) {
  await expect
    .poll(() => page.evaluate(() => window.requests.length), { timeout: 1800 })
    .toBe(n);
}
async function reply(page, index, items, mode = "ok", removed = []) {
  await page.evaluate(
    async ({ index, items, mode, removed }) => {
      const req = window.requests[index];
      if (mode === "network") req.reject(Error("offline"));
      else
        req.resolve(
          mode === "invalid-json"
            ? new Response("{")
            : Response.json(
                { items, removed },
                { status: mode === "unavailable" ? 503 : 200 },
              ),
        );
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    { index, items, mode, removed },
  );
}
const stored = (page, key) =>
  page.evaluate(
    (k) =>
      JSON.parse((k === "rdk_cart_session" ? sessionStorage : localStorage).getItem(k)),
    key,
  );
async function visible(page, items) {
  await expect
    .poll(
      async () => {
        return page.evaluate(() =>
          window.testCart?.isReady ? window.testCart.items : "checking",
        );
      },
      { timeout: 1800 },
    )
    .toEqual(items);
}
async function switchUser(page, id) {
  await page.evaluate((id) => {
    window.nextSession = {
      user: id ? { id, email: id + "@example.test" } : null,
      role: id ? "customer" : null,
    };
    window.dispatchEvent(new Event("sessionUpdate"));
  }, id);
}
const refresh = (page) =>
  page.evaluate(() => window.dispatchEvent(new Event("openCart")));

for (const action of ["remove", "add", "quantity", "restore"])
  test("late validation after " + action, async (t) => {
    const { page } = await open(t);
    await count(page, 1);
    await page.evaluate(
      async ({ action, added }) => {
        if (action === "remove") await window.testCart.removeItem("a", "a-v");
        if (action === "add") await window.testCart.addItem(added);
        if (action === "quantity" || action === "restore")
          await window.testCart.updateQuantity("a", "a-v", 3);
        if (action === "restore") await window.testCart.updateQuantity("a", "a-v", 1);
      },
      { action, added: line("added") },
    );
    const expected =
      action === "remove"
        ? []
        : action === "add"
          ? [line("a"), line("added")]
          : [line("a", action === "restore" ? 1 : 3)];
    await reply(page, 0, [{ ...line("a"), priceCents: 900 }]);
    await visible(page, expected);
    assert.deepEqual(await stored(page, account("a")), expected);
  });
for (const initial of ["a", null])
  test(
    initial
      ? "account observation supersedes account bootstrap"
      : "delayed_guest_validation_cannot_overwrite_account_after_login",
    async (t) => {
      const { page } = await open(t, initial);
      await count(page, 1);
      await switchUser(page, "b");
      await visible(page, [line("b")]);
      const before = await page.evaluate(() => localStorage.getItem("rdk_cart_user_b"));
      await reply(page, 0, [repriced(initial ?? "guest")]);
      await visible(page, [line("b")]);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("rdk_cart_user_b")),
        before,
      );
      await refresh(page);
      await count(page, 2);
      await reply(page, 1, [repriced("b")]);
      await visible(page, [repriced("b")]);
      assert.deepEqual(await stored(page, initial ? account(initial) : guest), [
        line(initial ?? "guest"),
      ]);
    },
  );
test("new revision validates while prior request is pending and stale finally preserves its guard", async (t) => {
  const { page } = await open(t);
  await count(page, 1);
  await page.evaluate(() => window.testCart.updateQuantity("a", "a-v", 3));
  await refresh(page);
  await count(page, 2);
  await reply(page, 0, [line("a")]);
  await refresh(page);
  await count(page, 2);
  await reply(page, 1, [line("a", 2)]);
  await visible(page, [line("a", 2)]);
});
for (const mode of ["invalid-json", "malformed-line", "unavailable", "network"])
  test(mode + " validation preserves the stored basket", async (t) => {
    const { page } = await open(t);
    await count(page, 1);
    await reply(page, 0, mode === "malformed-line" ? [{}] : [], mode);
    assert.deepEqual(await stored(page, account("a")), [line("a")]);
    await visible(page, [line("a")]);
  });
test("native cross-tab updates and origin clear refresh only the current shared scope", async (t) => {
  const { page, ctx } = await open(t);
  await count(page, 1);
  const other = await rawTab(ctx);
  await other.evaluate(
    ({ key, items }) => localStorage.setItem(key, JSON.stringify(items)),
    { key: account("a"), items: [line("native", 2)] },
  );
  await visible(page, [line("native", 2)]);
  await reply(page, 0, [line("a")]);
  await other.evaluate(() => localStorage.clear());
  await visible(page, []);
  await expect(page.getByText("Your cart is empty")).toBeVisible();
  assert.equal(await stored(page, account("a")), null);
});
test("persisted newer snapshot wins before native change delivery", async (t) => {
  const { page, ctx } = await open(t);
  await count(page, 1);
  await page.evaluate(() =>
    window.addEventListener(
      "storage",
      (e) => {
        e.stopImmediatePropagation();
        window.deferred = true;
      },
      { capture: true, once: true },
    ),
  );
  const other = await rawTab(ctx);
  await other.evaluate(
    ({ key, items }) => localStorage.setItem(key, JSON.stringify(items)),
    { key: account("a"), items: [line("newer")] },
  );
  await page.waitForFunction(() => window.deferred);
  await reply(page, 0, [repriced("a")]);
  assert.deepEqual(await stored(page, account("a")), [line("newer")]);
  await visible(page, [line("newer")]);
});
test("unrelated native account and storage area events leave validation eligible", async (t) => {
  const { page, ctx } = await open(t);
  await count(page, 1);
  await page.evaluate(() => {
    window.seen = [];
    window.addEventListener("storage", (e) =>
      window.seen.push(e.storageArea === sessionStorage ? "session" : "local"),
    );
  });
  const other = await rawTab(ctx);
  await other.evaluate(() => localStorage.setItem("rdk_cart_user_b", "[]"));
  await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.src = "about:blank";
    const loaded = new Promise((r) => (frame.onload = r));
    document.body.append(frame);
    await loaded;
    frame.contentWindow.sessionStorage.setItem("rdk_cart_user_a", "[]");
  });
  await page.waitForFunction(
    () => window.seen.includes("session") && window.seen.includes("local"),
  );
  await reply(page, 0, [repriced("a")]);
  await visible(page, [repriced("a")]);
});
test("guest basket remains tab local across another tab's localStorage clear", async (t) => {
  const { page, ctx } = await open(t, null);
  await count(page, 1);
  const other = await rawTab(ctx);
  await other.evaluate(() => {
    localStorage.clear();
    sessionStorage.setItem("rdk_cart_session", "[]");
  });
  await reply(page, 0, [repriced("guest")]);
  await visible(page, [repriced("guest")]);
});
test("a rejected persistence write does not report a successful product add", async (t) => {
  const { page } = await open(t, null, { detail: true, seed: false });
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error("quota");
    };
  });
  await page.getByRole("button", { name: "Add to Cart" }).click();
  await expect(page.getByText(/could not be added/i)).toBeVisible({
    timeout: 1800,
  });
  await expect(page.getByText("Added to cart.", { exact: true })).toHaveCount(0);
  assert.deepEqual(await stored(page, guest), []);
  assert.equal(await page.evaluate(() => window.fixtureAdded ?? 0), 0);
});
test("an older response arriving last leaves the newer accepted result in place", async (t) => {
  const { page } = await open(t);
  await count(page, 1);
  await page.evaluate(() => window.testCart.updateQuantity("a", "a-v", 3));
  await refresh(page);
  await count(page, 2);
  await reply(page, 1, [line("a", 2)]);
  await reply(page, 0, [line("a", 1)]);
  await visible(page, [line("a", 2)]);
  assert.deepEqual(await stored(page, account("a")), [line("a", 2)]);
});

test("an authoritative empty reply clears the unchanged basket", async (t) => {
  const { page } = await open(t);
  await count(page, 1);
  await reply(page, 0, [], "ok", [
    { productId: "a", variantId: "a-v", reason: "out_of_stock" },
  ]);
  await visible(page, []);
  assert.deepEqual(await stored(page, account("a")), []);
});
// Stop the writing renderer after its final read. The other tab can attempt a real
// Cart operation while the browser still holds the first tab's exclusive lock.
async function pauseBasketRead(page) {
  let resume;
  const reached = page.waitForRequest("**/basket-read-barrier", { timeout: 5000 });
  const gate = new Promise((resolve) => (resume = resolve));
  await page.route("**/basket-read-barrier", async (route) => {
    await gate;
    await route.fulfill({ body: "continue" });
  });
  await page.evaluate(() => {
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      const raw = read.call(this, key);
      if (this === localStorage && key === "rdk_cart_user_a") {
        Storage.prototype.getItem = read;
        const barrier = new XMLHttpRequest();
        barrier.open("GET", "/basket-read-barrier", false);
        barrier.send();
      }
      return raw;
    };
  });
  return { reached, resume };
}
async function waitForQueuedOrCompleted(page) {
  await page.waitForFunction(
    async () => window.completed || (await navigator.locks.query()).pending.length > 0,
    null,
    { timeout: 3000 },
  );
  return page.evaluate(async () => (await navigator.locks.query()).pending.length);
}
for (const first of ["validation", "edit"])
  test("final storage read serializes " + first + " ahead of a second tab", async (t) => {
    const { page, ctx } = await open(t);
    const { page: other } = await open(t, "a", { shared: ctx, seed: false });
    await count(page, 1);
    await count(other, 1);
    const barrier = await pauseBasketRead(page);
    const start = (tab, validation) =>
      tab.evaluate(
        ({ validation, added, refreshed }) => {
          window.completed = false;
          if (validation)
            window.requests[0].resolve(
              Response.json({ items: [refreshed], removed: [] }),
            );
          else
            void Promise.resolve(window.testCart.addItem(added)).then(
              () => (window.completed = true),
            );
        },
        { validation, added: line("added"), refreshed: repriced("a") },
      );
    const firstOperation = start(page, first === "validation");
    let queued;
    try {
      await barrier.reached;
      await start(other, first === "edit");
      if (first === "edit") {
        // A trailing observer lock is granted after the validation commit attempt.
        await other.evaluate(() => {
          setTimeout(
            () =>
              void navigator.locks.request("rdk_cart", () => (window.completed = true)),
            0,
          );
        });
      }
      queued = await waitForQueuedOrCompleted(other);
    } finally {
      barrier.resume();
    }
    await firstOperation;
    const expected = [first === "validation" ? repriced("a") : line("a"), line("added")];
    await visible(page, expected);
    await visible(other, expected);
    assert.ok(
      queued > 0,
      "second operation was queued behind the writer's final storage read",
    );
  });
test("two tabs adding to the same existing line both increment it", async (t) => {
  const { page, ctx } = await open(t);
  const { page: other } = await open(t, "a", { shared: ctx, seed: false });
  const barrier = await pauseBasketRead(page);
  const add = (tab) => tab.evaluate((item) => window.testCart.addItem(item), line("a"));
  const one = add(page);
  let two;
  try {
    await barrier.reached;
    two = other.evaluate((item) => {
      window.completed = false;
      window.result = Promise.resolve(window.testCart.addItem(item)).then((result) => {
        window.completed = true;
        return result;
      });
    }, line("a"));
    await two;
    await waitForQueuedOrCompleted(other);
  } finally {
    barrier.resume();
  }
  assert.deepEqual(await one, { status: "saved" });
  assert.deepEqual(await other.evaluate(() => window.result), { status: "saved" });
  await visible(page, [line("a", 3)]);
  await visible(other, [line("a", 3)]);
});
test("queued old account write cannot execute after switching identity", async (t) => {
  const { page, ctx } = await open(t);
  const { page: other } = await open(t, "a", { shared: ctx, seed: false });
  await other.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((resolve) => (window.releaseLock = resolve)),
    );
  });
  await other.waitForFunction(() => window.releaseLock);
  try {
    await page.evaluate((item) => {
      window.oldWrite = Promise.resolve(window.testCart.addItem(item));
    }, line("late"));
    await switchUser(page, "b");
    await page.waitForFunction(() => window.testCart?.items[0]?.productId !== "a");
  } finally {
    await other.evaluate(() => window.releaseLock());
  }
  await visible(page, [line("b")]);
  assert.deepEqual(await page.evaluate(() => window.oldWrite), { status: "stale" });
  assert.deepEqual(await stored(page, account("a")), [line("a")]);
});
for (const lockMode of ["missing", "failed"])
  test("account with " + lockMode + " lock offers a safe retry", async (t) => {
    const { page } = await open(t, "a", { detail: true, lockMode, waitReady: false });
    const product = page.locator("[data-product-detail]");
    const retry = product.getByRole("button", { name: "Retry cart access" });
    await expect(retry).toBeVisible({ timeout: 1800 });
    assert.equal(
      (await page.evaluate((item) => window.testCart.addItem(item), line("blocked")))
        .status,
      "unavailable",
    );
    assert.deepEqual(await stored(page, account("a")), [line("a")]);
    assert.deepEqual(await stored(page, guest), [line("guest")]);
    await page.evaluate(() => {
      delete navigator.locks?.request;
      delete navigator.locks;
    });
    await retry.click();
    await visible(page, [line("a")]);
    await expect(product.getByRole("button", { name: "Add to Cart" })).toBeEnabled();
  });
test("a cooperating ABA edit invalidates validation before any native storage event reaches the reader", async (t) => {
  const { page, ctx } = await open(t);
  const { page: other } = await open(t, "a", { shared: ctx, seed: false });
  await count(page, 1);
  await page.evaluate(() =>
    window.addEventListener("storage", (e) => e.stopImmediatePropagation(), {
      capture: true,
    }),
  );
  await other.evaluate(async () => {
    await window.testCart.updateQuantity("a", "a-v", 3);
    await window.testCart.updateQuantity("a", "a-v", 1);
  });
  await reply(page, 0, [repriced("a")]);
  await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
  assert.deepEqual(await stored(page, account("a")), [line("a")]);
});
test("a queued validation commit cannot write the account that disconnected", async (t) => {
  const { page, ctx } = await open(t);
  const { page: other } = await open(t, "a", { shared: ctx, seed: false });
  await count(page, 1);
  await other.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((resolve) => (window.releaseLock = resolve)),
    );
  });
  await other.waitForFunction(() => window.releaseLock);
  try {
    await reply(page, 0, [repriced("a")]);
    await page.waitForFunction(
      async () => (await navigator.locks.query()).pending.length > 0,
    );
    await switchUser(page, "b");
    await page.waitForFunction(() => window.testCart?.items[0]?.productId !== "a");
  } finally {
    await other.evaluate(() => window.releaseLock());
  }
  await visible(page, [line("b")]);
  assert.deepEqual(await stored(page, account("a")), [line("a")]);
});
test("a partial revision write fences a stale native-event-deferred validation", async (t) => {
  const { page, ctx } = await open(t);
  const { page: other } = await open(t, "a", { shared: ctx, seed: false });
  await count(page, 1);
  await page.evaluate(() =>
    window.addEventListener("storage", (e) => e.stopImmediatePropagation(), {
      capture: true,
    }),
  );
  assert.equal(
    await other.evaluate(async (item) => {
      const save = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "rdk_cart_user_a") throw Error("storage full");
        return save.call(this, key, value);
      };
      return (await window.testCart.addItem(item)).status;
    }, line("new")),
    "unavailable",
  );
  await expect(other.getByRole("button", { name: "Retry cart access" })).toBeVisible();
  await reply(page, 0, [repriced("a")]);
  await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
  assert.deepEqual(await stored(page, account("a")), [line("a")]);
});
test("delivered raw-only edits which restore the original bytes invalidate the observed request", async (t) => {
  const { page, ctx } = await open(t);
  await count(page, 1);
  const other = await rawTab(ctx);
  await page.evaluate(() => {
    window.rawChanges = 0;
    window.addEventListener("storage", (event) => {
      if (event.key === "rdk_cart_user_a") window.rawChanges++;
    });
  });
  // Prevent the observer from inspecting the intermediate value until both
  // native events were delivered. An older storefront does not write revisions.
  await other.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((resolve) => (window.releaseLock = resolve)),
    );
  });
  await other.waitForFunction(() => window.releaseLock);
  try {
    await other.evaluate(
      ({ key, changed, original }) => {
        localStorage.setItem(key, JSON.stringify(changed));
        localStorage.setItem(key, JSON.stringify(original));
      },
      { key: account("a"), changed: [line("temporary")], original: [line("a")] },
    );
    await page.waitForFunction(() => window.rawChanges === 2);
  } finally {
    await other.evaluate(() => window.releaseLock());
  }
  await reply(page, 0, [repriced("a")]);
  await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
  assert.deepEqual(await stored(page, account("a")), [line("a")]);
});

test("two shoppers' increase buttons on the same account apply both displayed intents", async (t) => {
  const { page, ctx } = await open(t);
  const { page: other } = await open(t, "a", { shared: ctx, seed: false });
  await other.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((resolve) => (window.releaseLock = resolve)),
    );
  });
  await other.waitForFunction(() => window.releaseLock);
  try {
    await page.getByRole("button", { name: "Increase quantity for a" }).click();
    await other.getByRole("button", { name: "Increase quantity for a" }).click();
  } finally {
    await other.evaluate(() => window.releaseLock());
  }
  await visible(page, [line("a", 3)]);
  await visible(other, [line("a", 3)]);
});

test("quantity limits and missing lines report no mutation and preserve the revision", async (t) => {
  const { page } = await open(t);
  const outcomes = await page.evaluate(async (item) => {
    await window.testCart.updateQuantity("a", "a-v", 7);
    const revision = localStorage.getItem("rdk_cart_user_a:revision");
    const results = [
      await window.testCart.updateQuantity("a", "a-v", { adjustBy: 1 }),
      await window.testCart.addItem(item),
      await window.testCart.removeItem("missing", "missing"),
      await window.testCart.updateQuantity("missing", "missing", { adjustBy: 1 }),
    ];
    return {
      results,
      unchanged: revision === localStorage.getItem("rdk_cart_user_a:revision"),
    };
  }, line("a"));
  assert.deepEqual(outcomes, {
    results: Array(4).fill({ status: "stale" }),
    unchanged: true,
  });
  await visible(page, [line("a", 7)]);
});

const oldLine = { ...line("older"), imageUrl: undefined, maxStock: undefined };
for (const initial of ["a", null]) {
  const owner = initial ? "account" : "guest";
  const key = initial ? account(initial) : guest;
  for (const [kind, raw, visibleLines] of [
    ["unreadable JSON", "[", []],
    ["nonarray", JSON.stringify({ saved: true }), []],
    ["null row", "[null]", []],
    [
      "mixed rows",
      JSON.stringify([
        line("retained"),
        null,
        { ...line("bad"), quantity: "2" },
        oldLine,
      ]),
      [line("retained"), { ...line("older"), maxStock: undefined }],
    ],
  ]) {
    test(owner + " recovers " + kind + " saved basket on a deliberate add", async (t) => {
      const { page } = await open(t, initial, {
        savedRaw: raw,
        detail: true,
        waitReady: false,
      });
      const projected = JSON.parse(JSON.stringify(visibleLines));
      await visible(page, projected);
      await refresh(page);
      await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
      const saved = await page.evaluate((k) => {
        const area = k === "rdk_cart_session" ? sessionStorage : localStorage;
        return {
          raw: area.getItem(k),
          revision: area.getItem(k + ":revision"),
          validations: window.requests.length,
        };
      }, key);
      assert.deepEqual(saved, { raw, revision: null, validations: 0 });
      await page.getByRole("button", { name: "Add to Cart", exact: true }).click();
      await expect(page.getByText("Added to cart.", { exact: true })).toBeVisible();
      const storedLines = await stored(page, key);
      assert.deepEqual(storedLines.slice(0, -1), projected);
      assert.equal(storedLines.at(-1).productId, "shoe");
      assert.equal(storedLines.at(-1).quantity, 1);
      await visible(page, storedLines);
    });
  }
  test(owner + " storage read denial still masks and blocks writes", async (t) => {
    const { page } = await open(t, initial, { denyRead: true, waitReady: false });
    const retry = page.getByRole("button", { name: "Retry cart access" }).first();
    await expect(retry).toBeVisible();
    assert.equal(
      (await page.evaluate((item) => window.testCart.addItem(item), line("blocked")))
        .status,
      "unavailable",
    );
    await page.evaluate(() => (Storage.prototype.getItem = window.restoreGetItem));
    assert.deepEqual(await stored(page, key), [line(initial ?? "guest")]);
    await retry.click();
    await visible(page, [line(initial ?? "guest")]);
  });
}

for (const [status, reply, access] of [
  [503, { error: "outage" }, "unavailable"],
  [200, {}, "unavailable"],
  [200, { user: { id: "b" }, role: "customer" }, "unavailable"],
  [403, {}, "denied"],
]) {
  test(
    "session " + status + " " + JSON.stringify(reply) + " masks basket and retries",
    async (t) => {
      const { page } = await open(t);
      await page.evaluate(
        ({ status, reply }) => {
          window.sessionStatus = status;
          window.nextSession = reply;
          document.dispatchEvent(new Event("visibilitychange"));
        },
        { status, reply },
      );
      await expect
        .poll(() => page.evaluate(() => window.testCart.access), { timeout: 1800 })
        .toBe(access);
      assert.deepEqual(await page.evaluate(() => window.testCart.items), []);
      await page.evaluate(() => {
        window.sessionStatus = 200;
        window.nextSession = { user: null, role: null };
      });
      await page.getByRole("button", { name: "Retry cart access" }).click();
      await visible(page, [line("guest")]);
      assert.deepEqual(await stored(page, account("a")), [line("a")]);
    },
  );
}

for (const form of ["password", "otp"])
  test(form + " completion refreshes current observation in both tabs", async (t) => {
    let current = { id: "a", email: "a@fixture.invalid" };
    let hold = false;
    const held = [];
    const { page, context, close } = await mountCheckoutBrowser({
      initialUser: current,
      accountItems: { a: [line("a")], b: [line("b")] },
      sessionRoute: async (route) => {
        if (hold) await new Promise((resolve) => held.push(resolve));
        return route.fulfill({ json: { user: current, role: "customer" } });
      },
      route: async (route, url) => {
        if (url.pathname === "/api/cart/validate")
          return route.fulfill({ status: 503, json: {} });
        if (url.pathname === "/api/auth/otp/request")
          return route.fulfill({ json: { ok: true } });
        assert.ok(["/api/auth/login", "/api/auth/otp/verify"].includes(url.pathname));
        current = { id: "b", email: "b@fixture.invalid" };
        return route.fulfill({ json: { ok: true } });
      },
    });
    t.after(close);
    const other = await context.newPage();
    await other.goto(new URL("/" + form, page.url()).href);
    await other.waitForFunction(() => window.testCart?.isReady);
    await other.evaluate(() => {
      void navigator.locks.request(
        "rdk_cart",
        () => new Promise((resolve) => (window.releaseLock = resolve)),
      );
    });
    await other.waitForFunction(() => window.releaseLock);
    try {
      await page.evaluate((item) => {
        window.queued = Promise.resolve(window.testCart.addItem(item));
      }, line("queued"));
      hold = true;
      await other.locator('input[type="email"]').fill("b@fixture.invalid");
      if (form === "password") {
        await other.getByTestId("login-password").fill("fixture-password");
        await other.getByTestId("login-submit").click();
      } else {
        await other.getByRole("button", { name: "Send code", exact: true }).click();
        const digits = other.locator('input[inputmode="numeric"]');
        await digits.fill("123456");
        await other.getByRole("button", { name: "Sign in", exact: true }).click();
      }
      await expect.poll(() => held.length, { timeout: 2200 }).toBeGreaterThanOrEqual(2);
      assert.deepEqual(await page.evaluate(() => window.testCart.items), []);
      assert.equal(await page.evaluate(() => window.testCart.access), "checking");
    } finally {
      hold = false;
      held.forEach((release) => release());
      await other.evaluate(() => window.releaseLock());
    }
    await visible(page, [line("b")]);
    await visible(other, [line("b")]);
    assert.deepEqual(await page.evaluate(() => window.queued), { status: "stale" });
    assert.deepEqual(await stored(page, account("a")), [line("a")]);
  });
for (const view of ["navbar", "profile"])
  test(
    view + " failed logout remains visible and a confirmed logout selects guest cart",
    async (t) => {
      let current = { id: "a", email: "a@fixture.invalid" },
        reject = true;
      const { page, close } = await mountCheckoutBrowser({
        initialUser: current,
        view,
        guestItems: [line("guest")],
        accountItems: { a: [line("a")] },
        sessionRoute: (route) =>
          route.fulfill({ json: { user: current, role: current ? "customer" : null } }),
        route: async (route, url) => {
          if (url.pathname === "/api/cart/validate")
            return route.fulfill({ status: 503, json: {} });
          if (
            [
              "/api/account/shipping",
              "/api/account/orders",
              "/api/account/addresses",
            ].includes(url.pathname)
          )
            return route.fulfill({ json: {} });
          assert.equal(url.pathname, "/api/auth/logout");
          if (reject) return route.fulfill({ status: 503, json: { ok: false } });
          current = null;
          return route.fulfill({ json: { ok: true } });
        },
      });
      t.after(close);
      const logout = page
        .getByRole("button", {
          name: view === "navbar" ? "Logout" : "Sign out",
          exact: true,
        })
        .first();
      if (view === "navbar") await page.getByRole("button", { name: /account/i }).click();
      await logout.click();
      await expect(page.getByText(/Failed to log out/i)).toBeVisible({ timeout: 1800 });
      assert.deepEqual(await page.evaluate(() => window.testCart.items), [line("a")]);
      reject = false;
      if (!(await logout.isVisible()))
        await page.getByRole("button", { name: /account/i }).click();
      if (view === "navbar") {
        await Promise.all([
          page.waitForURL((url) => url.pathname === "/", { waitUntil: "load" }),
          logout.click(),
        ]);
      } else {
        await logout.click();
      }
      await visible(page, [line("guest")]);
    },
  );

test("legacy image fallback survives a product add and drawer reload", async (t) => {
  const { page } = await open(t, null, { seed: false, detail: true });
  await expect(page.locator("[data-product-detail] img")).toHaveAttribute(
    "data-image-src",
    "/images/logo.png",
  );
  await page.getByRole("button", { name: "Add to Cart", exact: true }).click();
  await expect(page.getByText("Added to cart.", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.fixtureAdded), 1);
  assert.equal((await stored(page, guest))[0].imageUrl, "/images/logo.png");
});
test("retired image fallback renders without changing saved bytes", async (t) => {
  const raw = JSON.stringify([{ ...line("a"), imageUrl: "/placeholder.png" }]);
  const { page } = await open(t, "a", { savedRaw: raw });
  await visible(page, [line("a")]);
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute(
    "data-image-src",
    "/images/logo.png",
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("rdk_cart_user_a")), raw);
});
for (const surface of ["detail", "checkout"])
  test(
    surface + " masks actions during verification and retries unavailable identity",
    async (t) => {
      const { page } = await open(t, "a", { [surface]: true });
      await page.evaluate(() => {
        window.holdSession = true;
        window.nextSession = { user: null, role: null };
        window.dispatchEvent(new Event("sessionUpdate"));
      });
      await expect
        .poll(() => page.evaluate(() => window.testCart.access))
        .toBe("checking");
      if (surface === "detail")
        await expect(
          page.getByRole("button", { name: "Add to Cart", exact: true }),
        ).toBeDisabled();
      assert.deepEqual(await page.evaluate(() => window.testCart.clearCart()), {
        status: "unavailable",
      });
      await page.evaluate(() => {
        window.sessionStatus = 503;
        window.holdSession = false;
        window.releaseSession();
      });
      const retry = page.getByRole("button", { name: "Retry cart access" });
      await expect(retry).toBeVisible();
      await page.evaluate(() => (window.sessionStatus = 200));
      await retry.click();
      await visible(page, [line("guest")]);
    },
  );
test("newer session observation wins when an older reply arrives last", async (t) => {
  const { page } = await open(t);
  await page.evaluate(() => {
    const fetch = window.fetch;
    const responses = [];
    window.fetch = (path, init) =>
      path === "/api/auth/session"
        ? new Promise((resolve) => responses.push(resolve))
        : fetch(path, init);
    window.completeObservation = (i, id) =>
      responses[i](
        Response.json({ user: { id, email: id + "@fixture.invalid" }, role: "customer" }),
      );
    window.dispatchEvent(new Event("sessionUpdate"));
    window.dispatchEvent(new Event("sessionUpdate"));
  });
  await page.evaluate(() => window.completeObservation(1, "b"));
  await visible(page, [line("b")]);
  await page.evaluate(() => window.completeObservation(0, "a"));
  await visible(page, [line("b")]);
});

test("queued mutation notices a new session generation before its native event arrives", async (t) => {
  const { page, ctx } = await open(t);
  const other = await rawTab(ctx);
  await other.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () => new Promise((resolve) => (window.releaseLock = resolve)),
    );
  });
  await other.waitForFunction(() => window.releaseLock);
  try {
    await page.evaluate((item) => {
      // Hold native delivery, keeping the renderer on its first observation.
      window.addEventListener("storage", (event) => event.stopImmediatePropagation(), {
        capture: true,
      });
      window.oldWrite = window.testCart.addItem(item);
      window.nextSession = {
        user: { id: "b", email: "b@fixture.invalid" },
        role: "customer",
      };
    }, line("queued"));
    await page.waitForFunction(
      async () => (await navigator.locks.query()).pending.length > 0,
    );
    await other.evaluate(() =>
      localStorage.setItem("rdk_session_generation", crypto.randomUUID()),
    );
  } finally {
    await other.evaluate(() => window.releaseLock());
  }
  assert.deepEqual(await page.evaluate(() => window.oldWrite), { status: "stale" });
  await visible(page, [line("b")]);
  assert.deepEqual(await stored(page, account("a")), [line("a")]);
});

test("cart reports unreadable saved rows until a deliberate repair", async (t) => {
  const raw = JSON.stringify([null, line("retained")]);
  const { page } = await open(t, "a", { savedRaw: raw });
  const warning = page.getByText(/some saved cart items could not be read/i);
  await expect(warning).toBeVisible({ timeout: 1800 });
  assert.equal(await page.evaluate(() => localStorage.getItem("rdk_cart_user_a")), raw);
  await page.evaluate((item) => window.testCart.addItem(item), line("added"));
  await expect(warning).toHaveCount(0);
  await visible(page, [line("retained"), line("added")]);
});

test("ordinary basket decoder accepts the exact byte and count limits", async (t) => {
  const atSize = JSON.stringify([line("a")]).padEnd(2_000_000, " ");
  const { page } = await open(t, "a", { savedRaw: atSize });
  await visible(page, [line("a")]);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("rdk_cart_user_a").length),
    2_000_000,
  );
  const raw = JSON.stringify(Array(4096).fill(null));
  const other = await rawTab(page.context());
  await other.evaluate((value) => localStorage.setItem("rdk_cart_user_a", value), raw);
  await visible(page, []);
  assert.equal(await page.evaluate(() => window.testCart.access), "ready");
});
for (const [reason, raw] of [
  ["too_many_rows", JSON.stringify(Array(4097).fill(null))],
  ["too_large", JSON.stringify([line("a")]).padEnd(2_000_001, " ")],
]) {
  test(
    "oversized ordinary basket preserves bytes and rejects queued replacement: " + reason,
    async (t) => {
      const { page, ctx } = await open(t);
      const other = await rawTab(ctx);
      await other.evaluate(() => {
        void navigator.locks.request(
          "rdk_cart",
          () => new Promise((resolve) => (window.releaseLock = resolve)),
        );
      });
      await other.waitForFunction(() => window.releaseLock);
      try {
        await page.evaluate(() => {
          window.pendingClear = window.testCart.clearCart();
        });
        await page.waitForFunction(
          async () => (await navigator.locks.query()).pending.length > 0,
        );
        await other.evaluate(
          (value) => localStorage.setItem("rdk_cart_user_a", value),
          raw,
        );
      } finally {
        await other.evaluate(() => window.releaseLock());
      }
      assert.deepEqual(await page.evaluate(() => window.pendingClear), {
        status: "unavailable",
      });
      await expect
        .poll(() => page.evaluate(() => window.testCart.repairReason))
        .toBe(reason);
      await expect(page.getByText(/too large to open/i)).toBeVisible();
      assert.deepEqual(await page.evaluate(() => window.testCart.clearCart()), {
        status: "unavailable",
      });
      assert.ok(
        await page.evaluate(
          (expected) => localStorage.getItem("rdk_cart_user_a") === expected,
          raw,
        ),
      );
      await other.evaluate(
        (items) => localStorage.setItem("rdk_cart_user_a", JSON.stringify(items)),
        [line("repaired")],
      );
      await page.getByRole("button", { name: "Retry cart access" }).click();
      await visible(page, [line("repaired")]);
    },
  );
}

test("unavailable identity offers account retry and masks the signed-out navigation", async (t) => {
  const { page, close } = await mountCheckoutBrowser({
    view: "navbar",
    waitReady: false,
    sessionRoute: (route) => route.fulfill({ status: 503, json: {} }),
  });
  t.after(close);
  await expect(page.getByRole("button", { name: "Retry account access" })).toBeVisible({
    timeout: 1800,
  });
  await expect(page.getByRole("link", { name: "Login", exact: true })).toHaveCount(0);
});
