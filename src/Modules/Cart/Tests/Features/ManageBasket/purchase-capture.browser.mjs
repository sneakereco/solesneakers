import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { mountCheckoutBrowser } from "../../../../../../tests/browser/fixtures/checkout-hardening.mjs";

const sku = "4136eb7d-f6b0-46be-b813-83e3cb33b9cc";
const variant = "2941162b-6859-4a52-a20d-fc56ee63493c";
const item = (quantity) => ({
  productId: sku,
  variantId: variant,
  quantity,
  sizeLabel: "10",
  brand: "Sole",
  name: "Shoe",
  titleDisplay: "Shoe",
  priceCents: 1000,
  imageUrl: "/shoe.jpg",
});
const lines = (quantity) => [{ productId: sku, variantId: variant, quantity }];
async function fixture(t, owner = "a", rows = [item(3)], initialName = "") {
  const initialUser = owner ? { id: owner, email: owner + "@example.test" } : null;
  const { page, context, close } = await mountCheckoutBrowser({
    initialUser,
    accountItems: owner ? { [owner]: rows } : {},
    guestItems: owner ? [] : rows,
    documentData: { initialName },
    setupDocument: ({ initialName }) => {
      if (initialName) window.name = initialName;
      window.addEventListener(
        "storage",
        (event) => {
          if (window.deferStorage) event.stopImmediatePropagation();
        },
        true,
      );
      // Hold catalog replies until the test delivers its response. Authentication still
      // uses the fixture HTTP route and the production session observer.
      const fetch = window.fetch.bind(window);
      window.requests = [];
      window.fetch = (path, init) => {
        if (path === "/api/cart/validate")
          return new Promise((resolve) => {
            window.requests.push({ payload: JSON.parse(init.body), resolve });
          });
        return fetch(path, init);
      };
    },
    async sessionRoute(route) {
      const next = await route
        .request()
        .frame()
        .page()
        .evaluate(() => window.nextUser);
      const user = next === undefined ? initialUser : next;
      return route.fulfill({ json: { user, role: user ? "customer" : null } });
    },
    route: (route) => route.fulfill({ status: 404 }),
  });
  t.after(close);
  const url = page.url();
  const ready = (p) => p.waitForFunction(() => window.testCart?.isReady);
  const open = async () => {
    const p = await context.newPage();
    await p.goto(url);
    await ready(p);
    return p;
  };
  return { page, ctx: context, ready, open, url };
}
const capture = (p, attemptKey, expectedItems, mode = "new") =>
  p.evaluate(
    (args) => window.testCart.captureForCheckout?.(args) ?? { status: "absent" },
    {
      mode,
      attemptKey,
      expectedItems,
    },
  );
const bind = (p, captureId, orderId) =>
  p.evaluate(
    ([id, order]) => window.testCart.bindPreparedOrder(id, order),
    [captureId, orderId],
  );
const consume = (p, orderId, purchased) =>
  p.evaluate(
    ([id, items]) => window.testCart.consumeConfirmedPurchase(id, items),
    [orderId, purchased],
  );
const bytes = (p) =>
  p.evaluate(() =>
    ["rdk_cart_user_a", "rdk_cart_user_a:revision"].map((k) => localStorage.getItem(k)),
  );
const observed = (page, items) =>
  expect
    .poll(async () => await page.evaluate(() => window.testCart.items))
    .toEqual(items);
async function prepared(p, quantity = 3) {
  const attemptKey = randomUUID(),
    orderId = randomUUID();
  const result = await capture(p, attemptKey, lines(quantity));
  assert.equal(result.status, "captured");
  assert.deepEqual(result.items, lines(quantity));
  assert.equal(await bind(p, result.captureId, orderId), true);
  return { attemptKey, orderId, captureId: result.captureId };
}

test("removed and newly allocated units survive partial consumption and exact receipt replay", async (t) => {
  const { page, ready } = await fixture(t);
  const { attemptKey, orderId } = await prepared(page);
  await page.evaluate(
    async ({ sku, variant }) => {
      await window.testCart.updateQuantity(sku, variant, 1);
      await window.testCart.updateQuantity(sku, variant, 3);
    },
    { sku, variant },
  );
  assert.deepEqual(await consume(page, orderId, lines(2)), {
    status: "matched",
    attemptKey,
  });
  await observed(page, [item(2)]);
  const saved = await bytes(page);
  await page.reload();
  await ready(page);
  assert.deepEqual(await consume(page, orderId, lines(2)), {
    status: "matched",
    attemptKey,
  });
  assert.equal((await consume(page, orderId, lines(3))).status, "mismatch");
  assert.deepEqual(await bytes(page), saved);
});
test("identical replacements reject an old rendered capture and protect all new units", async (t) => {
  const { page } = await fixture(t);
  const { attemptKey, orderId, captureId } = await prepared(page);
  await page.evaluate(async (row) => {
    window.oldCapture = window.testCart.captureForCheckout;
    await window.testCart.setCartItems([row]);
  }, item(3));
  const args = { mode: "new", attemptKey: randomUUID(), expectedItems: lines(3) };
  assert.equal(
    (await page.evaluate((args) => oldCapture(args), args)).status,
    "mismatch",
  );
  assert.equal(
    (await capture(page, attemptKey, lines(3), "resume")).captureId,
    captureId,
  );
  const saved = await bytes(page);
  assert.deepEqual(await consume(page, orderId, lines(3)), {
    status: "matched",
    attemptKey,
  });
  assert.deepEqual(await bytes(page), saved);
  assert.equal((await capture(page, randomUUID(), lines(3), "resume")).status, "missing");
});
test("window.open copies guest basket but cannot consume the opener's proof; reload retains proof", async (t) => {
  const { page, ctx, url, ready } = await fixture(t, null);
  const { attemptKey, orderId } = await prepared(page);
  const opened = ctx.waitForEvent("page");
  await page.evaluate(() => {
    window.open("about:blank", "_blank");
  });
  const child = await opened;
  await child.goto(url);
  await ready(child);
  await observed(child, [item(3)]);
  assert.equal((await consume(child, orderId, lines(2))).status, "missing");
  await observed(child, [item(3)]);
  await page.reload();
  await ready(page);
  assert.deepEqual(await consume(page, orderId, lines(2)), {
    status: "matched",
    attemptKey,
  });
  await observed(page, [item(1)]);
  await observed(child, [item(3)]);
});

