import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

test("verified settlement, fulfillment and distinct refund obligations", async (t) => {
  await withCheckoutDatabase(
    process.env.CHECKOUT_LEDGER_MODE ?? "fresh",
    async ({ admin, connect, seedOrder, seedCatalog, populated }) => {
      const { orderId, userId } = await seedOrder();
      const { variantId, productId } = await seedCatalog({ stock: 1 });
      const paymentId = "payment-" + randomUUID();
      const squareOrderId = "square-" + orderId;
      await admin.query(
        "update public.orders set fulfillment='ship', payment_transaction_id=$2,square_order_id=$3 where id=$1",
        [orderId, paymentId, squareOrderId],
      );
      await admin.query(
        "insert into public.order_items(order_id,product_id,variant_id,quantity,unit_price,line_total) values ($1,$2,$3,1,10,10)",
        [orderId, productId, variantId],
      );
      await admin.query(
        "insert into public.inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,expires_at from public.orders where id=$1",
        [orderId, variantId],
      );
      const service = await connect("service_role");
      const observer = await connect("service_role");
      const attempt = (
        await service.query(
          "select public.get_or_create_checkout_payment_attempt($1,'card',$2) a",
          [orderId, "account:" + userId],
        )
      ).rows[0].a;
      await service.query(
        "select public.record_checkout_payment_outcome($1,$2,'succeeded',$3)",
        [
          attempt.id,
          paymentId,
          {
            kind: "square_payment",
            orderId,
            squareOrderId,
            paymentId,
            status: "COMPLETED",
            amountCents: 1000,
            currency: "USD",
          },
        ],
      );
      const initial = {
        kind: "payment",
        orderId,
        providerId: paymentId,
        paymentId,
        providerVersion: "z",
        status: "COMPLETED",
        amountCents: 1000,
        expectedTotalCents: 1000,
        currency: "USD",
        fulfillmentStatus: "unfulfilled",
      };
      const receiveAt = new Date().toISOString();
      const eventId = randomUUID();
      await service.query(
        "select public.receive_checkout_square_event($1,'payment.updated',$2,$3)",
        [
          eventId,
          "a".repeat(64),
          {
            merchantId: "fixture",
            locationId: "fixture",
            createdAt: receiveAt,
            paymentId,
            squareOrderId,
          },
        ],
      );
      assert.equal(
        (
          await observer.query(
            "select processed_at from public.square_webhook_events where square_event_id=$1",
            [eventId],
          )
        ).rows[0].processed_at,
        null,
      );
      const apply = async (client, fact) =>
        (
          await client.query(
            "select public.apply_checkout_financial_fact($1,$2,$3) snapshot",
            [fact, receiveAt, null],
          )
        ).rows[0].snapshot;
      const rollbackCase = (name, run) =>
        t.test(name, async () => {
          await service.query("begin");
          try {
            await run();
          } finally {
            await service.query("rollback");
          }
        });
      if (populated)
        await rollbackCase(
          "migration carries the pre-existing risk hold through a verified capture",
          async () => {
            const prior = populated.legacyReview;
            const previous = (
              await service.query(
                "select status,failure_reason,checkout_financial_review from public.orders where id=$1",
                [prior.orderId],
              )
            ).rows[0];
            assert.deepEqual(previous, {
              status: "review",
              failure_reason: "square_payment_high_risk",
              checkout_financial_review: "square_payment_high_risk",
            });
            const ledger = (
              await service.query(
                "select public.get_or_create_checkout_payment_attempt($1,'card',$2) a",
                [prior.orderId, "account:" + prior.userId],
              )
            ).rows[0].a;
            await service.query(
              "insert into public.order_items(order_id,product_id,variant_id,quantity,unit_price,line_total) values ($1,$2,$3,1,10,10)",
              [prior.orderId, productId, variantId],
            );
            await service.query(
              "insert into public.inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,expires_at from public.orders where id=$1",
              [prior.orderId, variantId],
            );
            const id = "pay-" + prior.orderId;
            await service.query(
              "select public.record_checkout_payment_outcome($1,$2,'succeeded',$3)",
              [
                ledger.id,
                id,
                {
                  kind: "square_payment",
                  orderId: prior.orderId,
                  squareOrderId: "sq-" + prior.orderId,
                  paymentId: id,
                  amountCents: 1000,
                  currency: "USD",
                  status: "COMPLETED",
                },
              ],
            );
            const snap = await apply(service, {
              ...initial,
              orderId: prior.orderId,
              paymentId: id,
              providerId: id,
            });
            assert.equal(snap.capturedCents, 1000);
            assert.equal(snap.reviewReason, "square_payment_high_risk");
            assert.equal(
              (
                await service.query(
                  "select status from public.inventory_reservations where order_id=$1",
                  [prior.orderId],
                )
              ).rows[0].status,
              "active",
            );
            assert.equal(
              (
                await service.query(
                  "select count(*)::int n from public.checkout_notification_outbox where order_id=$1",
                  [prior.orderId],
                )
              ).rows[0].n,
              0,
            );
            assert.equal(
              (
                await service.query("select status from public.orders where id=$1", [
                  prior.orderId,
                ])
              ).rows[0].status,
              "review",
            );
          },
        );
      for (const status of ["COMPLETED", "PENDING", "FAILED"]) {
        for (const first of [true, false])
          await rollbackCase(
            "pickup notification set " + status + " refund first=" + first,
            async () => {
              await service.query(
                "update public.orders set fulfillment='pickup' where id=$1",
                [orderId],
              );
              const ref = {
                ...initial,
                kind: "refund",
                providerId: "permutation",
                amountCents: 350,
                status,
              };
              for (const fact of first ? [ref, initial] : [initial, ref])
                await apply(service, fact);
              const kinds = (
                await service.query(
                  "select kind from public.checkout_notification_outbox where order_id=$1 order by kind",
                  [orderId],
                )
              ).rows.map((row) => row.kind);
              assert.deepEqual(
                kinds,
                status === "COMPLETED"
                  ? ["order_confirmation", "pickup_instructions", "refund_confirmation"]
                  : ["order_confirmation", "pickup_instructions"],
              );
            },
          );
      }
      for (const status of ["FAILED", "REJECTED"]) {
        await rollbackCase(
          "same opaque refund version PENDING then " + status,
          async () => {
            await apply(service, initial);
            const pending = {
              ...initial,
              kind: "refund",
              providerId: "sameversion",
              status: "PENDING",
              amountCents: 350,
            };
            await apply(service, pending);
            const changed = { ...pending, status };
            const snap = await apply(service, changed);
            assert.equal(snap.reviewReason, "square_status_conflict");
            assert.equal(snap.refundedCents, 0);
            assert.equal(
              (
                await service.query(
                  "select checkout_status_conflict from public.square_refunds where square_refund_id=$1",
                  [pending.providerId],
                )
              ).rows[0].checkout_status_conflict,
              true,
            );
            assert.deepEqual(await apply(service, changed), snap);
            assert.equal(
              (
                await service.query(
                  "select count(*)::int n from public.checkout_notification_outbox where order_id=$1 and kind='refund_confirmation'",
                  [orderId],
                )
              ).rows[0].n,
              0,
            );
          },
        );
      }
      for (const first of [true, false])
        await rollbackCase("contradictory refund completion first=" + first, async () => {
          await apply(service, initial);
          const done = {
            ...initial,
            kind: "refund",
            providerId: "terminal",
            amountCents: 450,
          };
          const no = { ...done, status: "FAILED", providerVersion: "nonchronological" };
          await apply(service, first ? done : no);
          const result = await apply(service, first ? no : done);
          assert.deepEqual(result, {
            orderId,
            revision: "3",
            financialState: "partially_refunded",
            capturedCents: 1000,
            refundedCents: 450,
            fulfillmentStatus: "unfulfilled",
            reviewReason: "square_status_conflict",
          });
          assert.deepEqual(await apply(service, done), result);
          assert.equal(
            (
              await service.query(
                "select checkout_status_conflict from public.square_refunds where square_refund_id='terminal'",
              )
            ).rows[0].checkout_status_conflict,
            true,
          );
        });
      await rollbackCase(
        "replayed decline preserves later captured order and payment binding",
        async () => {
          const localId = randomUUID(),
            sq = "sq-" + localId;
          await service.query(
            "insert into public.orders(id,tenant_id,user_id,status,subtotal,shipping,total,currency,fulfillment,expires_at,cart_hash,square_order_id,checkout_attempt_guarded) select $1,tenant_id,user_id,'pending',subtotal,shipping,total,currency,fulfillment,expires_at,'fixture-cart',$3,true from public.orders where id=$2",
            [localId, orderId, sq],
          );
          await service.query(
            "insert into public.order_items(order_id,product_id,variant_id,quantity,unit_price,line_total) values ($1,$2,$3,1,10,10)",
            [localId, productId, variantId],
          );
          await service.query(
            "insert into public.inventory_reservations(order_id,tenant_id,variant_id,quantity,expires_at) select id,tenant_id,$2,1,expires_at from public.orders where id=$1",
            [localId, variantId],
          );
          const replay = [];
          for (const [id, state, status] of [
            ["early", "declined", "FAILED"],
            ["paid", "succeeded", "COMPLETED"],
          ]) {
            const key = "account:" + userId;
            const ledger = (
              await service.query(
                "select public.get_or_create_checkout_payment_attempt($1,'card',$2) a",
                [localId, key],
              )
            ).rows[0].a;
            await service.query(
              "select public.begin_checkout_payment_dispatch($1,$2,$3,$4)",
              [ledger.id, key, "a".repeat(64), "b".repeat(64)],
            );
            await service.query(
              "select public.record_checkout_payment_outcome($1,$2,$3,$4)",
              [
                ledger.id,
                id,
                state,
                {
                  kind: "square_payment",
                  orderId: localId,
                  squareOrderId: sq,
                  paymentId: id,
                  amountCents: 1000,
                  currency: "USD",
                  status,
                },
              ],
            );
            const fact = {
              ...initial,
              providerId: id,
              paymentId: id,
              orderId: localId,
              status,
            };
            await apply(service, fact);
            replay.push(fact);
          }
          const result = await apply(service, replay[0]);
          assert.equal(result.capturedCents, 1000);
          assert.equal(result.financialState, "paid");
          assert.equal(
            (
              await service.query(
                "select payment_transaction_id from public.orders where id=$1",
                [localId],
              )
            ).rows[0].payment_transaction_id,
            "paid",
          );
        },
      );
      // A provider refund may arrive before the first capture projection.
      // An independent payment proof is required before making a pickup/shipment eligible.
      await service.query("begin");
      try {
        const refundFirst = await apply(service, {
          ...initial,
          kind: "refund",
          providerId: "early",
          amountCents: 350,
        });
        assert.equal(refundFirst.refundedCents, 350);
        const beforeCapture = (
          await service.query("select status from public.orders where id=$1", [orderId])
        ).rows[0];
        assert.equal(beforeCapture.status, "pending");
        const afterCapture = await apply(service, initial);
        assert.equal(afterCapture.financialState, "partially_refunded");
        assert.equal(
          (
            await service.query(
              "select status from public.inventory_reservations where order_id=$1",
              [orderId],
            )
          ).rows[0].status,
          "consumed",
        );
      } finally {
        await service.query("rollback");
      }
      await service.query("begin");
      try {
        await service.query(
          "select public.apply_checkout_financial_fact($1,$2,'square_payment_high_risk')",
          [initial, receiveAt],
        );
        const afterReview = await apply(service, {
          ...initial,
          kind: "refund",
          providerId: "reviewed-refund",
          amountCents: 1000,
        });
        assert.equal(afterReview.reviewReason, "square_payment_high_risk");
        assert.equal(afterReview.refundedCents, 1000);
      } finally {
        await service.query("rollback");
      }
      await service.query("begin");
      try {
        await service.query("update public.orders set fulfillment='pickup' where id=$1", [
          orderId,
        ]);
        await apply(service, initial);
        await apply(service, initial);
        const pickup = (
          await service.query(
            "select kind from public.checkout_notification_outbox where order_id=$1 order by kind",
            [orderId],
          )
        ).rows;
        assert.deepEqual(pickup, [
          { kind: "order_confirmation" },
          { kind: "pickup_instructions" },
        ]);
      } finally {
        await service.query("rollback");
      }
      const paid = await apply(service, initial);
      assert.equal(paid.capturedCents, 1000);
      await admin.query(
        "update public.orders set fulfillment_status='shipped',status='shipped' where id=$1",
        [orderId],
      );
      const refund = (id, amount) => ({
        ...initial,
        kind: "refund",
        providerId: id,
        amountCents: amount,
      });
      const partial = await apply(service, refund("r2", 600));
      assert.equal(partial.financialState, "partially_refunded");
      const [first, second] = await Promise.all([
        apply(service, refund("r1", 400)),
        apply(observer, refund("r1", 400)),
      ]);
      assert.equal(first.refundedCents, 1000);
      assert.equal(second.refundedCents, 1000);
      const replay = await apply(observer, { ...initial, providerVersion: "a" });
      assert.equal(replay.financialState, "refunded");
      assert.equal(replay.fulfillmentStatus, "shipped");
      assert.equal(replay.reviewReason, null);
      const order = (
        await observer.query(
          "select status,refund_amount,fulfillment_status from public.orders where id=$1",
          [orderId],
        )
      ).rows[0];
      assert.equal(order.status, "refunded");
      assert.equal(Number(order.refund_amount), 1000);
      const disputeEvent = randomUUID();
      await service.query(
        "select public.receive_checkout_square_event($1,'dispute.created',$2,$3)",
        [
          disputeEvent,
          "d".repeat(64),
          {
            merchantId: "fixture",
            locationId: "fixture",
            createdAt: receiveAt,
            paymentId,
            disputeId: "d1",
          },
        ],
      );
      const dispute = {
        id: "d1",
        paymentId,
        state: "WON",
        reason: "FRAUD",
        amountCents: 500,
        currency: "USD",
        updatedAt: receiveAt,
        dueAt: null,
      };
      await Promise.all(
        [service, observer].map((client) =>
          client.query("select public.apply_checkout_dispute_receipt($1,$2,$3)", [
            disputeEvent,
            orderId,
            dispute,
          ]),
        ),
      );
      assert.equal(
        (
          await observer.query(
            "select count(*)::int n from public.order_events where order_id=$1 and type='payment_dispute_created'",
            [orderId],
          )
        ).rows[0].n,
        1,
      );
      assert.ok(
        (
          await observer.query(
            "select processed_at from public.square_webhook_events where square_event_id=$1",
            [disputeEvent],
          )
        ).rows[0].processed_at,
      );
      const conflict = await apply(service, {
        ...initial,
        amountCents: 1100,
        providerVersion: "conflict",
      });
      assert.equal(conflict.financialState, "refunded");
      assert.equal(conflict.reviewReason, "square_amount_conflict");
      await assert.rejects(apply(service, { ...initial, currency: "EUR" }));
      await assert.rejects(apply(service, { ...initial, expectedTotalCents: 1100 }));
      await assert.rejects(apply(service, { ...initial, orderId: randomUUID() }));
      const notifications = (
        await observer.query(
          "select kind,count(*)::int n from public.checkout_notification_outbox where order_id=$1 group by kind order by kind",
          [orderId],
        )
      ).rows;
      assert.deepEqual(notifications, [
        { kind: "order_confirmation", n: 1 },
        { kind: "refund_confirmation", n: 2 },
      ]);
    },
  );
});
