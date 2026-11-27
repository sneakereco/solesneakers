import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import test from "node:test";
import { atRequestBarrier } from "./request-barrier.mjs";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const site = "https://fixture.invalid";
const ip = "203.0.113.20";
const budgets = {
  version: 1,
  revision: "local-shared-network",
  ipPerMinute: 61,
  globalPerMinute: 61,
  providers: { shippo: 1, square: 1 },
};
const fixtureToken = "local-test-credential-never-used-outside-fixture";
Object.assign(process.env, {
  NODE_ENV: "test",
  NEXT_PUBLIC_SITE_URL: site,
  NEXT_PUBLIC_SUPABASE_URL: site,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixtureToken,
  SUPABASE_SECRET_KEY: fixtureToken,
  SUPABASE_DB_URL: site,
  UPSTASH_REDIS_REST_URL: site,
  UPSTASH_REDIS_REST_TOKEN: fixtureToken,
  SHIPPO_API_TOKEN: fixtureToken,
  SHIPPO_WEBHOOK_TOKEN: fixtureToken,
  SES_SMTP_HOST: "fixture.invalid",
  SES_SMTP_PASS: fixtureToken,
  SES_SMTP_USER: fixtureToken,
  ADMIN_SESSION_SECRET: fixtureToken,
  ORDER_ACCESS_TOKEN_SECRET: fixtureToken,
  CHECKOUT_IDENTITY_HMAC_SECRET: fixtureToken,
  CHECKOUT_ADMISSION_BUDGETS: JSON.stringify(budgets),
});

// No host port or persisted Redis volume. One local redis-cli session keeps the
// sixty-second scenario independent of per-command Docker process startup.
async function withRedis(work) {
  const docker = (...args) =>
    execFileSync("docker", args, { encoding: "utf8", timeout: 30000 }).trim();
  const image = docker(
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    "redis@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe",
  );
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const owner = randomUUID(),
    name = "checkout-network-" + owner;
  const id = docker(
    "run",
    "-d",
    "--pull=never",
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/data:rw,mode=1777",
    "--name",
    name,
    "--label",
    "checkout.fixture=" + owner,
    image,
    "redis-server",
    "--port",
    "0",
    "--unixsocket",
    "/data/fixture.sock",
    "--save",
    "",
    "--appendonly",
    "no",
  );
  assert.match(id, /^[a-f0-9]{64}$/);
  let cli;
  try {
    cli = spawn(
      "docker",
      ["exec", "-i", id, "redis-cli", "-s", "/data/fixture.sock", "--json"],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const lines = createInterface({ input: cli.stdout })[Symbol.asyncIterator]();
    async function command(...args) {
      cli.stdin.write(args.map((a) => JSON.stringify(String(a))).join(" ") + "\n");
      const line = await lines.next();
      assert.equal(line.done, false);
      return JSON.parse(line.value);
    }
    await work({
      image,
      eval: (script, keys, args) =>
        command("EVAL", script, keys.length, ...keys, ...args),
      set: (key, value, options) => command("SET", key, value, "EX", options.ex, "NX"),
      command,
    });
  } finally {
    cli?.stdin.end();
    assert.equal(docker("inspect", "--format", "{{.Name}}", id), "/" + name);
    assert.equal(
      JSON.parse(docker("inspect", "--format", "{{json .Config.Labels}}", id))[
        "checkout.fixture"
      ],
      owner,
    );
    docker("rm", "-f", id);
  }
}

// The local fixture provides PostgreSQL directly. Translate only the receiving
// adapters' named RPCs and relation shapes, retaining real owner filters/counts.
function localDatabase(sql, session) {
  const rpcNames = new Set([
    "reserve_checkout_inventory_v2",
    "attach_square_checkout_order",
    "get_or_create_checkout_payment_attempt",
    "begin_checkout_payment_dispatch",
    "record_checkout_payment_outcome",
    "checkout_financial_admission",
    "acquire_checkout_dependency_lease",
    "release_checkout_dependency_lease",
    "apply_checkout_financial_fact",
    "record_checkout_terminal_capture",
  ]);
  const rows = async (table, key, value) =>
    (
      await sql.query(
        "select to_jsonb(t) data from " + table + " t where " + key + "=$1",
        [value],
      )
    ).rows.map((r) => r.data);
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: session() } }) },
    async rpc(name, args) {
      assert.ok(rpcNames.has(name), name);
      const names = Object.keys(args);
      assert.ok(names.every((k) => /^p_[a-z_]+$/.test(k)));
      try {
        const statement =
          "select public." +
          name +
          "(" +
          names.map((k, i) => k + "=>$" + (i + 1)).join(",") +
          ") data";
        return {
          data: (await sql.query(statement, Object.values(args))).rows[0].data,
          error: null,
        };
      } catch (error) {
        return { error, data: null };
      }
    },
    from(table) {
      const filters = {},
        q = {
          select(value) {
            columns = value;
            return q;
          },
          eq(key, value) {
            filters[key] = value;
            return q;
          },
          order() {
            return q;
          },
          limit() {
            return q;
          },
          maybeSingle: () => read(true),
          then: (ok, bad) => read(false).then(ok, bad),
        };
      let columns = "";
      async function read(single) {
        if (table === "orders") {
          const [order] = await rows("orders", "id", filters.id);
          if (!order || (filters.user_id && order.user_id !== filters.user_id))
            return { data: null, error: null };
          if (columns.includes("checkout_financial_facts")) {
            const facts = await rows("checkout_financial_facts", "order_id", order.id),
              attempts = await rows("checkout_payment_attempts", "order_id", order.id),
              refunds = await rows("square_refunds", "order_id", order.id);
            Object.assign(order, {
              facts,
              attempts,
              refunds,
              factCount: [{ count: facts.length }],
              attemptCount: [{ count: attempts.length }],
              refundCount: [{ count: refunds.length }],
            });
          } else if (columns.includes("order_billing")) {
            order.order_billing = (await rows("order_billing", "order_id", order.id))[0];
            order.order_shipping = (
              await rows("order_shipping", "order_id", order.id)
            )[0];
          }
          return { data: order, error: null };
        }
        if (table === "checkout_payment_attempts") {
          const result = await sql.query(
            'select id,order_id as "orderId",sequence,state,method,amount_cents as "amountCents",currency,square_idempotency_key as "squareIdempotencyKey",request_digest as "requestDigest",provider_payment_id as "providerPaymentId" from checkout_payment_attempts where order_id=$1 order by sequence desc limit 1',
            [filters.order_id],
          );
          return { data: result.rows[0] ?? null, error: null };
        }
        assert.ok(["order_items", "order_events"].includes(table), table);
        const data = await rows(table, "order_id", filters.order_id);
        return { data: single ? data[0] : data, count: data.length, error: null };
      }
      return q;
    },
  };
}