const proofKey = "rdk_cart_user_a:purchase-v1";
async function failNextWrite(page, stage) {
  await page.evaluate(
    ({ stage, proofKey }) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        const fails =
          key === stage ||
          (key === proofKey && JSON.parse(value).some((r) => r.stage === stage));
        if (fails) {
          Storage.prototype.setItem = original;
          throw new DOMException("injected", "QuotaExceededError");
        }
        original.call(this, key, value);
      };
    },
    { stage, proofKey },
  );
}
async function retry(page) {
  await page.waitForFunction(() => window.testCart.access === "unavailable");
  await page.evaluate(() => window.testCart.retryAccess());
  await page.waitForFunction(() => window.testCart.isReady);
}
test("partial receipt write pins purchased one before basket changes and rejects a different replay", async (t) => {
  const { page } = await fixture(t);
  const { attemptKey, orderId } = await prepared(page);
  await failNextWrite(page, "receipt");
  assert.equal((await consume(page, orderId, lines(1))).status, "unavailable");
  await retry(page);
  await observed(page, [item(2)]);
  const after = await bytes(page);
  assert.equal((await consume(page, orderId, lines(2))).status, "mismatch");
  assert.deepEqual(await bytes(page), after);
  assert.deepEqual(await page.evaluate((row) => window.testCart.addItem(row), item(1)), {
    status: "saved",
  });
  await observed(page, [item(3)]);
  const beforeReplay = await bytes(page);
  assert.deepEqual(await consume(page, orderId, lines(1)), {
    status: "matched",
    attemptKey,
  });
  assert.deepEqual(await bytes(page), beforeReplay);
});
test("failed purchase claim leaves basket and revision untouched", async (t) => {
  const { page } = await fixture(t);
  const { orderId } = await prepared(page);
  const saved = await bytes(page);
  await failNextWrite(page, "applying");
  assert.equal((await consume(page, orderId, lines(1))).status, "unavailable");
  assert.deepEqual(await bytes(page), saved);
  await retry(page);
  assert.equal((await consume(page, orderId, lines(2))).status, "matched");
  await observed(page, [item(1)]);
});
for (const key of ["rdk_cart_user_a", "rdk_cart_user_a:revision"]) {
  test("failed lineage write cannot authorize resumed purchase at " + key, async (t) => {
    const { page } = await fixture(t);
    const attemptKey = randomUUID();
    const saved = await bytes(page);
    await failNextWrite(page, key);
    assert.equal((await capture(page, attemptKey, lines(3))).status, "unavailable");
    const [data, rev] = await bytes(page);
    assert.equal(data, saved[0]);
    assert.equal(rev === saved[1], key.endsWith(":revision"));
    await retry(page);
    assert.equal((await capture(page, attemptKey, lines(3), "resume")).status, "missing");
  });
}
async function holdLock(page) {
  await page.evaluate(() => {
    void navigator.locks.request(
      "rdk_cart",
      () =>
        new Promise((resolve) => {
          window.unlock = resolve;
        }),
    );
  });
  await page.waitForFunction(() => typeof window.unlock === "function");
}
async function queued(page, count) {
  await page.waitForFunction(
    async (n) =>
      (await navigator.locks.query()).pending.filter((l) => l.name === "rdk_cart")
        .length >= n,
    count,
  );
}
for (const otherAction of ["add", "consume"]) {
  test(
    "real account tabs serialize consume with " +
      otherAction +
      " and replay the shared receipt",
    async (t) => {
      const { page, open, ready } = await fixture(t);
      const { attemptKey, orderId } = await prepared(page);
      const other = await open();
      await holdLock(page);
      const first = consume(page, orderId, lines(2));
      await queued(other, 1);
      const second =
        otherAction === "add"
          ? other.evaluate((row) => window.testCart.addItem(row), item(1))
          : consume(other, orderId, lines(2));
      await queued(page, 2);
      await page.evaluate(() => window.unlock());
      assert.deepEqual(await first, { status: "matched", attemptKey });
      assert.deepEqual(
        await second,
        otherAction === "add" ? { status: "saved" } : { status: "matched", attemptKey },
      );
      const expected = [item(otherAction === "add" ? 2 : 1)];
      await observed(page, expected);
      await observed(other, expected);
      const saved = await bytes(other);
      await other.reload();
      await ready(other);
      assert.deepEqual(await consume(other, orderId, lines(2)), {
        status: "matched",
        attemptKey,
      });
      assert.deepEqual(await bytes(other), saved);
    },
  );
}
test("new attempt supersedes only its origin and a stale bind cannot replace another order", async (t) => {
  const { page, open } = await fixture(t);
  const old = await prepared(page);
  // Open the second renderer after legacy rows have acquired their unit lineage.
  const other = await open();
  const independent = await prepared(other),
    active = await prepared(page);
  assert.equal(await bind(page, old.captureId, randomUUID()), false);
  assert.equal(await bind(page, active.captureId, old.orderId), false);
  assert.equal((await capture(page, old.attemptKey, lines(3), "resume")).status, "stale");
  assert.equal((await consume(page, old.orderId, lines(1))).status, "stale");
  assert.deepEqual(await consume(page, independent.orderId, lines(1)), {
    status: "matched",
    attemptKey: independent.attemptKey,
  });
  assert.deepEqual(await consume(other, active.orderId, lines(3)), {
    status: "matched",
    attemptKey: active.attemptKey,
  });
  await observed(page, []);
  await observed(other, []);
});
test("queued bind and status callbacks cannot cross a disconnected account generation", async (t) => {
  const { page, open } = await fixture(t);
  const { orderId } = await prepared(page);
  const other = await open();
  const unbound = await capture(other, randomUUID(), lines(3));
  assert.equal(unbound.status, "captured");
  await holdLock(other);
  const pendingBind = bind(other, unbound.captureId, randomUUID());
  // A live caller signal must still inherit the account connection lifetime.
  const pendingConsume = other.evaluate(
    ({ orderId, purchased }) =>
      window.testCart.consumeConfirmedPurchase(
        orderId,
        purchased,
        new AbortController().signal,
      ),
    { orderId, purchased: lines(3) },
  );
  await queued(page, 2);
  await other.evaluate((row) => {
    localStorage.setItem("rdk_cart_user_b", JSON.stringify([row]));
    window.nextUser = { id: "b", email: "b@example.test" };
    window.dispatchEvent(new Event("sessionUpdate"));
  }, item(7));
  await other.waitForFunction(() => !window.testCart.isReady);
  const whileHeld = await Promise.race([
    Promise.all([pendingBind, pendingConsume]),
    new Promise((resolve) => setTimeout(() => resolve("still queued"), 1000)),
  ]);
  await other.evaluate(() => window.unlock());
  assert.deepEqual(whileHeld, [false, { status: "unavailable" }]);
  await observed(page, [item(3)]);
  await observed(other, [item(7)]);
  assert.equal((await consume(other, orderId, lines(3))).status, "missing");
});
test("guest prepare callback resolved after identity change cannot bind either basket", async (t) => {
  const { page } = await fixture(t, null);
  const result = await capture(page, randomUUID(), lines(3));
  const orderId = randomUUID();
  await page.evaluate((row) => {
    window.bindAfterResponse = window.testCart.bindPreparedOrder;
    localStorage.setItem("rdk_cart_user_b", JSON.stringify([row]));
    window.nextUser = { id: "b", email: "b@example.test" };
    window.dispatchEvent(new Event("sessionUpdate"));
  }, item(7));
  await observed(page, [item(7)]);
  assert.equal(
    await page.evaluate(
      ([id, order]) => window.bindAfterResponse(id, order),
      [result.captureId, orderId],
    ),
    false,
  );
  assert.equal((await consume(page, orderId, lines(3))).status, "missing");
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("rdk_cart_session"))[0].quantity,
    ),
    3,
  );
});
test("catalog shortage retains original units while explicit remove and re-add protects replacement", async (t) => {
  const second = { ...item(1), productId: randomUUID(), variantId: randomUUID() };
  const { page } = await fixture(t, "a", [item(3), second]);
  const basket = [
    ...lines(3),
    { productId: second.productId, variantId: second.variantId, quantity: 1 },
  ];
  const attemptKey = randomUUID(),
    orderId = randomUUID();
  const result = await capture(page, attemptKey, basket);
  assert.equal(await bind(page, result.captureId, orderId), true);
  await page.evaluate(() => window.dispatchEvent(new Event("openCart")));
  await page.waitForFunction(() => window.requests.length === 2);
  assert.deepEqual(await page.evaluate(() => window.requests[1].payload), {
    items: basket,
  });
  const priced = { ...item(2), maxStock: 2, priceCents: 800 };
  await page.evaluate(
    ({ priced, second }) =>
      window.requests[1].resolve(
        Response.json({
          items: [priced],
          removed: [
            {
              productId: second.productId,
              variantId: second.variantId,
              reason: "out_of_stock",
            },
          ],
        }),
      ),
    { priced, second },
  );
  const retained = {
    ...priced,
    quantity: 3,
    availability: "unavailable",
    previousPriceCents: 1000,
  };
  await observed(page, [
    retained,
    { ...second, maxStock: 0, availability: "unavailable" },
  ]);
  await page.evaluate(
    (row) => window.testCart.removeItem(row.productId, row.variantId),
    second,
  );
  await page.evaluate((row) => window.testCart.addItem(row), second);
  assert.deepEqual(await page.evaluate(() => window.fixtureAddedArgs), [
    [second.productId, second.variantId],
  ]);
  assert.deepEqual(await consume(page, orderId, [...lines(1), basket[1]]), {
    status: "matched",
    attemptKey,
  });
  await observed(page, [{ ...retained, quantity: 2 }, second]);
});
test("remove/re-add and clear/re-add with identical values protect new line incarnations", async (t) => {
  const { page } = await fixture(t);
  for (const action of ["remove", "clear"]) {
    const { attemptKey, orderId } = await prepared(page);
    await page.evaluate(
      async ({ action, row }) => {
        if (action === "clear") await window.testCart.clearCart();
        else await window.testCart.removeItem(row.productId, row.variantId);
        await window.testCart.addItem(row);
        await window.testCart.updateQuantity(row.productId, row.variantId, 3);
      },
      { action, row: item(3) },
    );
    const saved = await bytes(page);
    assert.deepEqual(await consume(page, orderId, lines(3)), {
      status: "matched",
      attemptKey,
    });
    assert.deepEqual(await bytes(page), saved);
  }
});
test("invalid purchase subsets preserve every row and allow a later exact authorized subset", async (t) => {
  const { page } = await fixture(t);
  const { orderId } = await prepared(page);
  const saved = await bytes(page);
  for (const wrong of [
    [],
    lines(4),
    lines(0),
    lines(1.2),
    [...lines(1), ...lines(1)],
    [{ ...lines(1)[0], productId: randomUUID() }],
  ]) {
    assert.equal((await consume(page, orderId, wrong)).status, "mismatch");
  }
  assert.deepEqual(await bytes(page), saved);
  assert.equal((await consume(page, orderId, lines(1))).status, "matched");
});
test("one million units retain compact saved proof and public projection", async (t) => {
  const { page } = await fixture(t);
  await page.evaluate(
    ({ sku, variant }) => window.testCart.updateQuantity(sku, variant, 1000000),
    {
      sku,
      variant,
    },
  );
  await observed(page, [item(1000000)]);
  const { orderId } = await prepared(page, 1000000);
  const [raw] = await bytes(page);
  t.diagnostic(
    "million-unit basket bytes " +
      Buffer.byteLength(raw) +
      ", bound proof bytes " +
      (await page.evaluate(
        (k) => new TextEncoder().encode(localStorage.getItem(k)).length,
        proofKey,
      )),
  );
  assert.ok(raw.length < 600);
  assert.ok((await page.evaluate((k) => localStorage.getItem(k).length, proofKey)) < 700);
  assert.equal((await consume(page, orderId, lines(999999))).status, "matched");
  await observed(page, [item(1)]);
});
test("unrelated browsing context name is retained and guest cleanup stays ineligible", async (t) => {
  const { page } = await fixture(t, null, [item(3)], "merchant-frame");
  assert.equal((await capture(page, randomUUID(), lines(3))).status, "unavailable");
  assert.equal(await page.evaluate(() => window.name), "merchant-frame");
  await observed(page, [item(3)]);
});
test("expired and evicted proofs cannot be resumed or authorize receipt cleanup", async (t) => {
  const { page } = await fixture(t);
  const oldest = await prepared(page);
  for (let i = 0; i < 64; i++)
    assert.equal((await capture(page, randomUUID(), lines(3))).status, "captured");
  assert.equal(
    (await capture(page, oldest.attemptKey, lines(3), "resume")).status,
    "missing",
  );
  assert.equal((await consume(page, oldest.orderId, lines(1))).status, "missing");
  const active = await prepared(page);
  await consume(page, active.orderId, lines(1));
  await page.evaluate(() => {
    const now = Date.now();
    Date.now = () => now + 7 * 86400000;
  });
  assert.equal((await consume(page, active.orderId, lines(1))).status, "missing");
  assert.equal(
    (await capture(page, active.attemptKey, lines(2), "resume")).status,
    "missing",
  );
  await observed(page, [item(2)]);
});

