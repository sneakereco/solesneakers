import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRequire } from "node:module";
import {
  completedValues,
  raceAtRowLock,
  withCheckoutDatabase,
} from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";
const require = createRequire(import.meta.url);
require("tsx/cjs");
const {
  dispatchPayment,
} = require("../../../Source/Features/Payments/dispatch-payment.ts");

const digest = "a".repeat(64);
const source = "b".repeat(64);
const other = "c".repeat(64);
async function rpc(client, call, args) {
  return (await client.query("select public." + call + " as result", args)).rows[0]
    .result;
}
const get = (client, order, method = "card") =>
  rpc(client, "get_or_create_checkout_payment_attempt($1,$2,$3)", [
    order.id,
    method,
    order.binding,
  ]);
const begin = (client, order, attempt, request = digest, token = source) =>
  rpc(client, "begin_checkout_payment_dispatch($1,$2,$3,$4)", [
    attempt.id,
    order.binding,
    request,
    token,
  ]);
const record = (client, attempt, id, state, facts) =>
  rpc(client, "record_checkout_payment_outcome($1,$2,$3,$4)", [
    attempt.id,
    id,
    state,
    facts,
  ]);
function payment(order, paymentId, status) {
  return {
    kind: "square_payment",
    paymentId,
    squareOrderId: order.square,
    orderId: order.id,
    amountCents: 1000,
    currency: "USD",
    status,
  };
}

