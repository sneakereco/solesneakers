import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("tsx/cjs");
const {
  CheckoutDependencyLeaseRepository,
} = require("../../../Source/Features/Recovery/dependency-lease.ts");
const {
  verifySquareWebhookSignature,
} = require("../../../../../../src/lib/square/webhook.ts");
const {
  normalizeSquareReceipt,
  SquareWebhookInbox,
} = require("../../../Source/Features/Payments/webhook-inbox.ts");
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

test("checkout controls, committed dispatches and verified declines", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder, seedCatalog }) => {
      const writer = await connect("service_role"),
        reader = await connect("service_role");
      const template = await seedOrder();
      const controls = "public.checkout_operational_controls";
      const rpc = async (c, name, args) =>
        (
          await c.query(
            "select public." +
              name +
              "(" +
              args.map((_, i) => "$" + (i + 1)).join(",") +
              ") result",
            args,
          )
        ).rows[0].result;
      async function held(account = template) {
        const id = randomUUID(),
          sq = "sq-" + id;
        const { productId, variantId } = await seedCatalog({ stock: 0 });
        await admin.query(
          "insert into orders(id,tenant_id,user_id,status,subtotal,shipping,total,currency,fulfillment,expires_at,cart_hash,square_order_id,checkout_attempt_guarded) select $1,tenant_id,user_id,status,subtotal,shipping,total,currency,fulfillment,now()+interval '15 min','cart',$3,true from orders where id=$2",
          [id, account.orderId, sq],
        );
        await admin.query(
          "insert into order_items(order_id,product_id,variant_id,quantity,unit_price,line_total) values($1,$2,$3,1,10,10)",
          [id, productId, variantId],
        );
        await admin.query(
          "insert into inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,expires_at from orders where id=$1",
          [id, variantId],
        );
        return { id, sq, owner: "account:" + account.userId };
      }
      const issue = (o) =>
        rpc(writer, "get_or_create_checkout_payment_attempt", [o.id, "card", o.owner]);
      const claim = (o, a) =>
        rpc(reader, "begin_checkout_payment_dispatch", [
          a.id,
          o.owner,
          "a".repeat(64),
          "b".repeat(64),
        ]);
      const record = (a, state, id, facts) =>
        rpc(writer, "record_checkout_payment_outcome", [a.id, id, state, facts]);
      const decline = (a) =>
        record(a, "declined", null, {
          kind: "square_decline",
          code: "CARD_DECLINED",
          requestDigest: "a".repeat(64),
        });
      const flags = (a, b) =>
        writer.query(
          "update " + controls + " set pause_new_checkouts=$1,pause_payment_dispatch=$2",
          [a, b],
        );

      await t.test(
        "a failed sink preserves the committed claim, installed SDK invocation and slot cleanup; authority denials and observers spend no additional calls",
        async () => {
          const {
            CheckoutPaymentAttemptRepository,
          } = require("../../../Source/Features/Payments/attempt-repository.ts");
          const {
            SquarePaymentsGateway,
          } = require("../../../../../../src/lib/square/payments.ts");
          const { SquareClient } = require("square");
          const {
            summarizeCheckoutEvents,
          } = require("../../../Source/Features/Operations/request-metrics.ts");
          const rows = [],
            original = console.info,
            warn = console.warn;
          const transport = {
            rpc: async (name, params) => {
              try {
                return {
                  data: await rpc(reader, name, Object.values(params)),
                  error: null,
                };
              } catch (error) {
                return { data: null, error };
              }
            },
          };
          const leases = new CheckoutDependencyLeaseRepository(transport, null),
            attempts = new CheckoutPaymentAttemptRepository(transport);
          const o = await held(await seedOrder()),
            a = await issue(o);
          const input = {
            attemptId: a.id,
            ownerBinding: o.owner,
            requestDigest: "a".repeat(64),
            sourceDigest: "b".repeat(64),
          };
          let calls = 0;
          const client = new SquareClient({
            token: "local-fixture",
            maxRetries: 0,
            logging: { silent: true },
            fetch: async () => {
              calls++;
              const actual = (
                await writer.query(
                  "select state,(select count(*)::int from checkout_dependency_leases where lease_token is not null) slots from checkout_payment_attempts where id=$1",
                  [a.id],
                )
              ).rows[0];
              assert.deepEqual(actual, { state: "dispatch_started", slots: 1 });
              return Response.json({
                payment: {
                  id: "p-local",
                  reference_id: a.id,
                  order_id: o.sq,
                  status: "COMPLETED",
                  source_type: "CARD",
                  amount_money: { amount: 1000, currency: "USD" },
                  location_id: "local",
                },
              });
            },
          });
          const gateway = new SquarePaymentsGateway(client.payments, "local");
          try {
            await flags(false, true);
            console.info = console.warn = (line) => rows.push(JSON.parse(line));
            await assert.rejects(attempts.beginDispatch(input), {
              message: "checkout_dispatch_paused",
            });
            assert.equal(calls, 0);
            await flags(false, false);
            console.info = (line) => {
              rows.push(JSON.parse(line));
              throw Error("synthetic_sink_failure");
            };
            const lease = await leases.acquireDependencyLease({
              dependency: "square",
              limit: 1,
              leaseSeconds: 120,
            });
            assert.ok(lease);
            try {
              const winner = await attempts.beginDispatch(input);
              assert.equal(winner.kind, "dispatch");
              await gateway.create({
                attemptId: a.id,
                localOrderId: o.id,
                squareOrderId: o.sq,
                method: "card",
                sourceId: "fixture",
                idempotencyKey: a.squareIdempotencyKey,
                totalCents: 1000,
                billingAddress: null,
                shippingAddress: null,
              });
              assert.equal((await attempts.beginDispatch(input)).kind, "observe");
            } finally {
              await leases.releaseDependencyLease(lease);
            }
            assert.equal(calls, 1);
            assert.equal(
              (
                await writer.query(
                  "select count(*)::int n from checkout_dependency_leases where lease_token is not null",
                )
              ).rows[0].n,
              0,
            );
            const summary = summarizeCheckoutEvents(rows);
            assert.equal(summary.gateway.calls, 1);
            assert.deepEqual(summary.admission, {
              "authority.gateway_attempt.denied.paused": 1,
              "authority.gateway_attempt.allowed": 1,
              "authority.gateway_attempt.observed": 1,
            });
          } finally {
            console.info = original;
            console.warn = warn;
            await flags(false, false);
          }
        },
      );
      await t.test(
        "committed pause wins against an already-issued ready permit",
        async () => {
          const o = await held(),
            a = await issue(o);
          const present = (await admin.query("select to_regclass($1) as id", [controls]))
            .rows[0].id;
          await writer.query("begin");
          if (present) await flags(true, true);
          const pid = (await reader.query("select pg_backend_pid() pid")).rows[0].pid;
          const pending = claim(o, a).then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
          try {
            if (present) {
              const deadline = Date.now() + 4000;
              while (
                !(
                  await admin.query(
                    "select cardinality(pg_blocking_pids($1))>0 blocked",
                    [pid],
                  )
                ).rows[0].blocked
              ) {
                assert.ok(
                  Date.now() < deadline,
                  "dispatch must wait for the outstanding switch write",
                );
                await new Promise((r) => setTimeout(r, 10));
              }
            }
          } finally {
            await writer.query("commit");
          }
          const result = await pending;
          assert.equal(result.error?.message, "checkout_dispatch_paused");
          assert.equal((await issue(o)).state, "ready");
          await flags(true, false);
          assert.equal((await claim(o, a)).kind, "dispatch");
          await flags(true, true);
          assert.equal((await claim(o, a)).kind, "observe");
          // A signed receipt and the committed inquiry continue under both switches.
          const eventId = "event-" + randomUUID(),
            paymentId = "pay-" + randomUUID();
          const raw = JSON.stringify({
            type: "payment.updated",
            merchant_id: "merchant",
            event_id: eventId,
            created_at: new Date().toISOString(),
            data: {
              type: "payment",
              id: paymentId,
              object: {
                payment: { id: paymentId, location_id: "location", order_id: o.sq },
              },
            },
          });
          const url = "https://fixture.invalid/api/webhooks/square",
            key = "fixture-only";
          assert.equal(
            await verifySquareWebhookSignature({
              rawBody: raw,
              notificationUrl: url,
              signatureKey: key,
              signature: createHmac("sha256", key)
                .update(url + raw)
                .digest("base64"),
            }),
            true,
          );
          const receipt = normalizeSquareReceipt(raw, "merchant", "location");
          const inbox = new SquareWebhookInbox({
            rpc: async (name, p) => ({
              data: await rpc(writer, name, [
                p.p_event_id,
                p.p_kind,
                p.p_payload_hash,
                p.p_payload,
              ]),
              error: null,
            }),
          });
          assert.equal(await inbox.receiveSquareEvent(receipt), "stored");
          assert.equal(await inbox.receiveSquareEvent(receipt), "duplicate");
          const jobs = await rpc(reader, "claim_checkout_recovery", [
            50,
            120,
            new Date(Date.now() + 1000).toISOString(),
          ]);
          assert.ok(jobs.some((job) => job.orderId === o.id));
          assert.ok(jobs.some((job) => job.eventId === eventId));
          assert.equal((await decline(a)).state, "declined");
          assert.equal(
            (
              await reader.query(
                "select count(*)::int n from checkout_payment_attempts where order_id=$1",
                [o.id],
              )
            ).rows[0].n,
            1,
          );
          // An independent currently arriving guarded INSERT must also see the pause.
          await assert.rejects(held(), { message: "checkout_allocation_paused" });
          await flags(false, false);
        },
      );
      await t.test(
        "foreground and worker share the two configured slots across independent service sessions",
        async () => {
          const budgets = {
            version: 1,
            revision: "disposable",
            ipPerMinute: 120,
            globalPerMinute: 400,
            providers: { square: 2, shippo: 1 },
          };
          const lease = (client, budget) =>
            new CheckoutDependencyLeaseRepository(
              {
                rpc: async (name, args) => {
                  const values =
                    name === "release_checkout_dependency_lease"
                      ? [args.p_token]
                      : [args.p_dependency, args.p_limit, args.p_lease_seconds];
                  return { data: await rpc(client, name, values), error: null };
                },
              },
              budget,
            );
          const fg = lease(writer, budgets),
            worker = lease(reader, budgets);
          const input = { dependency: "square", limit: 4, leaseSeconds: 120 };
          const one = await fg.acquireDependencyLease({ ...input, limit: 2 }),
            two = await worker.acquireDependencyLease(input);
          assert.ok(one && two && one !== two);
          assert.equal(await worker.acquireDependencyLease(input), null);
          assert.equal(await fg.acquireDependencyLease({ ...input, limit: 2 }), null);
          await fg.releaseDependencyLease(one);
          const reclaimed = await worker.acquireDependencyLease(input);
          assert.ok(reclaimed);
          await worker.releaseDependencyLease(two);
          await worker.releaseDependencyLease(reclaimed);
          const legacy = lease(reader, null),
            tokens = [];
          for (let i = 0; i < 4; i++) {
            const token = await legacy.acquireDependencyLease(input);
            assert.ok(token);
            tokens.push(token);
          }
          assert.equal(await legacy.acquireDependencyLease(input), null);
          for (const token of tokens) await legacy.releaseDependencyLease(token);
        },
      );
      await t.test("only service operations may read/update switches", async () => {
        for (const role of ["anon", "authenticated", "service_role"]) {
          const {
            rows: [access],
          } = await admin.query(
            "select has_table_privilege($1,$2,'select') as read,has_column_privilege($1,$2,'pause_new_checkouts','update') as write,has_column_privilege($1,$2,'pause_payment_dispatch','update') as dispatch",
            [role, controls],
          );
          assert.deepEqual(access, {
            read: role === "service_role",
            write: role === "service_role",
            dispatch: role === "service_role",
          });
        }
      });
      await t.test(
        "only committed gateway claims spend the order allowance",
        async () => {
          const o = await held(await seedOrder());
          for (let i = 0; i < 3; i++) {
            const a = await issue(o);
            assert.equal((await issue(o)).id, a.id);
            assert.equal((await claim(o, a)).kind, "dispatch");
            assert.equal((await claim(o, a)).kind, "observe");
            await decline(a);
          }
          const fourth = await issue(o);
          await assert.rejects(claim(o, fourth), { message: "checkout_gateway_limited" });
          assert.equal((await issue(o)).state, "ready");
          await admin.query(
            "update checkout_payment_attempts set dispatched_at=clock_timestamp()-interval '30 minutes' where id=(select id from checkout_payment_attempts where order_id=$1 and dispatched_at is not null order by dispatched_at limit 1)",
            [o.id],
          );
          assert.equal((await claim(o, fourth)).kind, "dispatch");
        },
      );
      await t.test(
        "six independently admitted calls can all record their later financial outcomes",
        async () => {
          const shopper = await seedOrder(),
            inFlight = [];
          for (let i = 0; i < 6; i++) {
            const o = await held(shopper),
              a = await issue(o);
            await claim(o, a);
            inFlight.push({ o, a });
          }
          for (const [i, { o, a }] of inFlight.entries()) {
            await decline(a);
            const seconds = await rpc(reader, "checkout_financial_admission", [
              o.id,
              o.owner,
              "decline",
            ]);
            assert.equal(seconds === 0, i < 5);
          }
          assert.equal(
            (
              await reader.query(
                "select count(*)::int n from checkout_payment_attempts where owner_key=$1 and state='declined'",
                [inFlight[0].o.owner],
              )
            ).rows[0].n,
            6,
          );
        },
      );
      await t.test(
        "late confirmed declines count once across the shopper's orders",
        async () => {
          const shopper = await seedOrder();
          for (let i = 0; i < 5; i++) {
            const o = await held(shopper),
              a = await issue(o);
            await claim(o, a);
            await record(a, "unknown", null, {
              kind: "uncertain",
              reason: "outcome_unavailable",
            });
            const id = "pay-" + a.id;
            const facts = {
              kind: "square_payment",
              orderId: o.id,
              squareOrderId: o.sq,
              paymentId: id,
              status: "FAILED",
              currency: "USD",
              amountCents: 1000,
            };
            await record(a, "declined", id, facts);
            await record(a, "declined", id, facts);
          }
          const o = await held(shopper),
            a = await issue(o);
          await assert.rejects(claim(o, a), { message: "checkout_gateway_limited" });
          const afterFive = await rpc(reader, "checkout_financial_admission", [
            o.id,
            o.owner,
            "decline",
          ]);
          assert.equal(afterFive, 0);
          await admin.query(
            "update checkout_payment_attempt_history h set recorded_at=clock_timestamp()-interval '1 hour' from checkout_payment_attempts a where a.id=h.attempt_id and a.owner_key=$1 and h.state='declined'",
            [o.owner],
          );
          assert.equal((await claim(o, a)).kind, "dispatch");
          const other = await held(await seedOrder());
          assert.equal((await claim(other, await issue(other))).kind, "dispatch");
        },
      );
    },
  );
});