test("legacy-writer loss of provenance cannot turn a validation removal into proof of zero survivors", async (t) => {
  const { page, open } = await fixture(t);
  const { orderId, attemptKey } = await prepared(page);
  const other = await open();
  await other.evaluate(
    (row) => localStorage.setItem("rdk_cart_user_a", JSON.stringify([row])),
    { ...item(3), name: "older writer" },
  );
  await observed(page, [{ ...item(3), name: "older writer" }]);
  const n = await page.evaluate(() => window.requests.length);
  await page.evaluate(() => window.dispatchEvent(new Event("openCart")));
  await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
  const next = await page.evaluate(() => window.requests.length);
  if (next > n) {
    await page.evaluate(
      ({ sku, variant }) =>
        window.requests.at(-1).resolve(
          Response.json({
            items: [],
            removed: [{ productId: sku, variantId: variant, reason: "out_of_stock" }],
          }),
        ),
      { sku, variant },
    );
    await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
  }
  assert.equal((await consume(page, orderId, lines(3))).status, "corrupt");
  assert.equal((await capture(page, attemptKey, lines(3), "resume")).status, "corrupt");
  await observed(page, [{ ...item(3), name: "older writer" }]);
});
test("damaged row proof and malformed association cannot authorize cleanup", async (t) => {
  const { page, open } = await fixture(t);
  const { orderId } = await prepared(page);
  const other = await open();
  await other.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem("rdk_cart_user_a"));
    rows[0]._cartUnits.ranges = [["0", "4"]];
    localStorage.setItem("rdk_cart_user_a", JSON.stringify(rows));
  });
  const saved = await bytes(page);
  assert.equal((await consume(page, orderId, lines(1))).status, "corrupt");
  assert.deepEqual(await bytes(page), saved);
  await page.evaluate((k) => localStorage.setItem(k, "{"), proofKey);
  assert.equal((await consume(page, orderId, lines(1))).status, "corrupt");
  assert.deepEqual(await bytes(page), saved);
});