test("one durable payment attempt per order", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder, seedCatalog, withPostgrest }) => {
      const svc = await connect("service_role");
      async function order({ guarded = true, guest = false } = {}) {
        const { orderId, userId } = await seedOrder(guest ? { userId: null } : {});
        const id = randomUUID();
        const square = "sq-" + id;
        const { productId, variantId } = await seedCatalog({ stock: 1 });
        await admin.query(
          `insert into public.orders(id,tenant_id,user_id,guest_email,status,subtotal,shipping,total,currency,fulfillment,expires_at,cart_hash,square_order_id,checkout_attempt_guarded,checkout_guest_context_hash)
      select $1,tenant_id,user_id,guest_email,status,subtotal,shipping,total,currency,fulfillment,expires_at,'cart-fixture',$3,$4,$5 from public.orders where id=$2`,
          [id, orderId, square, guarded, guest && guarded ? other : null],
        );
        await admin.query(
          "insert into public.order_items(order_id,product_id,variant_id,quantity,unit_price,line_total) values ($1,$2,$3,1,10,10)",
          [id, productId, variantId],
        );
        await admin.query(
          "insert into public.inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,expires_at from public.orders where id=$1",
          [id, variantId],
        );
        return {
          id,
          square,
          userId,
          variantId,
          binding: guest
            ? guarded
              ? "guest:" + other
              : "order:" + id
            : "account:" + userId,
        };
      }
      async function race(orderId, action) {
        const clients = await Promise.all([
          connect("service_role"),
          connect("service_role"),
        ]);
        const results = await raceAtRowLock(
          admin,
          clients,
          (c) => c.query("select id from orders where id=$1 for update", [orderId]),
          action,
        );
        return completedValues(results);
      }
      await t.test(
        "Cart scopes the original hold across definitive decline and a ready retry",
        async (t) => {
          await withPostgrest(async (http) => {
            let viewer;
            const replaced = new Map();
            function boundary(path, exports) {
              const resolved = require.resolve(path);
              replaced.set(resolved, require.cache[resolved]);
              require.cache[resolved] = {
                id: resolved,
                filename: resolved,
                loaded: true,
                exports,
              };
            }
            boundary("@/config/env", {
              env: { ORDER_ACCESS_TOKEN_SECRET: "owned-local-cart-grant-fixture" },
            });
            boundary("@/lib/auth/session", { observeServerSession: async () => viewer });
            boundary("@/lib/supabase/service-role", {
              createSupabaseAdminClient: () => http,
            });
            try {
              const {
                readOwnHolds,
              } = require("@/Modules/Cart/Source/Features/ValidateBasket/own-hold");
              const {
                readOriginalRetryExpiration,
              } = require("@/Modules/Checkout/Source/Features/Preparation/read-original-hold");
              const {
                OrderAccessTokenService,
              } = require("@/services/order-access-token-service");
              const tokens = new OrderAccessTokenService(http);
              const view = async (o) => {
                viewer = o.userId ? { user: { id: o.userId } } : null;
                const grant = o.userId
                  ? undefined
                  : (await tokens.createToken({ orderId: o.id })).token;
                return { orderId: o.id, guestAccessToken: grant };
              };
              const active = { quantity: 1, recovery: false };
              const recovery = { quantity: 0, recovery: true };
              const held = async (o, reference) =>
                (await readOwnHolds(reference)).get(o.variantId);
              const qualification = async (o) => {
                const { tenant_id, checkout_guest_context_hash, expires_at } = (
                  await admin.query(
                    "select tenant_id,checkout_guest_context_hash,expires_at from orders where id=$1",
                    [o.id],
                  )
                ).rows[0];
                return readOriginalRetryExpiration(http, tenant_id, {
                  orderId: o.id,
                  userId: o.userId,
                  guestContextHash: checkout_guest_context_hash,
                  expiresAt: expires_at.toISOString(),
                  items: [{ variantId: o.variantId, quantity: 1 }],
                });
              };
              for (const guest of [false, true]) {
                await t.test(
                  guest ? "same verified guest" : "same verified account",
                  async () => {
                    const original = await order({ guest });
                    const reference = await view(original);
                    assert.deepEqual(await held(original, reference), active);
                    assert.equal(await qualification(original), null);
                    const first = await get(svc, original);
                    assert.equal((await begin(svc, original, first)).kind, "dispatch");
                    assert.deepEqual(await held(original, reference), recovery);
                    const failed = `failed-${original.id}`;
                    await record(
                      svc,
                      first,
                      failed,
                      "declined",
                      payment(original, failed, "FAILED"),
                    );
                    assert.deepEqual(await held(original, reference), active);
                    assert.ok(Date.parse(await qualification(original)) > Date.now());
                    const retry = await get(svc, original);
                    assert.equal(retry.sequence, 2);
                    assert.notEqual(retry.id, first.id);
                    assert.equal((await get(svc, original)).id, retry.id);
                    assert.deepEqual(await held(original, reference), active);
                    assert.ok(Date.parse(await qualification(original)) > Date.now());
                    assert.equal((await begin(svc, original, first)).kind, "observe");
                    assert.equal((await begin(svc, original, retry)).kind, "dispatch");
                    assert.equal((await begin(svc, original, retry)).kind, "observe");
                    const accepted = `accepted-${original.id}`;
                    await record(
                      svc,
                      retry,
                      accepted,
                      "pending",
                      payment(original, accepted, "APPROVED"),
                    );
                    assert.deepEqual(await held(original, reference), recovery);
                    assert.equal(await qualification(original), null);
                    await record(
                      svc,
                      retry,
                      accepted,
                      "succeeded",
                      payment(original, accepted, "COMPLETED"),
                    );
                    assert.deepEqual(await held(original, reference), recovery);
                    assert.equal(await qualification(original), null);
                    assert.equal(
                      (
                        await admin.query(
                          "select count(*)::int n from inventory_reservations where order_id=$1",
                          [original.id],
                        )
                      ).rows[0].n,
                      1,
                    );
                  },
                );
              }
              await t.test(
                "unknown, review, expiry and identity never credit the held stock",
                async () => {
                  const original = await order();
                  const reference = await view(original);
                  const a = await get(svc, original);
                  await begin(svc, original, a);
                  await record(svc, a, null, "unknown", {
                    kind: "uncertain",
                    reason: "response_lost",
                  });
                  assert.deepEqual(await held(original, reference), recovery);
                  assert.equal(
                    await held(original, { orderId: randomUUID() }),
                    undefined,
                  );
                  viewer = { user: { id: randomUUID() } };
                  assert.equal(await held(original, reference), undefined);
                  const reviewed = await order();
                  const review = await view(reviewed);
                  await admin.query(
                    "update orders set checkout_financial_review='square_evidence_conflict' where id=$1",
                    [reviewed.id],
                  );
                  assert.deepEqual(await held(reviewed, review), recovery);
                  const expired = await order();
                  const expiredReference = await view(expired);
                  await admin.query(
                    "update inventory_reservations set expires_at=now()-interval '1 second' where order_id=$1",
                    [expired.id],
                  );
                  assert.deepEqual(await held(expired, expiredReference), recovery);
                  assert.equal(await qualification(expired), null);
                  const old = await order({ guarded: false, guest: true });
                  const oldReference = await view(old);
                  assert.equal(
                    await held(old, { ...oldReference, guestAccessToken: "invalid" }),
                    undefined,
                  );
                  assert.deepEqual(await held(old, oldReference), recovery);
                },
              );
              await t.test(
                "late capture contradicting a declined attempt blocks a ready retry",
                async () => {
                  const original = await order();
                  const reference = await view(original);
                  const declined = await get(svc, original);
                  await begin(svc, original, declined);
                  const paymentId = `late-${original.id}`;
                  await record(
                    svc,
                    declined,
                    paymentId,
                    "declined",
                    payment(original, paymentId, "FAILED"),
                  );
                  const ready = await get(svc, original);
                  assert.equal(ready.state, "ready");
                  assert.ok(await qualification(original));
                  const captured = await rpc(
                    svc,
                    "record_checkout_terminal_capture($1,$2,$3,$4,$5,$6)",
                    [
                      declined.id,
                      original.square,
                      declined.id,
                      "card",
                      {
                        kind: "payment",
                        orderId: original.id,
                        providerId: paymentId,
                        paymentId,
                        providerVersion: "late-version",
                        status: "COMPLETED",
                        amountCents: 1000,
                        expectedTotalCents: 1000,
                        currency: "USD",
                        fulfillmentStatus: "unfulfilled",
                      },
                      new Date().toISOString(),
                    ],
                  );
                  assert.equal(captured.reviewReason, "square_terminal_capture_conflict");
                  assert.deepEqual(await held(original, reference), recovery);
                  assert.equal(await qualification(original), null);
                  await assert.rejects(get(svc, original), /checkout_order_not_payable/);
                },
              );
              await t.test(
                "changed amount and released inventory close retry eligibility",
                async () => {
                  for (const change of [
                    "update orders set total=11 where id=$1",
                    "update inventory_reservations set status='released' where order_id=$1",
                  ]) {
                    const original = await order();
                    const reference = await view(original);
                    const first = await get(svc, original);
                    await begin(svc, original, first);
                    const canceled = `canceled-${original.id}`;
                    await record(
                      svc,
                      first,
                      canceled,
                      "canceled",
                      payment(original, canceled, "CANCELED"),
                    );
                    assert.ok(await qualification(original));
                    await admin.query(change, [original.id]);
                    assert.deepEqual(await held(original, reference), recovery);
                    assert.equal(await qualification(original), null);
                    await assert.rejects(
                      get(svc, original),
                      /checkout_order_not_payable/,
                    );
                  }
                },
              );
            } finally {
              for (const [path, original] of replaced) {
                if (original) require.cache[path] = original;
                else delete require.cache[path];
              }
            }
          });
        },
      );
      await t.test(
        "guarded owner identity is fixed from preparation through observation",
        async () => {
          const o = await order();
          const a = await get(svc, o);
          await begin(svc, o, a);
          const otherAccount = await seedOrder();
          await assert.rejects(
            admin.query("update public.orders set user_id=$2 where id=$1", [
              o.id,
              otherAccount.userId,
            ]),
          );
          await assert.rejects(
            begin(svc, { ...o, binding: "account:" + otherAccount.userId }, a),
            { code: "42501" },
          );
          assert.equal((await get(svc, o)).id, a.id);
        },
      );
      await t.test(
        "another database session observes the guard before the gateway can run",
        async () => {
          const o = await order();
          const ready = await get(svc, o);
          const observer = await connect("service_role");
          const permit = {
            orderId: o.id,
            attemptId: ready.id,
            ownerBinding: o.binding,
            method: ready.method,
            totalCents: ready.amountCents,
            squareIdempotencyKey: ready.squareIdempotencyKey,
          };
          const committed = Promise.withResolvers(),
            release = Promise.withResolvers();
          const latest = async () => {
            const { rows } = await observer.query(
              `select id,order_id as "orderId",sequence,state,method,
            amount_cents as "amountCents",currency,square_idempotency_key as "squareIdempotencyKey",
            request_digest as "requestDigest",provider_payment_id as "providerPaymentId"
            from public.checkout_payment_attempts where order_id=$1 order by sequence desc limit 1`,
              [o.id],
            );
            return rows[0];
          };
          const calls = [];
          const deps = {
            order: { orderId: o.id, squareOrderId: o.square },
            attempt: ready,
            ownerBinding: o.binding,
            validate: () => Promise.resolve(null),
            readCurrentAttempt: latest,
            fingerprints: () => ({ requestDigest: digest, sourceDigest: source }),
            beginDispatch: async (input) => {
              const decision = await begin(
                svc,
                o,
                ready,
                input.requestDigest,
                input.sourceDigest,
              );
              committed.resolve();
              await release.promise;
              return decision;
            },
            createPayment: (input) => {
              calls.push(input.idempotencyKey);
              return Promise.resolve({
                id: "fixture-response-" + o.id,
                status: "COMPLETED",
                orderId: o.square,
                totalCents: 1000,
              });
            },
            recordAttemptOutcome: (input) =>
              record(
                svc,
                ready,
                input.providerPaymentId,
                input.state,
                input.verifiedFacts,
              ),
            declineCode: () => null,
            save: () => Promise.resolve(),
            reportError: (err) => {
              throw err;
            },
          };
          const winner = dispatchPayment({ permit, sourceId: "inert-test-input" }, deps);
          try {
            await Promise.race([
              committed.promise,
              winner.then(() => {
                throw new Error("Missing committed claim");
              }),
            ]);
            const current = await latest();
            assert.equal(current.state, "dispatch_started");
            assert.equal(
              (
                await observer.query(
                  "select count(*)::int as n from public.checkout_recovery_jobs where order_id=$1 and unique_key=$2",
                  [o.id, "payment_attempt:" + ready.id],
                )
              ).rows[0].n,
              1,
            );
            const follower = await dispatchPayment(
              { permit, sourceId: "inert-reload" },
              { ...deps, attempt: current },
            );
            assert.equal(follower.kind, "observe");
            assert.equal(follower.attemptId, ready.id);
            assert.deepEqual(calls, []);
          } finally {
            release.resolve();
            await winner;
          }
          assert.deepEqual(calls, [ready.squareIdempotencyKey]);
          assert.equal((await latest()).state, "succeeded");
        },
      );
      await t.test("two_issuers_share_one_attempt_and_one_dispatch", async () => {
        const o = await order();
        const [a, b] = await race(o.id, (c) => get(c, o));
        assert.equal(a.id, b.id);
        assert.equal(a.squareIdempotencyKey, b.squareIdempotencyKey);
        assert.ok(a.squareIdempotencyKey.length <= 45);
        const results = await race(o.id, (c) => begin(c, o, a));
        assert.deepEqual(results.map((x) => x.kind).sort(), ["dispatch", "observe"]);
        const [{ result: jobs }] = (
          await svc.query(
            "select public.claim_checkout_recovery(50,120,clock_timestamp()) as result",
          )
        ).rows;
        const job = jobs.find((j) => j.orderId === o.id);
        assert.ok(job);
        await admin.query(
          "update public.checkout_recovery_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
          [job.id],
        );
        assert.equal((await get(svc, o, "afterpay")).state, "dispatch_started");
        assert.equal((await begin(svc, o, a, other, other)).kind, "observe");
        assert.equal(
          (
            await admin.query(
              "select request_digest,source_digest from public.checkout_payment_attempts where id=$1",
              [a.id],
            )
          ).rows[0].source_digest,
          source,
        );
        await assert.rejects(
          record(svc, a, "pay-lost", "succeeded", {
            ...payment(o, "pay-lost", "COMPLETED"),
            amountCents: 5,
          }),
        );
        await svc.query("begin");
        const accepted = await record(
          svc,
          a,
          "pay-lost",
          "succeeded",
          payment(o, "pay-lost", "COMPLETED"),
        );
        assert.equal(accepted.state, "succeeded");
        await svc.query("rollback");
        const reloaded = await get(await connect("service_role"), o);
        assert.equal(reloaded.id, a.id);
        assert.equal(reloaded.state, "dispatch_started");
        assert.equal(reloaded.providerPaymentId, null);
        await record(svc, a, null, "unknown", {
          kind: "uncertain",
          reason: "response_lost",
        });
        assert.equal((await get(svc, o, "applePay")).state, "unknown");
      });
      await t.test(
        "claim and recovery roll back together on abort and on enqueue conflict",
        async () => {
          const o = await order();
          const a = await get(svc, o);
          await svc.query("begin");
          assert.equal((await begin(svc, o, a)).kind, "dispatch");
          await svc.query("rollback");
          assert.equal((await get(svc, o)).state, "ready");
          const key = "payment_attempt:" + a.id;
          await svc.query(
            "select public.enqueue_checkout_recovery('expire_reservation',$1,now(),'fixture',$2)",
            [key, o.id],
          );
          await assert.rejects(begin(svc, o, a), { code: "23505" });
          assert.equal((await get(svc, o)).requestDigest, null);
          assert.equal(
            (
              await admin.query(
                "select count(*)::int as n from public.checkout_payment_attempt_history where attempt_id=$1",
                [a.id],
              )
            ).rows[0].n,
            1,
          );
        },
      );
      await t.test(
        "only a bound terminal result permits another payable sequence",
        async () => {
          for (const [state, status] of [
            ["declined", "FAILED"],
            ["canceled", "CANCELED"],
          ]) {
            const o = await order();
            const a = await get(svc, o);
            await begin(svc, o, a);
            const pid = "pay-" + randomUUID(),
              facts = payment(o, pid, status);
            await assert.rejects(
              record(svc, a, pid, state, { ...facts, squareOrderId: "elsewhere" }),
            );
            await assert.rejects(
              record(svc, a, pid, state, { ...facts, kind: "unknown" }),
            );
            await record(svc, a, pid, state, facts);
            assert.equal((await record(svc, a, pid, state, facts)).state, state);
            await assert.rejects(
              record(svc, a, pid, "succeeded", payment(o, pid, "COMPLETED")),
            );
            const [next, again] = await race(o.id, (c) => get(c, o, "cashAppPay"));
            assert.equal(next.sequence, 2);
            assert.equal(next.id, again.id);
            assert.notEqual(next.squareIdempotencyKey, a.squareIdempotencyKey);
            assert.equal((await begin(svc, o, a)).kind, "observe");
            await begin(svc, o, next);
            await assert.rejects(record(svc, next, pid, state, facts), { code: "23505" });
            const secondId = "pay-" + randomUUID();
            await record(svc, next, secondId, state, payment(o, secondId, status));
            await admin.query(
              "update public.inventory_reservations set expires_at=now()-interval '1 second' where order_id=$1",
              [o.id],
            );
            await assert.rejects(get(svc, o));
          }
        },
      );
      await t.test(
        "an immutable guest binding supports authorized order access; only an unused method can switch",
        async () => {
          const o = await order({ guest: true });
          const a = await get(svc, o);
          await assert.rejects(get(svc, { ...o, binding: "guest:" + digest }));
          await assert.rejects(
            admin.query(
              "update public.orders set checkout_guest_context_hash=$2 where id=$1",
              [o.id, digest],
            ),
          );
          const b = await get(svc, { ...o, binding: "order:" + o.id }, "afterpay");
          assert.equal(b.sequence, 2);
          assert.equal(b.method, "afterpay");
          assert.equal((await begin(svc, o, a)).kind, "observe");
          await begin(svc, o, b);
          const id = "pay-" + randomUUID();
          await record(svc, b, id, "pending", payment(o, id, "APPROVED"));
          assert.equal((await get(svc, o, "applePay")).id, b.id);
          await assert.rejects(
            record(svc, b, null, "declined", {
              kind: "square_decline",
              code: "CARD_DECLINED",
              requestDigest: digest,
            }),
          );
          await record(svc, b, id, "succeeded", payment(o, id, "COMPLETED"));
          assert.equal((await get(svc, o)).state, "succeeded");
          await assert.rejects(record(svc, b, id, "ready", {}));
        },
      );
      await t.test(
        "unguarded legacy obligations enter inquiry and never acquire dispatch rights",
        async () => {
          const o = await order({ guarded: false, guest: true });
          const a = await get(svc, o);
          assert.equal(a.state, "review");
          assert.equal(a.providerPaymentId, null);
          const unboundId = "legacy-unbound";
          await assert.rejects(
            record(svc, a, unboundId, "succeeded", payment(o, unboundId, "COMPLETED")),
          );
          assert.equal((await begin(svc, o, a)).kind, "observe");
          assert.equal((await get(svc, o, "applePay")).id, a.id);
          await assert.rejects(
            admin.query(
              "update public.orders set checkout_attempt_guarded=true where id=$1",
              [o.id],
            ),
          );
          assert.equal(
            (
              await admin.query(
                "select reason from public.checkout_recovery_jobs where order_id=$1",
                [o.id],
              )
            ).rows[0].reason,
            "legacy_dispatch_unproven",
          );
        },
      );
      await t.test(
        "verified known legacy payments converge without enabling another dispatch",
        async () => {
          for (const [status, state] of [
            ["COMPLETED", "succeeded"],
            ["FAILED", "declined"],
            ["CANCELED", "canceled"],
          ]) {
            const o = await order({ guarded: false, guest: true });
            const pid = "legacy-" + randomUUID();
            await admin.query(
              "update public.orders set payment_transaction_id=$2 where id=$1",
              [o.id, pid],
            );
            const a = await get(svc, o);
            assert.equal(a.state, "review");
            assert.equal(a.providerPaymentId, pid);
            const wrongId = "different-payment";
            await assert.rejects(
              record(svc, a, wrongId, "succeeded", payment(o, wrongId, "COMPLETED")),
            );
            await assert.rejects(
              record(svc, a, pid, "succeeded", {
                ...payment(o, pid, "COMPLETED"),
                amountCents: 1,
              }),
            );
            await assert.rejects(
              record(svc, a, null, "declined", {
                kind: "square_decline",
                code: "CARD_DECLINED",
                requestDigest: digest,
              }),
            );
            assert.equal((await get(svc, o)).state, "review");
            if (status !== "COMPLETED") {
              const pending = await record(
                svc,
                a,
                pid,
                "pending",
                payment(o, pid, "APPROVED"),
              );
              assert.equal(pending.requestDigest, null);
              assert.equal(pending.state, "pending");
            }
            const facts = payment(o, pid, status);
            const resolved = await record(svc, a, pid, state, facts);
            assert.equal(resolved.state, state);
            assert.equal(resolved.providerPaymentId, pid);
            assert.deepEqual(await record(svc, a, pid, state, facts), resolved);
            assert.deepEqual(await get(svc, o, "afterpay"), resolved);
            assert.deepEqual(await begin(svc, o, a), {
              kind: "observe",
              attempt: resolved,
            });
            const stored = await admin.query(
              "select request_digest,source_digest,dispatched_at from public.checkout_payment_attempts where order_id=$1",
              [o.id],
            );
            assert.deepEqual(stored.rows, [
              { request_digest: null, source_digest: null, dispatched_at: null },
            ]);
          }
        },
      );
      await t.test(
        "live cart, exact amount and full hold are required before dispatch",
        async () => {
          for (const change of [
            "update public.orders set cart_hash='changed' where id=$1",
            "update public.orders set total=11 where id=$1",
            "update public.inventory_reservations set quantity=2 where order_id=$1",
            "update public.inventory_reservations set status='released' where order_id=$1",
            "update public.orders set status='paid' where id=$1",
          ]) {
            const o = await order();
            const a = await get(svc, o);
            await admin.query(change, [o.id]);
            await assert.rejects(begin(svc, o, a));
          }
        },
      );
      await t.test(
        "no-ID decline requires a definitive response bound to the claimed request",
        async () => {
          const o = await order();
          const a = await get(svc, o);
          await begin(svc, o, a);
          for (const facts of [
            { kind: "square_decline", code: "CARD_DECLINED", requestDigest: other },
            {
              kind: "square_decline",
              code: "IDEMPOTENCY_KEY_REUSED",
              requestDigest: digest,
            },
            { kind: "uncertain", reason: "response_lost" },
          ])
            await assert.rejects(record(svc, a, null, "declined", facts));
          await record(svc, a, null, "declined", {
            kind: "square_decline",
            code: "CARD_DECLINED",
            requestDigest: digest,
          });
          assert.equal((await get(svc, o)).sequence, 2);
        },
      );
      await t.test(
        "ordinary RPC and storage privileges are restricted to their intended roles",
        async () => {
          for (const role of ["anon", "authenticated"]) {
            const c = await connect(role);
            for (const name of [
              "get_or_create_checkout_payment_attempt(uuid,text,text)",
              "begin_checkout_payment_dispatch(uuid,text,text,text)",
              "record_checkout_payment_outcome(uuid,text,text,jsonb)",
            ]) {
              assert.equal(
                (
                  await c.query(
                    "select has_function_privilege(current_user,$1,'EXECUTE') as allowed",
                    ["public." + name],
                  )
                ).rows[0].allowed,
                false,
              );
            }
            for (const name of [
              "checkout_payment_attempts",
              "checkout_payment_attempt_history",
            ]) {
              await assert.rejects(c.query("select * from public." + name + " limit 1"), {
                code: "42501",
              });
            }
          }
          for (const name of [
            "checkout_payment_attempts",
            "checkout_payment_attempt_history",
          ]) {
            assert.equal(
              (
                await svc.query(
                  "select has_table_privilege(current_user,$1,'UPDATE') as allowed",
                  ["public." + name],
                )
              ).rows[0].allowed,
              false,
            );
          }
        },
      );
    },
  );
});
