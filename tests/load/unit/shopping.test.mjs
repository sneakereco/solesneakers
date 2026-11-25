import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  runCheckoutJourney,
  runCartJourney,
  runCatalogJourney,
} from "../shared/journeys.mjs";
async function fixture(t, options = {}) {
  const calls = [];
  let clock = 0;
  const metrics = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ path: req.url, body });
    res.setHeader("content-type", "application/json");
    const path = new URL(req.url, "http://fixture").pathname;
    const data = path.endsWith("/quote")
      ? {
          completeness: "exact",
          quoteFingerprint: "a".repeat(64),
          totals: {
            subtotalCents: 1000,
            shippingCents: 0,
            taxCents: 0,
            totalCents: 1000,
          },
        }
      : path.endsWith("/prepare")
        ? {
            orderId: "22222222-2222-4222-8222-222222222222",
            guestAccessToken: "private",
            totals: { totalCents: 1000 },
          }
        : path.endsWith("/payment-permit")
          ? { permit: "permit-private" }
          : path.endsWith("/pay")
            ? {
                status: "COMPLETED",
                orderId: "22222222-2222-4222-8222-222222222222",
                paymentId: "fake-id",
              }
            : path.startsWith("/api/orders/")
              ? {
                  id: "22222222-2222-4222-8222-222222222222",
                  status: options.pending ? "pending" : "paid",
                }
              : path.endsWith("/validate")
                ? {
                    items: options.noStock
                      ? []
                      : [{ productId: "p", variantId: "v", quantity: 1 }],
                    removed: options.noStock ? [{ reason: "out_of_stock" }] : [],
                  }
                : path.startsWith("/api/store")
                  ? { products: [], total: 0 }
                  : null;
    res.statusCode = path.endsWith("/prepare") ? (options.status ?? 201) : 200;
    res.end(
      data === null
        ? "<!doctype html><html>Fixture</html>"
        : JSON.stringify(
            options.badBody
              ? {}
              : options.status === 409 && path.endsWith("/prepare")
                ? { code: "insufficient_stock" }
                : data,
          ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const transport = {
    nowMs: () => clock,
    pause: async (seconds) => {
      clock += seconds * 1000;
    },
    emit: (...v) => metrics.push(v),
    request: async (input) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${input.path}`,
        {
          method: input.method ?? "GET",
          headers: { "content-type": "application/json" },
          body: input.body ? JSON.stringify(input.body) : undefined,
        },
      );
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
        timing: 1,
      };
    },
  };
  const session = {
    runId: "run",
    slot: 1,
    deviceId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "44444444-4444-4444-8444-444444444444",
    email: "guest@run.load.test",
    fulfillment: "pickup",
    items: [{ productId: "p", variantId: "v", quantity: 1 }],
    address: {
      name: "Load Buyer",
      phone: "2025550100",
      line1: "1 Test Avenue",
      line2: "",
      city: "Columbia",
      state: "SC",
      postalCode: "29201",
      country: "US",
    },
  };
  return {
    session,
    plan: { pauses: { browse: [0, 0], cart: [0, 0], checkout: [0, 0] } },
    transport,
    calls,
    metrics,
  };
}
test("actual checkout contracts follow quote prepare permit pay and authorized status", async (t) => {
  const f = await fixture(t);
  const result = await runCheckoutJourney(f.session, f.plan, f.transport);
  assert.equal(result.status, "paid");
  assert.deepEqual(
    f.calls.map((x) => x.path.split("?")[0]),
    [
      "/api/checkout/quote",
      "/api/checkout/prepare",
      "/api/checkout/payment-permit",
      "/api/checkout/pay",
      "/api/orders/22222222-2222-4222-8222-222222222222",
    ],
  );
  assert.equal(f.calls[2].body.guestAccessToken, "private");
  assert.deepEqual(f.calls[3].body, {
    permit: "permit-private",
    sourceId: "load-source-approved",
  });
});
test("stock conflicts are expected only at reservation; 403 and 429 fail", async (t) => {
  for (const status of [409, 403, 429]) {
    const f = await fixture(t, { status });
    if (status === 409)
      assert.equal(
        (await runCheckoutJourney(f.session, f.plan, f.transport)).classification,
        "stock-conflict",
      );
    else await assert.rejects(runCheckoutJourney(f.session, f.plan, f.transport), /HTTP/);
  }
});
test("HTTP 200 with invalid schema fails; pending status has bounded deadline", async (t) => {
  let f = await fixture(t, { badBody: true });
  await assert.rejects(runCheckoutJourney(f.session, f.plan, f.transport), /schema/);
  f = await fixture(t, { pending: true });
  const result = await runCheckoutJourney(f.session, f.plan, f.transport);
  assert.equal(result.classification, "outcome-timeout");
  assert.ok(f.transport.nowMs() <= 31000);
});
test("cart validation removes unavailable stock without invented cart writes", async (t) => {
  const f = await fixture(t, { noStock: true });
  await runCartJourney(f.session, f.plan, f.transport);
  assert.equal(f.session.items.length, 0);
  assert.ok(f.calls.every((x) => !x.path.includes("add-to-cart")));
  await runCatalogJourney(f.session, f.plan, f.transport);
  assert.ok(f.calls.some((x) => x.path === "/store"));
});