test("a persisted identical replacement invalidates old capture before native storage event delivery", async (t) => {
  const { page, open } = await fixture(t);
  const other = await open();
  await page.evaluate(() => {
    window.deferStorage = true;
    window.captureBeforeReplacement = window.testCart.captureForCheckout;
  });
  const before = await bytes(page);
  assert.deepEqual(
    await other.evaluate((row) => window.testCart.setCartItems([row]), item(3)),
    { status: "saved" },
  );
  const saved = await bytes(page);
  assert.notEqual(saved[1], before[1]);
  const result = await page.evaluate(
    (request) => window.captureBeforeReplacement(request),
    { mode: "new", attemptKey: randomUUID(), expectedItems: lines(3) },
  );
  assert.equal(result.status, "mismatch");
  assert.deepEqual(await bytes(page), saved);
});
test("a corrupt or partially salvageable saved row keeps its original bytes during capture", async (t) => {
  const { page } = await fixture(t, "a", [item(3), null]);
  const saved = await bytes(page);
  assert.equal((await capture(page, randomUUID(), lines(3))).status, "mismatch");
  assert.deepEqual(await bytes(page), saved);
  await observed(page, [item(3)]);
});

async function assertOldProofGone(page, old, quantity) {
  assert.equal(
    (await capture(page, old.attemptKey, lines(quantity), "resume")).status,
    "missing",
  );
  assert.equal(await bind(page, old.captureId, old.orderId), false);
  assert.equal((await consume(page, old.orderId, lines(1))).status, "missing");
}

