import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("tsx/cjs");
const {
  SquareFinancialInquiry,
} = require("../../../Source/Features/Payments/square-financial-inquiry.ts");
const {
  runCheckoutRecovery,
} = require("../../../Source/Features/Recovery/recovery-worker.ts");
import { randomUUID } from "node:crypto";
import {
  completedValues,
  raceAtRowLock,
  withCheckoutDatabase,
} from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";
test("expiry fences dispatch and conserves stock across independently committed financial decisions", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder, seedCatalog, withPostgrest }) => {
      const a = await connect("service_role"),
        b = await connect("service_role");
      const rpc = async (c, sql, args) =>
        (await c.query("select " + sql + " result", args)).rows[0].result;
      async function held(guarded = true) {
        const template = await seedOrder(),
          id = randomUUID(),
          sq = "sq-" + id;
        const { productId, variantId } = await seedCatalog({ stock: 0 });
        await admin.query(
          "insert into orders(id,tenant_id,user_id,status,subtotal,shipping,total,currency,fulfillment,expires_at,cart_hash,square_order_id,checkout_attempt_guarded) select $1,tenant_id,user_id,status,subtotal,shipping,total,currency,fulfillment,now()+interval '15 min','cart',$3,$4 from orders where id=$2",
          [id, template.orderId, sq, guarded],
        );
        await admin.query(
          "insert into order_items(order_id,product_id,variant_id,quantity,unit_price,line_total) values ($1,$2,$3,1,10,10)",
          [id, productId, variantId],
        );
        await admin.query(
          "insert into inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,expires_at from orders where id=$1",
          [id, variantId],
        );
        return { id, sq, variantId, binding: "account:" + template.userId };
      }
      async function runFixtureWorker(
        o,
        attempt,
        pay,
        eventId = null,
        version = "first",
        time = new Date().toISOString(),
        paymentOverrides = {},
        orderLookupUnavailable = false,
      ) {
        const commands = [];
        const db = {
          from(table) {
            assert.ok(
              [
                "orders",
                "checkout_payment_attempts",
                "square_webhook_events",
                "square_refunds",
              ].includes(table),
            );
            const conditions = [],
              values = [];
            const read = async () =>
              table === "orders" && orderLookupUnavailable
                ? { data: null, error: { code: "08006" } }
                : {
                    data:
                      (
                        await a.query(
                          "select * from " + table + " where " + conditions.join(" and "),
                          values,
                        )
                      ).rows[0] ?? null,
                    error: null,
                  };
            const q = {
              select() {
                return q;
              },
              eq(field, value) {
                assert.ok(
                  [
                    "order_id",
                    "id",
                    "square_order_id",
                    "square_event_id",
                    "square_payment_id",
                    "square_refund_id",
                  ].includes(field),
                );
                values.push(value);
                conditions.push(field + "=$" + values.length);
                return q;
              },
              update(fields) {
                assert.equal(table, "orders");
                assert.deepEqual(fields, {
                  checkout_financial_review: "square_evidence_conflict",
                });
                return q;
              },
              async is(field, value) {
                assert.equal(table, "orders");
                assert.equal(field, "checkout_financial_review");
                assert.equal(value, null);
                assert.deepEqual(conditions, ["id=$1"]);
                await a.query(
                  "update orders set checkout_financial_review='square_evidence_conflict' where id=$1 and checkout_financial_review is null",
                  values,
                );
                return { error: null };
              },
              single: read,
              maybeSingle: read,
            };
            return q;
          },
          async rpc(name, args) {
            commands.push(name);
            const signatures = {
              record_checkout_terminal_capture: [
                "p_attempt_id",
                "p_square_order_id",
                "p_reference_id",
                "p_method",
                "p_fact",
                "p_provider_time",
              ],
              record_checkout_payment_outcome: [
                "p_attempt_id",
                "p_provider_payment_id",
                "p_state",
                "p_verified_facts",
              ],
              apply_checkout_financial_fact: ["p_fact", "p_provider_time", "p_review"],
              apply_checkout_payment_with_analytics: [
                "p_fact",
                "p_provider_time",
                "p_source",
                "p_review",
              ],
              record_square_payment_details: [
                "p_square_order_id",
                "p_square_payment_id",
                "p_payment_status",
                "p_amount_cents",
                "p_currency",
                "p_details",
              ],
            };
            assert.ok(signatures[name]);
            const params = signatures[name];
            return {
              data: await rpc(
                a,
                name + "(" + params.map((_, i) => "$" + (i + 1)).join(",") + ")",
                params.map((k) => args[k] ?? null),
              ),
              error: null,
            };
          },
        };
        const money = { currency: "USD", amount: 1000n };
        let creates = 0;
        const sdk = {
          refunds: {
            get: async ({ refundId }) => ({
              refund: {
                id: refundId,
                paymentId: pay,
                orderId: "return-order",
                locationId: "location",
                amountMoney: { currency: "USD", amount: 300n },
                updatedAt: time,
                status: "COMPLETED",
              },
            }),
          },
          orders: {
            get: async () => ({
              order: {
                id: o.sq,
                referenceId: o.id,
                locationId: "location",
                totalMoney: money,
                tenders: [{ paymentId: pay }],
              },
            }),
          },
          locations: {
            get: async () => ({ location: { id: "location", merchantId: "merchant" } }),
          },
          payments: {
            create: () => {
              creates++;
              throw Error("unexpected create");
            },
            get: async () => ({
              payment: {
                id: pay,
                orderId: o.sq,
                referenceId: attempt.id,
                locationId: "location",
                sourceType: "CARD",
                amountMoney: money,
                createdAt: time,
                status: "COMPLETED",
                versionToken: version,
                ...paymentOverrides,
              },
            }),
          },
        };
        const inquiry = new SquareFinancialInquiry(
          db,
          sdk,
          { merchantId: "merchant", locationId: "location" },
          { syncShipping: async () => {}, scheduleNotifications: () => {} },
          false,
        );
        const metrics = await runCheckoutRecovery(
          { batchSize: 50, concurrency: 1, deadlineMs: 45000 },
          {
            sweep: async () => {},
            oldestDueMs: async () => 0,
            claimRecovery: ({ limit }) =>
              rpc(b, "claim_checkout_recovery($1,120,clock_timestamp())", [limit]),
            finishRecovery: (j) =>
              rpc(b, "finish_checkout_recovery($1,$2,$3,$4,$5)", [
                j.id,
                j.leaseToken,
                j.result,
                j.nextAttemptAt,
                j.reason,
              ]),
            acquireDependencyLease: () =>
              rpc(b, "acquire_checkout_dependency_lease('square',4,120)", []),
            releaseDependencyLease: (t) =>
              rpc(b, "release_checkout_dependency_lease($1)", [t]),
            process: async (j) =>
              j.eventId && j.eventId === eventId
                ? inquiry.processStoredSquareEvent(j.eventId).then(() => "done")
                : j.orderId === o.id
                  ? inquiry.recoverAttempt(o.id, attempt.id)
                  : "retry",
          },
        );
        return { metrics, creates, commands };
      }
      await t.test(
        "immutable receipt contradictions retain review and protect only independently bound orders",
        async () => {
          for (const mode of [
            "foreign",
            "malformed",
            "binding",
            "unmatched",
            "unavailable",
          ]) {
            const o = await held(),
              eventId = randomUUID(),
              pay = "pay-" + o.id,
              time = new Date().toISOString();
            const at = await rpc(
              a,
              "get_or_create_checkout_payment_attempt($1,'card',$2)",
              [o.id, o.binding],
            );
            const providerOrder =
              mode === "unmatched" ? { ...o, sq: "external-" + o.id } : o;
            const payload = {
              merchantId: mode === "foreign" ? "other" : "merchant",
              locationId: "location",
              createdAt: time,
              paymentId: pay,
              squareOrderId: providerOrder.sq,
            };
            await rpc(a, "receive_checkout_square_event($1,'payment.updated',$2,$3)", [
              eventId,
              "d".repeat(64),
              payload,
            ]);
            if (mode === "malformed")
              await admin.query(
                "update square_webhook_events set event_data=event_data-'createdAt' where square_event_id=$1",
                [eventId],
              );
            const run = await runFixtureWorker(
              providerOrder,
              at,
              pay,
              eventId,
              "opaque",
              time,
              mode === "binding"
                ? { amountMoney: { amount: 1100n, currency: "USD" } }
                : {},
              mode === "unavailable",
            );
            assert.deepEqual(run.commands, []);
            assert.equal(run.creates, 0);
            const state = await admin.query(
              "select e.processed_at,j.status,j.reason,j.unresolved_observations,o.checkout_financial_review,(select count(*) from checkout_financial_facts where order_id=o.id)::int facts from square_webhook_events e join checkout_recovery_jobs j on j.event_id=e.square_event_id cross join orders o where e.square_event_id=$1 and o.id=$2",
              [eventId, o.id],
            );
            assert.deepEqual(state.rows[0], {
              processed_at: null,
              status: mode === "unavailable" ? "pending" : "review",
              reason:
                mode === "unavailable"
                  ? "recovery_unavailable"
                  : "square_evidence_conflict",
              unresolved_observations: 0,
              checkout_financial_review:
                mode === "binding" ? "square_evidence_conflict" : null,
              facts: 0,
            });
          }
        },
      );
      for (const terminal of ["declined", "canceled"]) {
        await t.test(
          "retains terminal " +
            terminal +
            " history and projects independently corroborated money under financial review",
          async () => {
            const o = await held(),
              at = await rpc(a, "get_or_create_checkout_payment_attempt($1,'card',$2)", [
                o.id,
                o.binding,
              ]);
            await rpc(a, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
              at.id,
              o.binding,
              "a".repeat(64),
              "b".repeat(64),
            ]);
            const pay = "pay-" + o.id,
              priorStatus = terminal === "canceled" ? "CANCELED" : "FAILED";
            const facts = {
              kind: "square_payment",
              orderId: o.id,
              squareOrderId: o.sq,
              paymentId: pay,
              status: priorStatus,
              amountCents: 1000,
              currency: "USD",
            };
            assert.equal(
              await rpc(
                b,
                "release_square_checkout_reservation($1,'some_other_reason')",
                [o.id],
              ),
              false,
            );
            await rpc(a, "record_checkout_payment_outcome($1,$2,$3,$4)", [
              at.id,
              pay,
              terminal,
              facts,
            ]);
            const fact = {
              kind: "payment",
              orderId: o.id,
              providerId: pay,
              paymentId: pay,
              providerVersion: "same-opaque",
              status: priorStatus,
              amountCents: 1000,
              expectedTotalCents: 1000,
              currency: "USD",
              fulfillmentStatus: "unfulfilled",
            };
            await rpc(a, "apply_checkout_financial_fact($1,now())", [fact]);
            let ready;
            if (terminal === "declined") {
              await admin.query(
                "update inventory_reservations set status='released',released_at=now() where order_id=$1",
                [o.id],
              );
              await admin.query("update product_variants set stock=1 where id=$1", [
                o.variantId,
              ]);
            } else {
              ready = await rpc(
                a,
                "get_or_create_checkout_payment_attempt($1,'card',$2)",
                [o.id, o.binding],
              );
            }
            const captured = { ...fact, status: "COMPLETED" },
              time = new Date().toISOString();
            const record = (f, ref = at.id, sq = o.sq) =>
              rpc(b, "record_checkout_terminal_capture($1,$2,$3,$4,$5,$6)", [
                at.id,
                sq,
                ref,
                "card",
                f,
                time,
              ]);
            await assert.rejects(record({ ...captured, amountCents: 1100 }));
            await assert.rejects(record(captured, randomUUID()));
            await assert.rejects(record(captured, at.id, "different-order"));
            const eventId = randomUUID();
            await rpc(a, "receive_checkout_square_event($1,'payment.updated',$2,$3)", [
              eventId,
              "c".repeat(64),
              {
                merchantId: "merchant",
                locationId: "location",
                createdAt: time,
                paymentId: pay,
                squareOrderId: o.sq,
              },
            ]);
            const delivered = await runFixtureWorker(
              o,
              at,
              pay,
              eventId,
              "same-opaque",
              time,
            );
            assert.equal(delivered.creates, 0);
            assert.ok(delivered.metrics.review >= 1);
            assert.ok(
              !delivered.commands.includes("get_or_create_checkout_payment_attempt"),
            );
            assert.equal(
              (
                await admin.query(
                  "select processed_at from square_webhook_events where square_event_id=$1",
                  [eventId],
                )
              ).rows[0].processed_at,
              null,
            );
            assert.equal(
              (
                await admin.query(
                  "select status from checkout_recovery_jobs where event_id=$1",
                  [eventId],
                )
              ).rows[0].status,
              "review",
            );
            let snap = await record(captured);
            assert.equal(snap.capturedCents, 1000);
            assert.equal(snap.reviewReason, "square_terminal_capture_conflict");
            assert.deepEqual(await record(captured), snap);
            if (terminal === "declined") {
              const refundId = "refund-" + o.id;
              for (let replay = 0; replay < 2; replay++) {
                const refundEvent = randomUUID();
                await rpc(a, "receive_checkout_square_event($1,'refund.updated',$2,$3)", [
                  refundEvent,
                  "e".repeat(64),
                  {
                    refundId,
                    merchantId: "merchant",
                    locationId: "location",
                    createdAt: time,
                    paymentId: pay,
                  },
                ]);
                const observed = await runFixtureWorker(
                  o,
                  at,
                  pay,
                  refundEvent,
                  "same-opaque",
                  time,
                );
                assert.equal(observed.metrics.review, 1);
                assert.equal(observed.creates, 0);
              }
              snap = await record(captured);
              assert.equal(snap.refundedCents, 300);
              assert.equal(snap.financialState, "partially_refunded");
            } else
              snap = await rpc(b, "apply_checkout_financial_fact($1,$2)", [
                { ...captured, providerVersion: "later-opaque" },
                time,
              ]);
            const historyCount = () =>
              rpc(
                admin,
                "(select count(*)::int from checkout_payment_attempt_history where attempt_id=$1)",
                [at.id],
              );
            const beforeReplay = await historyCount();
            assert.equal(
              (
                await rpc(a, "record_checkout_payment_outcome($1,$2,$3,$4)", [
                  at.id,
                  pay,
                  terminal,
                  facts,
                ])
              ).state,
              terminal,
            );
            assert.equal(await historyCount(), beforeReplay);
            assert.deepEqual(await record(captured), snap);
            assert.equal(snap.capturedCents, 1000);
            assert.equal(snap.reviewReason, "square_terminal_capture_conflict");
            const {
              rows: [ledger],
            } = await admin.query("select * from checkout_payment_attempts where id=$1", [
              at.id,
            ]);
            assert.equal(ledger.state, terminal);
            assert.equal(ledger.square_idempotency_key, at.squareIdempotencyKey);
            const {
              rows: [{ data: order }],
            } = await admin.query(
              "select to_jsonb(o) as data from orders o where id=$1",
              [o.id],
            );
            const { rows: observations } = await admin.query(
              "select * from checkout_financial_facts where order_id=$1",
              [o.id],
            );
            assert.ok(observations.some((f) => f.status === priorStatus));
            if (terminal === "declined")
              assert.ok(
                !observations.some(
                  (f) => f.kind === "payment" && f.status === "COMPLETED",
                ),
              );
            assert.equal(ledger.terminal_capture.status, "COMPLETED");
            const { rows: allAttempts } = await admin.query(
              "select * from checkout_payment_attempts where order_id=$1",
              [o.id],
            );
            // PostgREST sends JSON numbers for bigint cents. The pg wire driver returns strings.
            const { rows: refundRows } = await admin.query(
              "select to_jsonb(r) as data from square_refunds r where order_id=$1",
              [o.id],
            );
            const refunds = refundRows.map((r) => r.data);
            assert.equal(refunds.length, terminal === "declined" ? 1 : 0);
            const composite = {
              ...order,
              facts: observations,
              factCount: [{ count: observations.length }],
              attempts: allAttempts,
              attemptCount: [{ count: allAttempts.length }],
              refunds,
              refundCount: [{ count: refunds.length }],
            };
            const read = {
              select() {
                return this;
              },
              eq() {
                return this;
              },
              maybeSingle() {
                return { data: composite, error: null };
              },
            };
            const {
              readOrderFinancialEvidence,
            } = require("../../../../Orders/Source/Features/OrderStatus/financial-evidence.ts");
            const {
              readPurchasedLines,
            } = require("../../../../Orders/Source/Features/OrderStatus/purchased-lines.ts");
            const { financial } = await readOrderFinancialEvidence(order, {
              from: () => read,
            });
            assert.deepEqual(financial, { source: "ledger", snapshot: snap });
            await withPostgrest(async (http) => {
              const actual = await readOrderFinancialEvidence(order, http);
              assert.deepEqual(actual.financial, { source: "ledger", snapshot: snap });
              assert.equal(actual.order.attemptCount[0].count, allAttempts.length);
              assert.equal(actual.order.factCount[0].count, observations.length);
              assert.equal(actual.order.refundCount[0].count, refunds.length);
            });
            assert.equal(
              await readPurchasedLines(
                {
                  orderId: o.id,
                  authorizedAccess: {
                    orderId: o.id,
                    status: order.status,
                    financialReview: !!financial.snapshot.reviewReason,
                  },
                },
                {},
              ),
              null,
            );
            assert.equal(
              (
                await admin.query("select stock from product_variants where id=$1", [
                  o.variantId,
                ])
              ).rows[0].stock,
              ready ? 0 : 1,
            );
            assert.equal(
              (
                await admin.query(
                  "select status from inventory_reservations where order_id=$1",
                  [o.id],
                )
              ).rows[0].status,
              ready ? "active" : "released",
            );
            if (ready) {
              await admin.query("update orders set status='pending' where id=$1", [o.id]);
              await assert.rejects(
                rpc(b, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
                  ready.id,
                  o.binding,
                  "a".repeat(64),
                  "b".repeat(64),
                ]),
                /not_payable/,
              );
            }
            await assert.rejects(
              rpc(a, "get_or_create_checkout_payment_attempt($1,'card',$2)", [
                o.id,
                o.binding,
              ]),
              /not_payable/,
            );
            assert.equal(
              (
                await admin.query(
                  "select count(*)::int n from checkout_notification_outbox where order_id=$1 and kind in ('order_confirmation','pickup_instructions')",
                  [o.id],
                )
              ).rows[0].n,
              0,
            );
          },
        );
      }
      const due = (o) =>
        admin.query(
          "update orders set expires_at=now()-interval '1 minute' where id=$1",
          [o.id],
        );
      const mark = (c, o) => rpc(c, "mark_checkout_expiry($1)", [o.id]);
      const finish = (c, o) => rpc(c, "finish_checkout_expiry($1,$2)", [o.id, o.sq]);
      const stock = async (o) =>
        (
          await admin.query("select stock from product_variants where id=$1", [
            o.variantId,
          ])
        ).rows[0].stock;
      const blocked = async (c) => {
        const {
          rows: [{ pid }],
        } = await c.query("select pg_backend_pid() pid");
        return async () => {
          const until = Date.now() + 5000;
          while (Date.now() < until) {
            const {
              rows: [{ waiting }],
            } = await admin.query("select cardinality(pg_blocking_pids($1))>0 waiting", [
              pid,
            ]);
            if (waiting) return;
            await new Promise((r) => setTimeout(r, 10));
          }
          assert.fail("expected independent connection at order lock");
        };
      };
      await t.test(
        "worker records late FAILED evidence after a no-ID decline and expiry can release once cancellation is proved",
        async () => {
          const o = await held();
          const attempt = await rpc(
            a,
            "get_or_create_checkout_payment_attempt($1,'card',$2)",
            [o.id, o.binding],
          );
          await rpc(a, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
            attempt.id,
            o.binding,
            "a".repeat(64),
            "b".repeat(64),
          ]);
          await rpc(a, "record_checkout_payment_outcome($1,null,'declined',$2)", [
            attempt.id,
            {
              kind: "square_decline",
              code: "CARD_DECLINED",
              requestDigest: "a".repeat(64),
            },
          ]);
          const pay = "failed-" + o.id;
          const result = await runFixtureWorker(
            o,
            attempt,
            pay,
            null,
            "failed",
            new Date().toISOString(),
            { status: "FAILED" },
          );
          assert.equal(result.creates, 0);
          assert.equal(result.metrics.done, 1);
          assert.ok(result.commands.includes("apply_checkout_payment_with_analytics"));
          assert.deepEqual(
            (
              await admin.query(
                "select state,provider_payment_id from checkout_payment_attempts where id=$1",
                [attempt.id],
              )
            ).rows[0],
            { state: "declined", provider_payment_id: pay },
          );
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from checkout_financial_facts where order_id=$1 and payment_id=$2 and status='FAILED'",
                [o.id, pay],
              )
            ).rows[0].n,
            1,
          );
          await due(o);
          await mark(b, o);
          assert.equal(await rpc(b, "finish_checkout_expiry($1)", [o.id]), "reconcile");
          assert.equal(await stock(o), 0);
          assert.equal(await finish(b, o), "released");
          assert.equal(await stock(o), 1);
        },
      );
      await t.test(
        "worker settles the exact accepted payment after browser closure with webhook absent",
        async () => {
          const o = await held(),
            pay = "pay-" + o.id;
          const attempt = await rpc(
            a,
            "get_or_create_checkout_payment_attempt($1,'card',$2)",
            [o.id, o.binding],
          );
          await rpc(a, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
            attempt.id,
            o.binding,
            "a".repeat(64),
            "b".repeat(64),
          ]);
          const { metrics, creates, commands } = await runFixtureWorker(o, attempt, pay);
          assert.equal(metrics.done, 1);
          assert.equal(creates, 0);
          assert.ok(!commands.includes("get_or_create_checkout_payment_attempt"));
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from checkout_payment_attempts where order_id=$1",
                [o.id],
              )
            ).rows[0].n,
            1,
          );
          assert.equal(
            (await admin.query("select status from orders where id=$1", [o.id])).rows[0]
              .status,
            "paid",
          );
          assert.equal(
            (
              await admin.query(
                "select status from inventory_reservations where order_id=$1",
                [o.id],
              )
            ).rows[0].status,
            "consumed",
          );
        },
      );
      await t.test(
        "committed expiry fence blocks late dispatch even if a stale writer extends expiry",
        async () => {
          const o = await held();
          const at = await rpc(
            a,
            "get_or_create_checkout_payment_attempt($1,'card',$2)",
            [o.id, o.binding],
          );
          await due(o);
          await a.query("begin");
          await mark(a, o);
          const wait = await blocked(b);
          const pending = rpc(b, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
            at.id,
            o.binding,
            "a".repeat(64),
            "b".repeat(64),
          ]);
          await wait();
          await a.query("commit");
          assert.equal((await pending).kind, "observe");
          await admin.query(
            "update orders set expires_at=now()+interval '15 minutes' where id=$1",
            [o.id],
          );
          await assert.rejects(
            rpc(b, "get_or_create_checkout_payment_attempt($1,'card',$2)", [
              o.id,
              o.binding,
            ]),
            /not_payable/,
          );
        },
      );
      await t.test(
        "duplicate release restores one unit, a different canceled order cannot authorize release",
        async () => {
          const o = await held();
          await due(o);
          await mark(a, o);
          assert.notEqual(
            await rpc(a, "finish_checkout_expiry($1,$2)", [o.id, "foreign-square"]),
            "released",
          );
          const results = completedValues(
            await raceAtRowLock(
              admin,
              [a, b],
              (c) => c.query("select id from orders where id=$1 for update", [o.id]),
              (c) => finish(c, o),
            ),
          );
          assert.deepEqual(results.sort(), ["released", "unchanged"]);
          assert.equal(await stock(o), 1);
        },
      );
      await t.test(
        "legacy absence and dispatched no-id remain protected even after a confirmed canceled order",
        async () => {
          for (const guarded of [false, true]) {
            const o = await held(guarded);
            if (!guarded) {
              assert.equal(
                await rpc(b, "release_square_checkout_reservation($1,'cancelled')", [
                  o.id,
                ]),
                false,
              );
              assert.equal(await stock(o), 0);
              const {
                rows: [prior],
              } = await admin.query(
                "select o.status, h.status hold,o.checkout_attempt_guarded guarded from orders o join inventory_reservations h on h.order_id=o.id where o.id=$1",
                [o.id],
              );
              assert.deepEqual(prior, {
                status: "pending",
                hold: "active",
                guarded: false,
              });
            }
            if (guarded) {
              const attempt = await rpc(
                a,
                "get_or_create_checkout_payment_attempt($1,'card',$2)",
                [o.id, o.binding],
              );
              await rpc(a, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
                attempt.id,
                o.binding,
                "a".repeat(64),
                "b".repeat(64),
              ]);
            }
            await due(o);
            await mark(a, o);
            assert.equal(
              await rpc(b, "release_square_checkout_reservation($1,'checkout_expired')", [
                o.id,
              ]),
              false,
            );
            assert.ok(["review", "reconcile"].includes(await finish(b, o)));
            assert.equal(await stock(o), 0);
          }
        },
      );
      await t.test(
        "late settlement preserves historical release and independently records money under review",
        async () => {
          const o = await held(),
            pay = "pay-" + o.id,
            at = await rpc(a, "get_or_create_checkout_payment_attempt($1,'card',$2)", [
              o.id,
              o.binding,
            ]);
          await rpc(a, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
            at.id,
            o.binding,
            "a".repeat(64),
            "b".repeat(64),
          ]);
          // Seed a previously released pre-cutover reservation, independent of new expiry.
          await admin.query(
            "update inventory_reservations set status='released',released_at=now() where order_id=$1",
            [o.id],
          );
          await admin.query("update product_variants set stock=1 where id=$1", [
            o.variantId,
          ]);
          await rpc(a, "record_checkout_payment_outcome($1,$2,'succeeded',$3)", [
            at.id,
            pay,
            {
              kind: "square_payment",
              orderId: o.id,
              squareOrderId: o.sq,
              paymentId: pay,
              status: "COMPLETED",
              amountCents: 1000,
              currency: "USD",
            },
          ]);
          const fact = {
            kind: "payment",
            orderId: o.id,
            providerId: pay,
            paymentId: pay,
            providerVersion: "late",
            status: "COMPLETED",
            amountCents: 1000,
            expectedTotalCents: 1000,
            currency: "USD",
            fulfillmentStatus: "unfulfilled",
          };
          const snapshot = await rpc(a, "apply_checkout_financial_fact($1,now())", [
            fact,
          ]);
          assert.equal(snapshot.capturedCents, 1000);
          assert.equal(snapshot.reviewReason, "late_or_released_square_payment");
          assert.equal(await stock(o), 1);
          assert.equal(
            (
              await admin.query(
                "select status from inventory_reservations where order_id=$1",
                [o.id],
              )
            ).rows[0].status,
            "released",
          );
          assert.equal(
            (
              await admin.query(
                "select count(*)::int n from checkout_notification_outbox where order_id=$1",
                [o.id],
              )
            ).rows[0].n,
            0,
          );
        },
      );
      await t.test(
        "settlement racing final expiry retains money and never restores held stock",
        async () => {
          const o = await held(),
            pay = "pay-" + o.id;
          const at = await rpc(
            a,
            "get_or_create_checkout_payment_attempt($1,'card',$2)",
            [o.id, o.binding],
          );
          await rpc(a, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
            at.id,
            o.binding,
            "a".repeat(64),
            "b".repeat(64),
          ]);
          await due(o);
          await mark(b, o);
          await a.query("begin");
          try {
            await rpc(a, "record_checkout_payment_outcome($1,$2,'succeeded',$3)", [
              at.id,
              pay,
              {
                kind: "square_payment",
                orderId: o.id,
                squareOrderId: o.sq,
                paymentId: pay,
                status: "COMPLETED",
                amountCents: 1000,
                currency: "USD",
              },
            ]);
            const wait = await blocked(b);
            const waiting = finish(b, o);
            waiting.catch(() => {});
            await wait();
            const fact = {
              kind: "payment",
              orderId: o.id,
              providerId: pay,
              paymentId: pay,
              providerVersion: "v1",
              status: "COMPLETED",
              amountCents: 1000,
              expectedTotalCents: 1000,
              currency: "USD",
              fulfillmentStatus: "unfulfilled",
            };
            await rpc(a, "apply_checkout_financial_fact($1,now())", [fact]);
            await a.query("commit");
            assert.notEqual(await waiting, "released");
            await rpc(a, "apply_checkout_financial_fact($1,now())", [fact]);
            assert.notEqual(await finish(b, o), "released");
            assert.equal(await stock(o), 0);
            assert.equal(
              (
                await admin.query(
                  "select count(*)::int n from checkout_financial_facts where order_id=$1 and status='COMPLETED'",
                  [o.id],
                )
              ).rows[0].n,
              1,
            );
          } finally {
            await a.query("rollback");
          }
        },
      );
    },
  );
});