test("twenty verified shoppers sharing a network prepare, pay once and observe their original paid orders", async () => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, seedCatalog, seedOrder, connect }) =>
      withRedis(async (redis) => {
        const service = await connect("service_role");
        let session = null;
        const db = localDatabase(service, () => session);
        const originalFetch = globalThis.fetch;
        const originals = new Map();
        function replace(path, parts) {
          const resolved = require.resolve(path),
            original = require(resolved);
          originals.set(resolved, original);
          require.cache[resolved].exports = { ...original, ...parts };
        }
        const log = () => {};
        const counts = { shippo: 0, calculate: 0, create: 0, pay: 0 };
        async function active(dependency) {
          const r = await admin.query(
            "select count(*)::int n from checkout_dependency_leases where dependency=$1 and lease_expires_at>clock_timestamp()",
            [dependency],
          );
          assert.equal(
            r.rows[0].n,
            1,
            dependency + " operation must hold a committed slot",
          );
        }
        const totals = {
          subtotalCents: 1000,
          shippingCents: 500,
          taxCents: 80,
          totalCents: 1580,
        };
        try {
          globalThis.fetch = async (url) => {
            assert.equal(new URL(url).origin, "https://api.goshippo.com");
            await active("shippo");
            counts.shippo++;
            return Response.json({ analysis: { validation_result: { value: "valid" } } });
          };
          const {
            CheckoutAttemptLimiter,
          } = require("@/lib/checkout/checkout-attempt-limit");
          const { PaymentPermitStore } = require("@/lib/checkout/payment-permit");
          const { SquarePaymentsGateway } = require("@/lib/square/payments");
          replace("@/lib/utils/log", {
            log,
            logError: (error) => {
              throw error;
            },
          });
          replace("@/lib/supabase/service-role", { createSupabaseAdminClient: () => db });
          replace("@/lib/supabase/server", { createSupabaseServerClient: () => db });
          replace("@/lib/checkout/checkout-attempt-limit", {
            createCheckoutAttemptLimiter: (client) =>
              new CheckoutAttemptLimiter(redis, budgets, client),
          });
          replace("@/lib/checkout/payment-permit", {
            createPaymentPermitStore: () => new PaymentPermitStore(redis),
          });
          replace("@/lib/square/client", {
            createSquareCheckoutOrdersGateway: () => ({
              calculate: async () => {
                await active("square");
                counts.calculate++;
                return totals;
              },
              create: async () => {
                await active("square");
                counts.create++;
                const id = "sq-" + randomUUID();
                return {
                  ...totals,
                  id,
                  version: 1,
                  taxCalculationId: "square:" + id + ":v1",
                };
              },
            }),
            createSquarePaymentsGateway: () =>
              new SquarePaymentsGateway(
                {
                  create: async (r) => {
                    await active("square");
                    counts.pay++;
                    return {
                      payment: {
                        locationId: "loc",
                        sourceType: "CARD",
                        cardDetails: {},
                        id: "pay-" + randomUUID(),
                        orderId: r.orderId,
                        referenceId: r.referenceId,
                        status: "COMPLETED",
                        amountMoney: r.amountMoney,
                      },
                    };
                  },
                },
                "loc",
              ),
          });
          const { NextRequest } = require("next/server");
          const { prepareCheckoutHandler } = require("@/lib/checkout/prepare-checkout");
          const {
            createPrepareCheckoutDependencies,
          } = require("@/lib/checkout/prepare-checkout-dependencies");
          const {
            issuePaymentPermitHandler,
          } = require("@/lib/checkout/issue-payment-permit");
          const {
            createDirectPaymentHandler,
          } = require("@/lib/checkout/create-direct-payment");
          const {
            createIssuePaymentPermitDependencies,
            createDirectPaymentDependencies,
          } = require("@/lib/checkout/payment-api-dependencies");
          const {
            createCheckoutQuoteFingerprint,
          } = require("@/lib/checkout/checkout-quote-fingerprint");
          const {
            FinancialProjectionRepository,
          } = require("../../../Source/Features/Payments/projection-repository.ts");
          const { GET } = require("@/app/api/orders/[orderId]/route");
          const tenant = (await admin.query("select id from tenants limit 1")).rows[0]
            ?.id;
          const catalog = await seedCatalog({ stock: 21 });
          const tenantId =
            tenant ?? (await admin.query("select id from tenants limit 1")).rows[0].id;
          await admin.query(
            "update products set is_active=true,is_out_of_stock=false,go_live_at=now()-interval '1 minute' where id=$1",
            [catalog.productId],
          );
          await admin.query(
            "insert into shipping_defaults(tenant_id,category,shipping_cost_cents,default_weight_oz,default_length_in,default_width_in,default_height_in) values($1,'accessories',500,16,12,10,8) on conflict(tenant_id,category) do update set shipping_cost_cents=500",
            [tenantId],
          );
          const item = {
            ...catalog,
            quantity: 1,
            unitPriceCents: 1000,
            unitCostCents: 0,
            lineTotalCents: 1000,
            variantSku: "fixture",
            productName: "Fixture",
            brand: "fixture",
            model: null,
            category: "accessories",
            condition: "new",
            sizeLabel: "one",
          };
          const address = {
            name: "Fixture Buyer",
            phone: "5555555555",
            line1: "10 Main St",
            city: "Charleston",
            state: "SC",
            postalCode: "29401",
            country: "US",
          };
          const billing = {
            givenName: "Fixture",
            familyName: "Buyer",
            phone: null,
            line1: "10 Main St",
            city: "Charleston",
            state: "SC",
            postalCode: "29401",
            country: "US",
          };
          const quoteFingerprint = createCheckoutQuoteFingerprint({
            items: [{ variantId: item.variantId, quantity: 1, unitPriceCents: 1000 }],
            fulfillment: "ship",
            shippingAddress: address,
            totals,
          });
          const req = (route, body) =>
            new NextRequest(site + route, {
              method: body ? "POST" : "GET",
              headers: { "x-vercel-forwarded-for": ip },
              ...(body ? { body: JSON.stringify(body) } : {}),
            });
          const common = {
            getSession: () => Promise.resolve({ user: session }),
            getAccess: () => Promise.resolve({ open: true }),
            verifyBrowser: () => Promise.resolve({ allowed: true, reason: "passed" }),
            findTenantId: () => Promise.resolve(tenantId),
            reportError: (error) => {
              throw error;
            },
          };
          const purchased = new Set();
          let lastOriginal;
          for (let index = 0; index < 22; index++) {
            const { userId } = await seedOrder();
            session = { id: userId, email: "checkout-" + userId + "@fixture.invalid" };
            const deviceSessionId = randomUUID();
            const body = {
              items: [
                { productId: item.productId, variantId: item.variantId, quantity: 1 },
              ],
              fulfillment: "ship",
              shippingAddress: address,
              billingAddress: billing,
              idempotencyKey: randomUUID(),
              deviceSessionId,
              paymentMethod: "card",
              quoteFingerprint,
            };
            const prepared = await prepareCheckoutHandler(
              req("/api/checkout/prepare", body),
              {
                ...createPrepareCheckoutDependencies("fixture"),
                ...common,
                findExisting: () => Promise.resolve(null),
                resolveCart: () =>
                  Promise.resolve({ items: [item], subtotalCents: 1000 }),
                quote: () =>
                  Promise.resolve({
                    shippingCents: 500,
                    taxCents: 0,
                    customerState: "SC",
                    taxCalculationId: "square:pending",
                  }),
                getSquareClientConfig: () => ({
                  applicationId: "fixture",
                  locationId: "loc",
                  environment: "sandbox",
                }),
              },
            );
            const data = await prepared.json();
            if (index === 21) {
              assert.equal(prepared.status, 429, JSON.stringify(data));
              break;
            }
            assert.equal(prepared.status, 201, JSON.stringify(data));
            if (index === 20) {
              lastOriginal = { orderId: data.orderId, session, deviceSessionId };
              continue;
            }
            const orderId = data.orderId;
            assert.ok(!purchased.has(orderId));
            purchased.add(orderId);
            const issue = await issuePaymentPermitHandler(
              req("/api/checkout/payment-permit", {
                orderId,
                deviceSessionId,
                method: "card",
              }),
              { ...createIssuePaymentPermitDependencies("fixture"), ...common },
            );
            const permit = await issue.json();
            assert.equal(issue.status, 201, JSON.stringify(permit));
            if (index === 0) {
              // Bytes persisted by the previous issuer. The old browser sends only
              // its bearer and source. Its old random key cannot own the new attempt.
              const legacy = await new PaymentPermitStore(redis).issue({
                tenantId,
                orderId,
                cartHash: (
                  await admin.query("select cart_hash from orders where id=$1", [orderId])
                ).rows[0].cart_hash,
                totalCents: totals.totalCents,
                method: "card",
                deviceSessionId,
                normalizedEmailHash: "f".repeat(64),
                squareIdempotencyKey: randomUUID(),
              });
              const observation = await createDirectPaymentHandler(
                req("/api/checkout/pay", {
                  permit: legacy.token,
                  sourceId: "fixture-legacy",
                }),
                { ...createDirectPaymentDependencies("fixture"), ...common },
              );
              const observed = await observation.json();
              assert.equal(observation.status, 202);
              assert.equal(observed.orderId, orderId);
              assert.equal(observed.status, "UNKNOWN");
              assert.equal(counts.pay, 0);
            }
            const response = await createDirectPaymentHandler(
              req("/api/checkout/pay", {
                permit: permit.permit,
                sourceId: "controlled-" + index,
              }),
              {
                ...createDirectPaymentDependencies("fixture"),
                ...common,
                savePaymentId: async (_, paymentId, payment) => {
                  await new FinancialProjectionRepository(
                    db,
                    new Date().toISOString(),
                  ).applyFinancialFact({
                    kind: "payment",
                    providerId: paymentId,
                    paymentId,
                    orderId,
                    providerVersion: "1",
                    status: "COMPLETED",
                    amountCents: payment.totalCents,
                    currency: "USD",
                    expectedTotalCents: totals.totalCents,
                    fulfillmentStatus: "unfulfilled",
                  });
                },
              },
            );
            const paid = await response.json();
            assert.equal(response.status, 202, JSON.stringify(paid));
            assert.equal(paid.status, "COMPLETED", JSON.stringify(paid));
            if (index === 0)
              assert.equal(
                counts.pay,
                1,
                "legacy and new permits must result in one dispatch",
              );
            const status = await GET(req("/api/orders/" + orderId), {
              params: Promise.resolve({ orderId }),
            });
            const receipt = await status.json();
            assert.equal(status.status, 200, JSON.stringify(receipt));
            assert.equal(receipt.id, orderId);
            assert.equal(receipt.status, "paid");
            assert.equal(receipt.financial.snapshot.capturedCents, 1580);
            assert.equal(
              (
                await admin.query(
                  "select count(*)::int n from checkout_payment_attempts where order_id=$1 and dispatched_at is not null",
                  [orderId],
                )
              ).rows[0].n,
              1,
            );
          }
          assert.equal(purchased.size, 20);
          assert.deepEqual(counts, { shippo: 41, calculate: 21, create: 21, pay: 20 });
          assert.equal(
            await redis.command("ZCARD", "rdk:checkout:{admission}:global"),
            61,
          );

          // Two already-issued bearers read the same latest ready attempt before an
          // independent database session records a capture on its older failed sibling.
          session = lastOriginal.session;
          const {
            CheckoutPaymentAttemptRepository,
          } = require("../../../Source/Features/Payments/attempt-repository.ts");
          const {
            CheckoutReservationRepository,
          } = require("@/repositories/checkout-reservation-repo");
          const attempts = new CheckoutPaymentAttemptRepository(db);
          const order = await new CheckoutReservationRepository(db).findPaymentCheckout(
            lastOriginal.orderId,
          );
          const ownerBinding = "account:" + session.id;
          const issueAttempt = () =>
            attempts.getOrCreateAttempt({
              orderId: order.orderId,
              method: "card",
              ownerBinding,
            });
          const first = await issueAttempt(),
            paymentId = "earlier-" + randomUUID();
          await attempts.beginDispatch({
            attemptId: first.id,
            ownerBinding,
            requestDigest: "a".repeat(64),
            sourceDigest: "b".repeat(64),
          });
          await attempts.recordAttemptOutcome({
            attemptId: first.id,
            state: "declined",
            providerPaymentId: paymentId,
            verifiedFacts: {
              kind: "square_payment",
              orderId: order.orderId,
              squareOrderId: order.squareOrderId,
              paymentId,
              status: "FAILED",
              amountCents: order.totalCents,
              currency: "USD",
            },
          });
          const next = await issueAttempt();
          assert.equal(next.state, "ready");
          const store = new PaymentPermitStore(redis);
          const permits = [];
          for (let i = 0; i < 2; i++)
            permits.push(
              (
                await store.issue({
                  attemptId: next.id,
                  ownerBinding,
                  tenantId,
                  orderId: order.orderId,
                  cartHash: order.cartHash,
                  totalCents: order.totalCents,
                  method: "card",
                  deviceSessionId: lastOriginal.deviceSessionId,
                  normalizedEmailHash: "f".repeat(64),
                  squareIdempotencyKey: next.squareIdempotencyKey,
                })
              ).token,
            );
          const blocked = Promise.withResolvers(),
            resume = Promise.withResolvers();
          let arrivals = 0;
          const pending = permits.map((permit, index) =>
            createDirectPaymentHandler(
              req("/api/checkout/pay", { permit, sourceId: "inert" }),
              {
                ...createDirectPaymentDependencies("fixture"),
                ...common,
                getAccess: async () => {
                  if (++arrivals === 2) blocked.resolve();
                  await resume.promise;
                  return index === 0
                    ? { open: false, message: "dispatch paused" }
                    : { open: true };
                },
              },
            ),
          );
          await atRequestBarrier({
            arrived: blocked.promise,
            pending,
            resume: resume.resolve,
            inspect: async () => {
              const independent = localDatabase(
                await connect("service_role"),
                () => session,
              );
              const snapshot = await new FinancialProjectionRepository(
                independent,
                new Date().toISOString(),
              ).recordTerminalCapture(first.id, order.squareOrderId, first.id, "card", {
                kind: "payment",
                providerId: paymentId,
                paymentId,
                orderId: order.orderId,
                providerVersion: "captured",
                status: "COMPLETED",
                amountCents: order.totalCents,
                currency: "USD",
                expectedTotalCents: order.totalCents,
                fulfillmentStatus: "unfulfilled",
              });
              assert.equal(snapshot.capturedCents, 1580);
              assert.equal(snapshot.reviewReason, "square_terminal_capture_conflict");
            },
          });
          for (const response of await Promise.all(pending)) {
            const observed = await response.json();
            assert.equal(response.status, 202, JSON.stringify(observed));
            assert.equal(observed.status, "UNKNOWN");
            assert.equal(observed.orderId, order.orderId);
            assert.equal(observed.code, undefined);
          }
          assert.equal(
            (
              await admin.query(
                "select state from checkout_payment_attempts where id=$1",
                [next.id],
              )
            ).rows[0].state,
            "ready",
          );
          assert.equal(counts.pay, 20);
          console.log(
            "20/20 authorized paid receipts; 20 calls; 61 accepted coarse requests; both concurrent refusals observed original money; Redis " +
              redis.image,
          );
        } finally {
          globalThis.fetch = originalFetch;
          for (const [k, v] of originals) require.cache[k].exports = v;
        }
      }),
  );
});