for (const [damage, edit] of [
  ["null", "add"],
  ["bad endpoint", "quantity"],
]) {
  test(
    "deliberate " +
      edit +
      " repairs " +
      damage +
      " row lineage and resumes stock validation",
    async (t) => {
      const { page, ready } = await fixture(t);
      const old = await prepared(page);
      const oldId = await page.evaluate((damage) => {
        const key = "rdk_cart_user_a",
          rows = JSON.parse(localStorage.getItem(key));
        const oldId = rows[0]._cartUnits.id;
        if (damage === "null") rows[0]._cartUnits = null;
        else rows[0]._cartUnits.ranges[0][1] = "bad";
        localStorage.setItem(key, JSON.stringify(rows));
        return oldId;
      }, damage);
      const damaged = await bytes(page);
      await page.reload();
      await ready(page);
      await observed(page, [item(3)]);
      await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
      assert.equal(await page.evaluate(() => requests.length), 0);
      assert.equal((await consume(page, old.orderId, lines(1))).status, "corrupt");
      assert.deepEqual(await bytes(page), damaged);
      const changed = await page.evaluate(
        ({ edit, row }) =>
          edit === "add"
            ? window.testCart.addItem(row)
            : window.testCart.updateQuantity(row.productId, row.variantId, 4),
        { edit, row: item(3) },
      );
      assert.deepEqual(changed, { status: "saved" });
      await observed(page, [item(4)]);
      const repaired = JSON.parse((await bytes(page))[0])[0]._cartUnits;
      assert.ok(repaired?.id, "the edited line needs a new incarnation");
      assert.notEqual(repaired.id, oldId);
      await assertOldProofGone(page, old, 4);
      await page.evaluate(() => window.dispatchEvent(new Event("openCart")));
      await page.waitForFunction(() => requests.length === 1);
      const priced = { ...item(2), priceCents: 700, maxStock: 2 };
      await page.evaluate(
        (priced) => requests[0].resolve(Response.json({ items: [priced], removed: [] })),
        priced,
      );
      await observed(page, [
        { ...priced, quantity: 4, availability: "unavailable", previousPriceCents: 1000 },
      ]);
      await page.evaluate(
        (row) => window.testCart.updateQuantity(row.productId, row.variantId, 2),
        priced,
      );
      await page.evaluate(() => {
        void window.testCart.recheckAvailability();
      });
      await page.waitForFunction(() => requests.length === 2);
      await page.evaluate(
        (row) => requests[1].resolve(Response.json({ items: [row], removed: [] })),
        priced,
      );
      await observed(page, [{ ...priced, previousPriceCents: 1000 }]);
      await page.evaluate(() => window.testCart.acceptPrice(window.testCart.items[0]));
      await observed(page, [priced]);
      const fresh = await prepared(page, 2);
      assert.deepEqual(await consume(page, fresh.orderId, lines(1)), {
        status: "matched",
        attemptKey: fresh.attemptKey,
      });
      await observed(page, [{ ...priced, quantity: 1 }]);
    },
  );
}

for (const field of ["high", "endpoint", "count"]) {
  test(
    "malformed captured " +
      field +
      " denies purchase effects while ordinary shopping stays available",
    async (t) => {
      const { page } = await fixture(t);
      const old = await prepared(page);
      const corrupt = await page.evaluate(
        ({ field, key }) => {
          const records = JSON.parse(localStorage.getItem(key));
          if (field === "high") records[0].lines[0].units.high = "bad";
          else if (field === "endpoint") records[0].lines[0].units.ranges[0][0] = "bad";
          else records[0].lines[0].quantity = 2;
          const raw = JSON.stringify(records);
          localStorage.setItem(key, raw);
          return raw;
        },
        { field, key: proofKey },
      );
      const saved = await bytes(page);
      assert.equal((await consume(page, old.orderId, lines(1))).status, "corrupt");
      assert.equal(
        (await capture(page, old.attemptKey, lines(3), "resume")).status,
        "corrupt",
      );
      assert.equal(await page.evaluate(() => window.testCart.isReady), true);
      await observed(page, [item(3)]);
      assert.deepEqual(await bytes(page), saved);
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), proofKey),
        corrupt,
      );
      assert.deepEqual(
        await page.evaluate((row) => window.testCart.addItem(row), item(3)),
        { status: "saved" },
      );
      await observed(page, [item(4)]);
    },
  );
}

for (const reset of [false, true]) {
  test(
    "explicit new capture recovers unreadable associations " +
      (reset ? "after clear and fresh add" : "on a healthy current view"),
    async (t) => {
      const { page } = await fixture(t);
      const old = await prepared(page);
      await page.evaluate((key) => localStorage.setItem(key, "{"), proofKey);
      const saved = await bytes(page);
      assert.equal(
        (await capture(page, old.attemptKey, lines(3), "resume")).status,
        "corrupt",
      );
      assert.equal((await consume(page, old.orderId, lines(1))).status, "corrupt");
      assert.equal(await bind(page, old.captureId, old.orderId), false);
      assert.deepEqual(await bytes(page), saved);
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), proofKey),
        "{",
      );
      assert.notEqual((await capture(page, randomUUID(), lines(7))).status, "captured");
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), proofKey),
        "{",
      );
      if (reset) {
        await page.evaluate(async (row) => {
          await window.testCart.clearCart();
          await window.testCart.addItem(row);
        }, item(1));
        await observed(page, [item(1)]);
      }
      const count = reset ? 1 : 3;
      const fresh = await prepared(page, count);
      await assertOldProofGone(page, old, count);
      assert.deepEqual(await consume(page, fresh.orderId, lines(1)), {
        status: "matched",
        attemptKey: fresh.attemptKey,
      });
      await observed(page, reset ? [] : [item(2)]);
    },
  );
}

