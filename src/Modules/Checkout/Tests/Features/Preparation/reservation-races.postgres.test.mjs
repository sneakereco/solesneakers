import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { reserve as reserveLegacy } from "../../../../../../tests/database/fixtures/single-store-expansion.mjs";
const require = createRequire(import.meta.url);
require("tsx/cjs");
const { checkoutQuoteHandler } = require("../../../../../lib/checkout/checkout-quote.ts");
const {
  prepareCheckoutHandler,
} = require("../../../../../lib/checkout/prepare-checkout.ts");
const {
  CheckoutPreparationRepository,
} = require("../../../Source/Features/Preparation/reservation-repository.ts");
import { randomUUID } from "node:crypto";
import {
  completedValues,
  raceAtRowLock,
  withCheckoutDatabase,
} from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

test("atomic checkout allocation across independent sessions", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedCatalog, seedOrder }) => {
      const a = await connect("service_role"),
        b = await connect("service_role");
      const item = async (stock = 1) => {
        const ids = await seedCatalog({ stock });
        await admin.query(
          "update products set is_active=true,is_out_of_stock=false,go_live_at=now()-interval '1 minute' where id=$1",
          [ids.productId],
        );
        return {
          ...ids,
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
      };
      await seedOrder();
      const tenantId = (await admin.query("select id from tenants limit 1")).rows[0].id;
      const req = (items) => ({
        version: 2,
        action: "reserve",
        tenantId,
        userId: null,
        guestEmail: "guest@fixture.invalid",
        ownerBinding: "guest:" + "a".repeat(64),
        fulfillment: "pickup",
        currency: "USD",
        paymentMethod: "card",
        idempotencyKey: randomUUID(),
        cartHash: "b".repeat(64),
        subtotalCents: items.length * 1000,
        shippingCents: 0,
        taxCents: 80,
        totalCents: items.length * 1000 + 80,
        taxCalculationId: "square:calculated",
        customerState: "SC",
        shippingAddress: null,
        billingAddress: {
          givenName: "Fixture",
          familyName: "Buyer",
          line1: "123 Main St",
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        },
        pickupContact: { name: "Fixture Buyer", phone: "5555555555" },
        protectionEvidence: {
          version: 2,
          bot_verdict: "passed",
          client_ip_masked: "127.0.0.0/24",
          normalized_email_hmac: "0".repeat(64),
          created_at: new Date().toISOString(),
          shipping_address_override_confirmed: false,
          device_session_id: randomUUID(),
          payment_method: "card",
        },
        items,
      });
      const reserve = async (c, r) =>
        (await c.query("select reserve_checkout_inventory_v2($1) decision", [r])).rows[0]
          .decision;
      const contend = (variant, requests) =>
        raceAtRowLock(
          admin,
          [a, b],
          (c) =>
            c.query("select id from product_variants where id=$1 for update", [
              variant.variantId,
            ]),
          (client, index) => reserve(client, requests[index]),
        );
      const stock = async (i) =>
        (
          await admin.query(
            "select stock,(select count(*)::int from inventory_reservations where variant_id=$1) holds from product_variants where id=$1",
            [i.variantId],
          )
        ).rows[0];
      await t.test(
        "stock_one_loser_gets_its_exact_conflict_without_partial_allocation",
        async () => {
          const scarce = await item(),
            left = await item(),
            right = await item();
          const baskets = [
              [left, scarce],
              [scarce, right],
            ],
            requests = baskets.map((basket, index) => ({
              ...req(basket),
              ownerBinding: "guest:" + (index ? "a" : "b").repeat(64),
            }));
          const results = await contend(scarce, requests);
          const loser = results.findIndex((r) => r.status === "rejected");
          assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
          assert.equal(results[loser].reason.code, "PC409");
          assert.deepEqual(JSON.parse(results[loser].reason.detail), [
            {
              productId: scarce.productId,
              variantId: scarce.variantId,
              requestedQuantity: 1,
              availableQuantity: 0,
              reason: "reserved_by_other",
            },
          ]);
          assert.deepEqual(await stock(scarce), { stock: 0, holds: 1 });
          assert.deepEqual(await stock(loser === 0 ? left : right), {
            stock: 1,
            holds: 0,
          });
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from orders where idempotency_key=$1",
                [requests[loser].idempotencyKey],
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await t.test("reversed overlapping baskets lock consistently", async () => {
        const x = await item(),
          y = await item();
        const res = await contend(x, [req([x, y]), req([y, x])]);
        assert.deepEqual(
          res.map((r) => (r.status === "rejected" ? r.reason.code : r.value.kind)).sort(),
          ["PC409", "reserved"],
        );
        assert.deepEqual(await stock(x), { stock: 0, holds: 1 });
        assert.deepEqual(await stock(y), { stock: 0, holds: 1 });
      });
      await t.test(
        "racing owned key resumes once and rejects different cart, principal, device and expired hold",
        async () => {
          const x = await item(),
            r = req([x]);
          const res = completedValues(await contend(x, [r, r]));
          assert.deepEqual(res.map((v) => v.reused).sort(), [false, true]);
          assert.equal(res[0].orderId, res[1].orderId);
          const id = res[0].orderId;
          assert.deepEqual(
            (
              await admin.query(
                "select checkout_attempt_guarded guarded, checkout_guest_context_hash hash,round(total*100)::int cents,extract(epoch from expires_at-created_at) seconds from orders where id=$1",
                [id],
              )
            ).rows.map(({ seconds, ...o }) => ({
              ...o,
              inWindow: Math.abs(Number(seconds) - 900) < 2,
            })),
            [{ guarded: true, hash: "a".repeat(64), cents: 1080, inWindow: true }],
          );
          for (const change of [
            { cartHash: "c".repeat(64) },
            { billingAddress: { ...r.billingAddress, line1: "124 Main St" } },
            { pickupContact: { ...r.pickupContact, name: "Another Buyer" } },
            { ownerBinding: "guest:" + "f".repeat(64) },
            {
              protectionEvidence: {
                ...r.protectionEvidence,
                device_session_id: randomUUID(),
              },
            },
            { taxCents: 81, totalCents: 1081 },
          ])
            await assert.rejects(reserve(b, { ...r, ...change }), { code: "PC410" });
          await admin.query("update orders set expires_at=now() where id=$1", [id]);
          await assert.rejects(reserve(a, r), { code: "PC410" });
          assert.deepEqual(await stock(x), { stock: 0, holds: 1 });
        },
      );
      await t.test(
        "same key with competing baskets reserves exactly the winning basket",
        async () => {
          const x = await item(),
            y = await item(),
            r = req([x]);
          const requests = [r, { ...r, cartHash: "c".repeat(64), items: [y] }];
          const result = await raceAtRowLock(
            admin,
            [a, b],
            (c) =>
              c.query("select pg_advisory_xact_lock(hashtextextended($1,713))", [
                r.idempotencyKey,
              ]),
            (client, index) => reserve(client, requests[index]),
            async (holder, pids) => {
              const waiting = await holder.query(
                `select distinct waiter.pid from pg_locks holder join pg_locks waiter
                  using (locktype,database,classid,objid,objsubid,mode)
                  where holder.pid=pg_backend_pid() and holder.granted and holder.locktype='advisory'
                    and not waiter.granted and waiter.pid=any($1::int[])`,
                [pids],
              );
              assert.deepEqual(
                new Set(waiting.rows.map((row) => row.pid)),
                new Set(pids),
                "both reservation sessions must wait on the held idempotency key",
              );
            },
          );
          const wins = result.map((v) => v.status === "fulfilled");
          assert.equal(wins.filter(Boolean).length, 1);
          assert.equal(result[wins[0] ? 1 : 0].reason.code, "PC410");
          assert.deepEqual(await stock(wins[0] ? x : y), { stock: 0, holds: 1 });
          assert.deepEqual(await stock(wins[0] ? y : x), { stock: 1, holds: 0 });
        },
      );
      await t.test(
        "shipping holds use the locked category rate and immutable address",
        async () => {
          const x = await item(),
            r = req([x]);
          await admin.query(
            "insert into shipping_defaults(tenant_id,category,shipping_cost_cents,default_weight_oz,default_length_in,default_width_in,default_height_in) values ($1,'accessories',500,16,12,10,8) on conflict(tenant_id,category) do update set shipping_cost_cents=500",
            [tenantId],
          );
          Object.assign(r, {
            fulfillment: "ship",
            pickupContact: null,
            shippingCents: 400,
            totalCents: 1480,
            shippingAddress: {
              name: "Buyer",
              line1: "123 Main St",
              phone: "5555555555",
              city: "Charleston",
              state: "SC",
              postalCode: "29401",
              country: "US",
            },
          });
          await assert.rejects(reserve(a, r), { code: "PC410" });
          assert.deepEqual(await stock(x), { stock: 1, holds: 0 });
          Object.assign(r, { shippingCents: 500, totalCents: 1580 });
          const first = await reserve(a, r);
          assert.equal((await reserve(b, r)).orderId, first.orderId);
          await assert.rejects(
            reserve(b, {
              ...r,
              shippingAddress: { ...r.shippingAddress, line1: "124 Main St" },
            }),
            { code: "PC410" },
          );
        },
      );
      await t.test(
        "release queues behind the catalog parent before touching the variant",
        async () => {
          const x = await item(2),
            held = await reserve(a, req([x]));
          assert.equal(
            (
              await a.query("select reject_checkout_quote_before_attach($1,$2) ok", [
                held.orderId,
                req([x]).ownerBinding,
              ])
            ).rows[0].ok,
            true,
          );
          const heldPid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
          await a.query("begin");
          let release;
          try {
            await a.query("select id from products where id=$1 for update", [
              x.productId,
            ]);
            release = b.query(
              "select release_square_checkout_reservation($1,'square_order_totals_changed') released",
              [held.orderId],
            );
            const deadline = Date.now() + 5000;
            while (
              !(
                await admin.query("select cardinality(pg_blocking_pids($1))>0 waiting", [
                  heldPid,
                ])
              ).rows[0].waiting
            ) {
              if (Date.now() > deadline)
                throw Error("release did not reach locked parent");
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            // NOWAIT distinguishes the old inverted order without creating a deadlock.
            await a.query(
              "select id from product_variants where id=$1 for update nowait",
              [x.variantId],
            );
            const fresh = await reserve(a, req([x]));
            assert.equal(fresh.reused, false);
            await a.query("commit");
          } finally {
            await a.query("rollback");
            if (release) assert.equal((await release).rows[0].released, true);
          }
          assert.deepEqual(await stock(x), { stock: 1, holds: 2 });
        },
      );
      await t.test(
        "partial stock, same principal, expired or ambiguous holds get no other-shopper attribution",
        async () => {
          const x = await item(3),
            own = req([x]),
            held = await reserve(a, own),
            other = "guest:" + "e".repeat(64);
          const demand = (n, ownerBinding) => ({
            ...req([{ ...x, quantity: n, lineTotalCents: 1000 * n }]),
            ownerBinding,
            subtotalCents: 1000 * n,
            totalCents: 1000 * n + 80,
          });
          const reason = async (r, expected) =>
            assert.rejects(
              reserve(b, r),
              (e) =>
                e.code === "PC409" &&
                JSON.parse(e.detail)[0].reason === expected &&
                JSON.parse(e.detail)[0].availableQuantity === 2,
            );
          await reason(demand(5, other), "unavailable");
          await reason(demand(3, own.ownerBinding), "unavailable");
          await reason(demand(3, other), "reserved_by_other");
          await reason(
            { ...demand(3, other), otherGuestContexts: [own.ownerBinding.slice(6)] },
            "unavailable",
          );
          const check = {
            version: 2,
            action: "inspect",
            tenantId,
            idempotencyKey: randomUUID(),
            items: [{ productId: x.productId, variantId: x.variantId, quantity: 3 }],
          };
          await reason(check, "unavailable");
          await reason({ ...check, ownerBinding: other }, "reserved_by_other");
          await admin.query("update orders set expires_at=now() where id=$1", [
            held.orderId,
          ]);
          await reason(demand(3, other), "unavailable");
          await admin.query(
            "update orders set expires_at=now()+interval '10 minutes' where id=$1",
            [held.orderId],
          );
          await admin.query(
            "update inventory_reservations set expires_at=now()-interval '1 minute' where order_id=$1",
            [held.orderId],
          );
          await reason(demand(3, other), "unavailable");
        },
      );
      await t.test("signed-in ownership and legacy proof stay immutable", async () => {
        const { userId } = await seedOrder();
        const x = await item();
        const r = {
          ...req([x]),
          userId,
          guestEmail: null,
          ownerBinding: "account:" + userId,
        };
        const o = await reserve(a, r);
        assert.equal((await reserve(b, r)).orderId, o.orderId);
        const other = (await seedOrder()).userId;
        await assert.rejects(
          reserve(b, { ...r, userId: other, ownerBinding: "account:" + other }),
          { code: "PC410" },
        );
        const legacy = (await seedOrder({ userId: null })).orderId;
        const key = randomUUID();
        await admin.query(
          "update orders set idempotency_key=$2,cart_hash=$3 where id=$1",
          [legacy, key, r.cartHash],
        );
        await assert.rejects(reserve(b, { ...req([x]), idempotencyKey: key }), {
          code: "PC410",
        });
        assert.deepEqual(
          (
            await admin.query(
              "select checkout_attempt_guarded guarded,checkout_guest_context_hash hash from orders where id=$1",
              [legacy],
            )
          ).rows[0],
          { guarded: false, hash: null },
        );
      });
      await t.test(
        "catalog price and eligibility are rechecked at allocation",
        async () => {
          const x = await item(),
            r = req([x]);
          await admin.query(
            "update product_variants set sale_price_cents=1100 where id=$1",
            [x.variantId],
          );
          await assert.rejects(reserve(a, r), { code: "PC410" });
          await admin.query("update products set is_active=false where id=$1", [
            x.productId,
          ]);
          await assert.rejects(
            reserve(a, r),
            (e) => e.code === "PC409" && JSON.parse(e.detail)[0].reason === "unavailable",
          );
          assert.deepEqual(await stock(x), { stock: 1, holds: 0 });
        },
      );
      await t.test(
        "preparation enqueues one expiry, freezes the quote through issuance and dispatch",
        async () => {
          const x = await item(),
            r = req([x]);
          const { orderId } = await reserve(a, r);
          await reserve(b, r);
          assert.deepEqual(
            (
              await admin.query(
                "select j.unique_key,j.reason,j.next_attempt_at=o.expires_at due from checkout_recovery_jobs j join orders o on o.id=j.order_id where o.id=$1",
                [orderId],
              )
            ).rows,
            [
              {
                unique_key: "expire_reservation:" + orderId,
                reason: "reservation_expiring",
                due: true,
              },
            ],
          );
          const attach = async (tax, total) =>
            (
              await a.query(
                "select attach_square_checkout_order($1,'fixture-square',1,0,$2,$3,'square:fixture:v1') ok",
                [orderId, tax, total],
              )
            ).rows[0].ok;
          assert.equal(await attach(80, 1080), true);
          const attempt = (
            await a.query(
              "select get_or_create_checkout_payment_attempt($1,'card',$2) val",
              [orderId, r.ownerBinding],
            )
          ).rows[0].val;
          assert.equal(attempt.amountCents, 1080);
          assert.equal(attempt.state, "ready");
          const dispatch = (
            await a.query("select begin_checkout_payment_dispatch($1,$2,$3,$4) val", [
              attempt.id,
              r.ownerBinding,
              "1".repeat(64),
              "2".repeat(64),
            ])
          ).rows[0].val;
          assert.equal(dispatch.kind, "dispatch");
          assert.equal(await attach(81, 1081), false);
          await assert.rejects(reserve(b, { ...r, taxCents: 81, totalCents: 1081 }), {
            code: "PC410",
          });
          await assert.rejects(
            reserve(b, {
              version: 2,
              action: "inspect",
              tenantId,
              idempotencyKey: r.idempotencyKey,
              items: [{ productId: x.productId, variantId: x.variantId, quantity: 1 }],
            }),
            { code: "PC410" },
          );
          assert.equal(
            (
              await admin.query("select total*100 cents from orders where id=$1", [
                orderId,
              ])
            ).rows[0].cents,
            "1080.00",
          );
        },
      );
      await t.test(
        "late reservation insert fault rolls back stock, rows and recovery work",
        async () => {
          const x = await item(),
            y = await item();
          const sorted = [x, y].sort((l, r) => l.variantId.localeCompare(r.variantId));
          const bad = sorted[1].variantId;
          await admin.query(
            "create function checkout_hardening_fixture.fail_task7_insert() returns trigger language plpgsql as $fixture$ begin if new.variant_id=TG_ARGV[0]::uuid then raise exception 'fixture_write_failure'; end if; return new; end $fixture$",
          );
          await admin.query(
            "create trigger task7_fixture_failure before insert on inventory_reservations for each row execute function checkout_hardening_fixture.fail_task7_insert('" +
              bad +
              "')",
          );
          const r = req(sorted);
          try {
            await assert.rejects(reserve(a, r), { code: "P0001" });
          } finally {
            await admin.query(
              "drop trigger task7_fixture_failure on inventory_reservations",
            );
          }
          assert.deepEqual(await stock(x), { stock: 1, holds: 0 });
          assert.deepEqual(await stock(y), { stock: 1, holds: 0 });
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from orders where idempotency_key=$1",
                [r.idempotencyKey],
              )
            ).rows[0].n,
            0,
          );
          const ok = await reserve(b, r);
          assert.equal(ok.reused, false);
        },
      );
      await t.test(
        "concurrent quote rejection and attachment are mutually exclusive",
        async () => {
          for (const first of ["attach", "reject"]) {
            const x = await item(),
              r = req([x]),
              o = await reserve(a, r);
            const attach = async (c) =>
              (
                await c.query(
                  "select attach_square_checkout_order($1::uuid,'sq-'||($1::uuid)::text,1,0,80,1080,'square:race:v1') ok",
                  [o.orderId],
                )
              ).rows[0].ok;
            const reject = async (c) =>
              (
                await c.query("select reject_checkout_quote_before_attach($1,$2) ok", [
                  o.orderId,
                  r.ownerBinding,
                ])
              ).rows[0].ok;
            await a.query("begin");
            let other;
            try {
              assert.equal(await (first === "attach" ? attach(a) : reject(a)), true);
              other = first === "attach" ? reject(b) : attach(b);
              await a.query("commit");
            } catch (error) {
              await a.query("rollback");
              throw error;
            }
            assert.equal(await other, false);
            if (first === "reject") {
              assert.equal(await reject(a), true);
              await assert.rejects(reserve(a, r), { code: "PC410" });
              await assert.rejects(
                a.query("select get_or_create_checkout_payment_attempt($1,'card',$2)", [
                  o.orderId,
                  r.ownerBinding,
                ]),
                /checkout_order_not_payable/,
              );
              for (const expected of [true, false]) {
                assert.equal(
                  (
                    await b.query(
                      "select release_square_checkout_reservation($1,'square_order_totals_changed') ok",
                      [o.orderId],
                    )
                  ).rows[0].ok,
                  expected,
                );
              }
              assert.equal((await stock(x)).stock, 1);
            } else {
              assert.equal(
                (
                  await b.query(
                    "select release_square_checkout_reservation($1,'square_order_totals_changed') ok",
                    [o.orderId],
                  )
                ).rows[0].ok,
                false,
              );
              assert.deepEqual(await stock(x), { stock: 0, holds: 1 });
            }
          }
        },
      );
      await t.test(
        "both historical overloads resume their old unguarded order",
        async () => {
          const x = await item(),
            key = randomUUID(),
            catalog = { owner: tenantId, product: x.productId, variant: x.variantId };
          const legacy = await reserveLegacy(a, catalog, { legacy: true, key });
          const compat = await reserveLegacy(b, catalog, { key });
          assert.equal(compat.order_id, legacy.order_id);
          assert.equal(compat.reused, true);
          assert.deepEqual(
            (
              await admin.query(
                "select checkout_attempt_guarded guarded,checkout_guest_context_hash hash from orders where id=$1",
                [legacy.order_id],
              )
            ).rows[0],
            { guarded: false, hash: null },
          );
          await assert.rejects(reserve(a, { ...req([x]), idempotencyKey: key }), {
            code: "PC410",
          });
        },
      );
      await t.test(
        "loopback prepare returns the PostgreSQL conflict, leaves the winning checkout intact",
        async () => {
          const x = await item(),
            fixture = req([x]);
          const secret = "task-seven-local-identity-fixture-secret";
          const prior = process.env.CHECKOUT_IDENTITY_HMAC_SECRET;
          process.env.CHECKOUT_IDENTITY_HMAC_SECRET = secret;
          const server = createServer(async (incoming, outgoing) => {
            try {
              const chunks = [];
              for await (const chunk of incoming) chunks.push(chunk);
              const request = new Request("http://127.0.0.1" + incoming.url, {
                method: "POST",
                headers: incoming.headers,
                body: Buffer.concat(chunks),
              });
              const cart = { items: [x], subtotalCents: 1000 },
                totals = {
                  subtotalCents: 1000,
                  shippingCents: 0,
                  taxCents: 80,
                  totalCents: 1080,
                };
              const deps = {
                findTenantId: async () => tenantId,
                getAccess: async () => ({ open: true }),
                verifyBrowser: async () => ({ allowed: true, reason: "passed" }),
                resolveCart: async () => cart,
                quote: async () => ({ customerState: "SC", shippingCents: 0 }),
                calculateSquareOrder: async () => totals,
                reportError: (error) => {
                  throw error;
                },
              };
              const db = await connect("service_role");
              const repo = new CheckoutPreparationRepository({
                rpc: async (_, args) => {
                  try {
                    return { data: await reserve(db, args.p_request), error: null };
                  } catch (e) {
                    return {
                      data: null,
                      error: { code: e.code, details: e.detail, message: e.message },
                    };
                  }
                },
              });
              const response =
                incoming.url === "/quote"
                  ? await checkoutQuoteHandler(request, deps)
                  : await prepareCheckoutHandler(request, {
                      ...deps,
                      getClientIp: () => "127.0.0.1",
                      getSession: async () => null,
                      hashEmail: () => "b".repeat(64),
                      shippingConfirmationSecret: () => secret,
                      now: () => new Date(),
                      getSquareClientConfig: () => ({}),
                      findExisting: async () => null,
                      checkAttempt: async () => ({ allowed: true }),
                      reserve: (input) => repo.reserveCheckout(input),
                      createSquareOrder: async () => ({
                        ...totals,
                        id: "square-fixture",
                        version: 1,
                        taxCalculationId: "square:fixture:v1",
                      }),
                      attachSquareOrder: (id) =>
                        db.query(
                          "select attach_square_checkout_order($1,'square-fixture',1,0,80,1080,'square:fixture:v1')",
                          [id],
                        ),
                      createGuestAccessToken: async () => "fixture-order-grant",
                    });
              outgoing.writeHead(response.status, Object.fromEntries(response.headers));
              outgoing.end(await response.text());
            } catch {
              outgoing.writeHead(500);
              outgoing.end();
            }
          });
          try {
            server.listen(0, "127.0.0.1");
            await once(server, "listening");
            const url = "http://127.0.0.1:" + server.address().port;
            const body = {
              items: [{ productId: x.productId, variantId: x.variantId, quantity: 1 }],
              fulfillment: "pickup",
              shippingAddress: null,
            };
            const post = (path, json, cookie = "") =>
              fetch(url + path, {
                method: "POST",
                headers: { "content-type": "application/json", cookie },
                body: JSON.stringify(json),
              });
            const quotes = await Promise.all([
              post("/quote", body),
              post("/quote", body),
            ]);
            const results = await Promise.all(
              quotes.map(async (q) => {
                assert.equal(q.status, 200);
                const cookie = q.headers.get("set-cookie").split(";")[0];
                const { quoteFingerprint } = await q.json();
                return post(
                  "/prepare",
                  {
                    ...body,
                    deviceSessionId: randomUUID(),
                    idempotencyKey: randomUUID(),
                    quoteFingerprint,
                    buyerEmail: fixture.guestEmail,
                    paymentMethod: "card",
                    billingAddress: fixture.billingAddress,
                    pickupContact: fixture.pickupContact,
                  },
                  cookie,
                );
              }),
            );
            assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
            const losing = results.find((r) => r.status === 409);
            assert.equal(losing.headers.get("cache-control"), "no-store");
            assert.deepEqual(await losing.json(), {
              code: "INVENTORY_CONFLICT",
              paymentState: "not_submitted",
              conflicts: [
                {
                  productId: x.productId,
                  variantId: x.variantId,
                  requestedQuantity: 1,
                  availableQuantity: 0,
                  reason: "reserved_by_other",
                },
              ],
            });
            assert.deepEqual(await stock(x), { stock: 0, holds: 1 });
          } finally {
            if (prior === undefined) delete process.env.CHECKOUT_IDENTITY_HMAC_SECRET;
            else process.env.CHECKOUT_IDENTITY_HMAC_SECRET = prior;
            await new Promise((done) => server.close(done));
          }
        },
      );
      await t.test(
        "service-only versioned request refuses bad quantities and extra evidence",
        async () => {
          const x = await item(),
            r = req([x]);
          for (const c of [await connect("anon"), await connect("authenticated")])
            await assert.rejects(reserve(c, r), { code: "42501" });
          for (const bad of [
            { version: 3 },
            {
              items: Array.from({ length: 11 }, () => ({
                ...x,
                variantId: randomUUID(),
              })),
            },
            { items: [{ ...x, quantity: 6 }] },
            { items: [x, x] },
            { protectionEvidence: { ...r.protectionEvidence, unknown: "fixture" } },
          ])
            await assert.rejects(reserve(a, { ...r, ...bad }), { code: "22023" });
          assert.deepEqual(await stock(x), { stock: 1, holds: 0 });
        },
      );
    },
  );
});
