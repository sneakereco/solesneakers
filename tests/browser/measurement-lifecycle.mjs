import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";

const receiptId = "123e4567-e89b-42d3-a456-426614174000";
const buyer = (account) => "sole-buyer:v1:" + account.repeat(64);
const cartItem = {
  productId: receiptId,
  variantId: "123e4567-e89b-42d3-a456-426614174001",
  sizeLabel: "10",
  brand: "Sole",
  name: "Fixture",
  titleDisplay: "Fixture",
  priceCents: 10000,
  imageUrl: "/shoe.png",
  maxStock: 1,
  quantity: 1,
};
function gate() {
  return Promise.withResolvers();
}
async function exercise(browser, bundle, scenario) {
  const ctx = await browser.newContext();
  const preference = gate(),
    identity = gate(),
    auth = gate();
  let account = ["identity", "recovery", "peer"].includes(scenario) ? "a" : null,
    choice = scenario === "fresh" ? "unknown" : "accepted",
    unavailable = scenario === "recovery";
  let authHold = false,
    identityReads = 0;
  const wire = [];
  try {
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "us.i.posthog.com") {
        const bytes = route.request().postDataBuffer();
        if (bytes) {
          const payload = JSON.parse(
            (bytes[0] === 0x1f ? gunzipSync(bytes) : bytes).toString(),
          );
          wire.push(...payload.batch);
        }
        return route.fulfill({ json: {} });
      }
      if (url.pathname === "/api/analytics/preferences") {
        if (route.request().method() === "POST")
          choice = route.request().postDataJSON().choice;
        if (scenario === "preferences") await preference.promise;
        return route.fulfill({
          json: choice === "accepted" ? { choice, receiptId } : { choice },
        });
      }
      if (url.pathname === "/api/auth/session") {
        if (authHold) await auth.promise;
        return route.fulfill({
          json: {
            user: account ? { id: account, email: "" } : null,
            role: account ? "customer" : null,
          },
        });
      }
      if (url.pathname === "/api/analytics/identity") {
        identityReads++;
        if (scenario === "identity") await identity.promise;
        return route.fulfill({
          status: unavailable ? 503 : account ? 200 : 403,
          json: account && !unavailable ? { buyerKey: buyer(account) } : null,
        });
      }
      if (url.pathname === "/api/cart/validate")
        return route.fulfill({ json: { items: [cartItem] } });
      if (url.pathname === "/api/checkout/quote")
        return route.fulfill({
          json: {
            completeness: "estimate",
            quoteFingerprint: "a".repeat(64),
            totals: {
              subtotalCents: 10000,
              shippingCents: 0,
              taxCents: 0,
              totalCents: 10000,
            },
          },
        });
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    async function open(pathname) {
      const tab = await ctx.newPage();
      tab.setDefaultTimeout(4500);
      await tab.goto("https://soles-stg.vercel.app" + pathname);
      await tab.evaluate(
        ({ account, cartItem }) => {
          window.fixtureMode = "lifecycle";
          window.initialAccount = account;
          (account ? localStorage : sessionStorage).setItem(
            account ? "rdk_cart_user_" + account : "rdk_cart_session",
            JSON.stringify([cartItem]),
          );
        },
        { account, cartItem },
      );
      await tab.addScriptTag({ content: bundle });
      return tab;
    }
    if (["preferences", "identity", "fresh"].includes(scenario)) {
      const tab = await open("/checkout");
      await tab.locator("[data-summary]").waitFor({ state: "attached" });
      assert.equal(wire.filter((e) => e.event === "checkout_started").length, 0);
      preference.resolve();
      identity.resolve();
      if (scenario === "fresh")
        await tab.getByRole("button", { name: "Allow analytics" }).click();
      await tab.waitForFunction(() => !!window.actions.context());
      await tab.waitForTimeout(180);
      assert.equal(
        wire.filter((e) => e.event === "checkout_started").length,
        scenario === "fresh" ? 0 : 1,
        scenario + " checkout starts",
      );
    } else if (scenario === "recovery") {
      const tab = await open("/store");
      await tab.getByRole("button", { name: "Privacy choices" }).waitFor();
      await tab.waitForTimeout(180);
      assert.ok(identityReads);
      assert.equal(await tab.evaluate(() => window.actions.context()), null);
      const prior = await tab.evaluate(() => ({
        id: window.actions.nativeId(),
        session: window.actions.nativeSession(),
      }));
      unavailable = false;
      const initial = identityReads;
      await tab.evaluate(() => window.dispatchEvent(new Event("online")));
      await tab.waitForFunction(() => !!window.actions.context());
      assert.equal(
        (await tab.evaluate(() => window.actions.context())).visitorId,
        buyer("a"),
      );
      assert.equal(identityReads, initial + 1);
      await tab.waitForTimeout(100);
      const linked = wire.find((e) => e.event === "$identify");
      assert.equal(linked?.properties.$anon_distinct_id, prior.id);
      assert.equal(linked?.properties.$session_id, prior.session);
    } else {
      const first = await open("/store"),
        peer = await open("/store");
      for (const tab of [first, peer])
        await tab.waitForFunction(() =>
          window.actions.context()?.visitorId.startsWith("sole-buyer:"),
        );
      account = "b";
      authHold = true;
      await first.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
      await peer.waitForFunction(() => window.actions.context() === null);
      const cutoff = wire.length;
      await peer.evaluate(() => window.observe());
      auth.resolve();
      authHold = false;
      await peer.waitForFunction(
        (key) => window.actions.context()?.visitorId === key,
        buyer("b"),
      );
      await peer.evaluate(() => window.observe());
      await peer.waitForTimeout(100);
      assert.ok(wire.slice(cutoff).some((e) => e.properties.distinct_id === buyer("b")));
      assert.ok(!wire.slice(cutoff).some((e) => e.properties.distinct_id === buyer("a")));
      account = null;
      await first.evaluate(() => window.dispatchEvent(new Event("sessionUpdate")));
      await peer.waitForFunction(
        () =>
          !!window.actions.context() &&
          !window.actions.context().visitorId.startsWith("sole-buyer:"),
      );
      const after = wire.length;
      await peer.evaluate(() => window.observe());
      await peer.waitForTimeout(100);
      assert.ok(
        wire
          .slice(after)
          .some((e) => !e.properties.distinct_id.startsWith("sole-buyer:")),
      );
      assert.ok(!wire.slice(after).some((e) => e.properties.distinct_id === buyer("b")));
    }
    console.log("PASS measurement lifecycle " + scenario);
  } finally {
    preference.resolve();
    identity.resolve();
    auth.resolve();
    await ctx.close();
  }
}
export async function checkMeasurementLifecycle(browser, bundle) {
  const names = ["preferences", "identity", "fresh", "recovery", "peer"];
  const outcomes = await Promise.allSettled(
    names.map((name) => exercise(browser, bundle, name)),
  );
  const errors = outcomes.flatMap((outcome, i) =>
    outcome.status === "rejected" ? [names[i] + ": " + outcome.reason] : [],
  );
  assert.deepEqual(errors, []);
}