const purchaseOperations = [
  "captureForCheckout",
  "bindPreparedOrder",
  "consumeConfirmedPurchase",
];
async function purchaseBytes(page, owner = "a") {
  return page.evaluate((owner) => {
    const area = owner ? localStorage : sessionStorage;
    const key = owner ? "rdk_cart_user_" + owner : "rdk_cart_session";
    return [key, key + ":revision", key + ":purchase-v1"].map((k) => area.getItem(k));
  }, owner);
}
async function operationArgs(page, operation) {
  const attemptKey = randomUUID();
  const orderId = randomUUID();
  const result = await capture(page, attemptKey, lines(3));
  assert.equal(result.status, "captured");
  if (operation === "bindPreparedOrder") return [result.captureId, orderId];
  assert.equal(await bind(page, result.captureId, orderId), true);
  if (operation === "consumeConfirmedPurchase") return [orderId, lines(1)];
  return [{ mode: "new", attemptKey: randomUUID(), expectedItems: lines(3) }];
}
for (const operation of purchaseOperations) {
  test(
    "caller abort withdraws queued " + operation + " while another tab holds the lock",
    async (t) => {
      const { page, open } = await fixture(t);
      const args = await operationArgs(page, operation);
      const other = await open();
      const independent = await prepared(other);
      const saved = await purchaseBytes(page);
      await holdLock(other);
      await page.evaluate(
        ({ operation, args }) => {
          window.caller = new AbortController();
          window.outcome = window.testCart[operation](...args, caller.signal);
        },
        { operation, args },
      );
      await queued(other, 1);
      const otherResume = capture(other, independent.attemptKey, lines(3), "resume");
      await queued(other, 2);
      const result = await page.evaluate(() => {
        caller.abort();
        return Promise.race([
          outcome,
          new Promise((resolve) => setTimeout(() => resolve("still queued"), 1000)),
        ]);
      });
      const whileHeld = await purchaseBytes(page);
      await other.evaluate(() => window.unlock());
      const resumed = await otherResume;
      await page.evaluate(() => navigator.locks.request("rdk_cart", () => {}));
      assert.deepEqual(
        result,
        operation === "bindPreparedOrder" ? false : { status: "stale" },
      );
      assert.deepEqual(whileHeld, saved);
      assert.deepEqual(await purchaseBytes(page), saved);
      assert.equal(resumed.captureId, independent.captureId);
      const retried = await page.evaluate(
        ({ operation, args }) =>
          window.testCart[operation](...args, new AbortController().signal),
        { operation, args },
      );
      if (operation === "bindPreparedOrder") assert.equal(retried, true);
      else
        assert.equal(
          retried.status,
          operation === "captureForCheckout" ? "captured" : "matched",
        );
      assert.deepEqual(
        await page.evaluate((row) => window.testCart.addItem(row), item(1)),
        { status: "saved" },
      );
    },
  );
  test(
    "already-aborted guest " + operation + " preserves proof and ordinary cart access",
    async (t) => {
      const { page } = await fixture(t, null);
      const args = await operationArgs(page, operation);
      const saved = await purchaseBytes(page, null);
      const result = await page.evaluate(
        ({ operation, args }) => {
          const caller = new AbortController();
          caller.abort();
          return window.testCart[operation](...args, caller.signal);
        },
        { operation, args },
      );
      assert.deepEqual(
        result,
        operation === "bindPreparedOrder" ? false : { status: "stale" },
      );
      assert.deepEqual(await purchaseBytes(page, null), saved);
      assert.deepEqual(
        await page.evaluate((row) => window.testCart.addItem(row), item(1)),
        { status: "saved" },
      );
      await observed(page, [item(4)]);
    },
  );
}

for (const proof of ["missing", "corrupt"]) {
  test(
    "resume with " + proof + " proof requires the caller's live complete view",
    async (t) => {
      const { page, open } = await fixture(t);
      const other = await open();
      if (proof === "corrupt")
        await page.evaluate((key) => localStorage.setItem(key, "{"), proofKey);
      const attemptKey = randomUUID();
      const saved = await purchaseBytes(page);
      assert.equal((await capture(page, attemptKey, lines(3), "resume")).status, proof);
      assert.deepEqual(await purchaseBytes(page), saved);

      await page.evaluate(() => {
        window.oldCapture = window.testCart.captureForCheckout;
        window.deferStorage = true;
      });
      // Replacing identical public bytes still advances the native account revision.
      await other.evaluate(() =>
        navigator.locks.request("rdk_cart", () =>
          localStorage.setItem("rdk_cart_user_a:revision", crypto.randomUUID()),
        ),
      );
      const replaced = await purchaseBytes(page);
      assert.equal(replaced[0], saved[0]);
      assert.notEqual(replaced[1], saved[1]);
      assert.equal(
        (
          await page.evaluate((args) => oldCapture(args), {
            mode: "resume",
            attemptKey,
            expectedItems: lines(3),
          })
        ).status,
        "mismatch",
      );
      assert.deepEqual(await purchaseBytes(page), replaced);
      await page.evaluate(() => {
        window.deferStorage = false;
      });
      assert.deepEqual(
        await other.evaluate((row) => window.testCart.setCartItems([row]), item(4)),
        { status: "saved" },
      );
      await observed(page, [item(4)]);
      const changed = await purchaseBytes(page);
      assert.equal(
        (
          await page.evaluate((args) => oldCapture(args), {
            mode: "resume",
            attemptKey,
            expectedItems: lines(4),
          })
        ).status,
        "mismatch",
      );
      assert.deepEqual(await purchaseBytes(page), changed);
      assert.equal(
        (await capture(page, attemptKey, lines(2), "resume")).status,
        "mismatch",
      );
      assert.deepEqual(await purchaseBytes(page), changed);
    },
  );
}

for (const [damage, rows] of [
  ["partial", [item(3), null]],
  ["duplicate", [item(1), item(2)]],
]) {
  test(
    "resume rejects " + damage + " public rows even without original proof",
    async (t) => {
      const { page } = await fixture(t, "a", rows);
      const saved = await purchaseBytes(page);
      assert.equal(
        (await capture(page, randomUUID(), lines(3), "resume")).status,
        "mismatch",
      );
      assert.deepEqual(await purchaseBytes(page), saved);
    },
  );
}

test("resume with expired proof and a matching view keeps every original byte", async (t) => {
  const { page } = await fixture(t);
  const old = await prepared(page);
  const saved = await purchaseBytes(page);
  await page.evaluate(() => {
    const now = Date.now();
    Date.now = () => now + 7 * 86400000;
  });
  assert.equal(
    (await capture(page, old.attemptKey, lines(3), "resume")).status,
    "missing",
  );
  assert.deepEqual(await purchaseBytes(page), saved);
});

test("a live caller signal preserves the storage failure mask and retry", async (t) => {
  const { page } = await fixture(t);
  const { orderId, attemptKey } = await prepared(page);
  const saved = await purchaseBytes(page);
  await failNextWrite(page, "applying");
  const result = await page.evaluate(
    ({ orderId, purchased }) =>
      window.testCart.consumeConfirmedPurchase(
        orderId,
        purchased,
        new AbortController().signal,
      ),
    { orderId, purchased: lines(1) },
  );
  assert.equal(result.status, "unavailable");
  assert.deepEqual(await purchaseBytes(page), saved);
  await retry(page);
  assert.deepEqual(await consume(page, orderId, lines(1)), {
    status: "matched",
    attemptKey,
  });
});

test("guest abort after the synchronous purchase commit preserves its receipt", async (t) => {
  const { page } = await fixture(t, null);
  const { orderId, attemptKey } = await prepared(page);
  const purchased = lines(1);
  const result = await page.evaluate(
    ({ orderId, purchased }) => {
      const observation = new AbortController();
      const outcome = window.testCart.consumeConfirmedPurchase(
        orderId,
        purchased,
        observation.signal,
      );
      observation.abort();
      return outcome;
    },
    { orderId, purchased },
  );
  assert.deepEqual(result, { status: "matched", attemptKey });
  await observed(page, [item(2)]);
  const saved = await purchaseBytes(page, null);
  assert.deepEqual(await consume(page, orderId, purchased), result);
  assert.deepEqual(await purchaseBytes(page, null), saved);
});

test("confirmed_purchase_preserves_later_and_readded_units", async (t) => {
  const { page } = await fixture(t, "a", [item(1)]);
  const first = await prepared(page, 1);
  await page.evaluate((row) => window.testCart.addItem(row), item(1));
  const original = JSON.parse((await bytes(page))[0])[0]._cartUnits;
  const bought = await consume(page, first.orderId, lines(1));
  assert.equal(bought.status, "matched");
  assert.deepEqual(JSON.parse((await bytes(page))[0])[0]._cartUnits, {
    id: original.id,
    high: "2",
    ranges: [["1", "2"]],
  });
  const second = await prepared(page, 1);
  await page.evaluate(async (row) => {
    await window.testCart.removeItem(row.productId, row.variantId);
    await window.testCart.addItem(row);
  }, item(1));
  const readded = await bytes(page);
  assert.notEqual(JSON.parse(readded[0])[0]._cartUnits.id, original.id);
  assert.equal((await consume(page, second.orderId, lines(1))).status, "matched");
  assert.deepEqual(await bytes(page), readded);
  const committed = await purchaseBytes(page);
  assert.equal((await consume(page, second.orderId, lines(1))).status, "matched");
  assert.deepEqual(await purchaseBytes(page), committed);
});

test("a healthy 64-digit allocation at its limit keeps the original bound proof on a rejected add", async (t) => {
  const high = "9".repeat(64);
  const units = { id: randomUUID(), high, ranges: [[String(BigInt(high) - 1n), high]] };
  const { page } = await fixture(t, "a", [{ ...item(1), _cartUnits: units }]);
  const order = await prepared(page, 1);
  const before = await purchaseBytes(page);
  assert.deepEqual(await page.evaluate((row) => window.testCart.addItem(row), item(1)), {
    status: "unavailable",
  });
  assert.deepEqual(await purchaseBytes(page), before);
  assert.deepEqual(await consume(page, order.orderId, lines(1)), {
    status: "matched",
    attemptKey: order.attemptKey,
  });
});

test("same-layout active purchase handoff keeps a bound action through a later same-SKU edit", async (t) => {
  const { page } = await fixture(t, "a", [item(1)]);
  const order = await prepared(page, 1);
  await page.evaluate(async (row) => {
    const owner = new AbortController();
    const consume = window.testCart.consumeConfirmedPurchase;
    window.activeHandoff = (id, items) => consume(id, items, owner.signal);
    history.pushState(null, "", "/checkout/processing");
    await window.testCart.addItem(row);
  }, item(1));
  const matched = await page.evaluate(
    ({ order, items }) => window.activeHandoff(order.orderId, items),
    { order, items: lines(1) },
  );
  assert.deepEqual(matched, { status: "matched", attemptKey: order.attemptKey });
  await observed(page, [item(1)]);
});

test("interrupted applying journal retries the same purchased subset after a failed basket write", async (t) => {
  const { page } = await fixture(t);
  const order = await prepared(page);
  const initial = await bytes(page);
  await failNextWrite(page, "rdk_cart_user_a");
  assert.equal((await consume(page, order.orderId, lines(1))).status, "unavailable");
  const partial = await purchaseBytes(page);
  assert.equal(partial[0], initial[0]);
  assert.notEqual(partial[1], initial[1]);
  assert.equal(JSON.parse(partial[2])[0].stage, "applying");
  await retry(page);
  assert.equal((await consume(page, order.orderId, lines(2))).status, "mismatch");
  assert.deepEqual(await purchaseBytes(page), partial);
  assert.deepEqual(await consume(page, order.orderId, lines(1)), {
    status: "matched",
    attemptKey: order.attemptKey,
  });
  await observed(page, [item(2)]);
});

for (const operation of purchaseOperations) {
  test(
    "session marker supersedes queued " + operation + " before storage event delivery",
    async (t) => {
      const { page, open } = await fixture(t);
      const args = await operationArgs(page, operation);
      const other = await open();
      const saved = await purchaseBytes(page);
      await page.evaluate(() => {
        window.deferStorage = true;
      });
      await holdLock(other);
      await page.evaluate(
        ({ operation, args }) => {
          window.queuedPurchase = window.testCart[operation](
            ...args,
            new AbortController().signal,
          );
        },
        { operation, args },
      );
      await queued(other, 1);
      await other.evaluate(() => {
        localStorage.setItem("rdk_session_generation", crypto.randomUUID());
        window.unlock();
      });
      const result = await page.evaluate(() => window.queuedPurchase);
      if (operation === "bindPreparedOrder") assert.equal(result, false);
      else assert.ok(["stale", "unavailable"].includes(result.status));
      assert.deepEqual(await purchaseBytes(page), saved);
    },
  );
}

test("delivered legacy edits returning to identical bytes retire the prior rendered capture action", async (t) => {
  const { page, open } = await fixture(t);
  const other = await open();
  const before = await purchaseBytes(page);
  await page.evaluate(() => {
    window.oldCapture = window.testCart.captureForCheckout;
    window.deliveredChanges = 0;
    window.addEventListener("storage", (event) => {
      if (event.key === "rdk_cart_user_a") window.deliveredChanges++;
    });
  });
  await other.evaluate((row) => {
    const key = "rdk_cart_user_a";
    const original = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify([row]));
    localStorage.setItem(key, original);
  }, item(2));
  await page.waitForFunction(
    () =>
      window.deliveredChanges === 2 &&
      window.oldCapture !== window.testCart.captureForCheckout,
  );
  assert.deepEqual(await purchaseBytes(page), before);
  const result = await page.evaluate((request) => window.oldCapture(request), {
    mode: "new",
    attemptKey: randomUUID(),
    expectedItems: lines(3),
  });
  assert.equal(result.status, "mismatch");
  assert.deepEqual(await purchaseBytes(page), before);
  assert.equal((await capture(page, randomUUID(), lines(3))).status, "captured");
});

test("a second tab still displaying the legacy basket cannot capture after the first tab initializes lineage", async (t) => {
  const { page, open } = await fixture(t);
  const other = await open();
  await other.evaluate(() => {
    window.deferStorage = true;
  });
  const attempt = await prepared(page);
  const current = await purchaseBytes(page);
  assert.equal((await capture(other, randomUUID(), lines(3))).status, "mismatch");
  assert.deepEqual(await purchaseBytes(other), current);
  assert.deepEqual(await consume(page, attempt.orderId, lines(1)), {
    status: "matched",
    attemptKey: attempt.attemptKey,
  });
});

async function interposeBasketWrite(page, boundary, replacement, revision) {
  await page.evaluate(
    ({ boundary, replacement, revision, proofKey }) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        set.call(this, key, value);
        const basketKey = "rdk_cart_user_a";
        const reached =
          boundary === "applying"
            ? key === proofKey &&
              JSON.parse(value).some((record) => record.stage === "applying")
            : key === basketKey + ":revision";
        if (this !== localStorage || !reached) return;
        Storage.prototype.setItem = set;
        if (replacement !== null) set.call(this, basketKey, replacement);
        if (revision !== null) set.call(this, basketKey + ":revision", revision);
      };
    },
    { boundary, replacement, revision, proofKey },
  );
}

for (const willSubtract of [true, false]) {
  test(
    "legacy replacement after applying stays intact when subtraction is " +
      (willSubtract ? "needed" : "a no-op"),
    async (t) => {
      const { page } = await fixture(t, "a", [item(1)]);
      const order = await prepared(page, 1);
      if (!willSubtract)
        await page.evaluate((row) => window.testCart.setCartItems([row]), item(1));
      const replacement = JSON.stringify([{ ...item(1), titleDisplay: "Replacement" }]);
      const before = await bytes(page);
      await interposeBasketWrite(page, "applying", replacement, null);
      const result = await consume(page, order.orderId, lines(1));
      const [raw, revision, journal] = await purchaseBytes(page);
      assert.deepEqual(
        {
          raw,
          revision,
          stage: JSON.parse(journal)[0].stage,
          matched: result.status === "matched",
        },
        { raw: replacement, revision: before[1], stage: "applying", matched: false },
      );
      assert.deepEqual(JSON.parse(journal)[0].purchased, lines(1));
      const retry = await consume(page, order.orderId, lines(1));
      assert.equal(retry.status, "corrupt");
      assert.deepEqual(await purchaseBytes(page), [raw, revision, journal]);
    },
  );
}

for (const interference of ["raw", "revision"]) {
  test(
    "first capture preserves a changed " +
      interference +
      " after the account revision write",
    async (t) => {
      const { page } = await fixture(t, "a", [item(1)]);
      const attempt = randomUUID();
      const [original] = await bytes(page);
      const replacement =
        interference === "raw"
          ? JSON.stringify([{ ...item(1), titleDisplay: "First-capture replacement" }])
          : null;
      const revision = interference === "revision" ? randomUUID() : null;
      await interposeBasketWrite(page, "revision", replacement, revision);
      const result = await capture(page, attempt, lines(1));
      const [raw, actualRevision, proof] = await purchaseBytes(page);
      assert.deepEqual(
        { raw, proof, captured: result.status === "captured" },
        { raw: replacement ?? original, proof: null, captured: false },
      );
      if (revision !== null) assert.equal(actualRevision, revision);
      const resume = await capture(page, attempt, lines(1), "resume");
      assert.notEqual(resume.status, "captured");
      assert.deepEqual(await purchaseBytes(page), [raw, actualRevision, null]);
    },
  );
}
