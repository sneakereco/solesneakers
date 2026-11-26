import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDisposableLoadDatabase,
  disposableLoadUrl,
} from "./fixtures/load-test.mjs";
import {
  reserve,
  applyExpansion,
  newSignature,
} from "./fixtures/single-store-expansion.mjs";
import { createFixtureClients } from "../load/operator/fixture-clients.mjs";
test("remote or production-like database is rejected before writes", () => {
  assert.throws(
    () => disposableLoadUrl("postgresql://user:private@production.test:5432/postgres"),
    /Refusing/,
  );
  assert.throws(
    () => disposableLoadUrl("postgresql://postgres:postgres@127.0.0.1:64332/postgres"),
    /Refusing/,
  );
});
test("real independent connections conserve stock for 1 10 100 concurrent winners and releases", async () => {
  const stack = await createDisposableLoadDatabase();
  try {
    const db = await stack.connect();
    if (
      !(await db.query("select to_regprocedure($1) present", [newSignature])).rows[0]
        .present
    )
      await applyExpansion(db);
    const workers = await Promise.all(Array.from({ length: 16 }, () => stack.connect()));
    for (const stock of [1, 10, 100]) {
      const runId = randomUUID(),
        data = {
          id: randomUUID(),
          variantId: randomUUID(),
          brandId: randomUUID(),
          sizeId: randomUUID(),
          imageId: randomUUID(),
          runId,
          name: `Load ${runId}`,
          stock,
          priceCents: 1000,
          sku: `load-${runId}`,
        };
      await createFixtureClients({ db, runId }).catalog.ensure(data);
      const catalog = { product: data.id, variant: data.variantId };
      const winners = [];
      const failures = [];
      await Promise.all(
        workers.map(async (worker, index) => {
          for (let n = index; n < stock + 20; n += workers.length) {
            try {
              winners.push(await reserve(worker, catalog, { key: `${runId}-${n}` }));
            } catch (error) {
              failures.push(error.message);
            }
          }
        }),
      );
      assert.equal(winners.length, stock);
      assert.ok(failures.every((x) => x === "checkout_inventory_unavailable"));
      assert.equal(
        (
          await db.query("select stock from public.product_variants where id=$1", [
            data.variantId,
          ])
        ).rows[0].stock,
        0,
      );
      const first = winners[0].order_id;
      assert.equal(
        (
          await db.query(
            "select public.release_square_checkout_reservation($1,'load-release') value",
            [first],
          )
        ).rows[0].value,
        true,
      );
      const later = await reserve(workers[0], catalog, { key: `${runId}-later` });
      assert.ok(later.order_id);
      const quantities = (
        await db.query(
          "select coalesce(sum(quantity) filter(where status in('active','consumed')),0)::int n from public.inventory_reservations where variant_id=$1",
          [data.variantId],
        )
      ).rows[0].n;
      assert.equal(quantities, stock);
      const squareId = `lt-db-${later.order_id}`,
        paymentId = `lt-payment-${later.order_id}`,
        eventId = `lt-event-${later.order_id}`;
      await db.query(
        "select public.attach_square_checkout_order($1,$2,1,0,0,1000,'square:load-fixture')",
        [later.order_id, squareId],
      );
      const values = [
        eventId,
        "payment.updated",
        "fixture-merchant",
        "fixture-location",
        new Date().toISOString(),
        "a".repeat(64),
        {},
        squareId,
        paymentId,
        "COMPLETED",
        1000,
        "USD",
        "NORMAL",
      ];
      const query =
        "select public.process_square_payment_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value";
      await workers[0].query("begin");
      const paid = (await workers[0].query(query, values)).rows[0].value;
      assert.equal(paid.fulfillment_authorized, true);
      const expiry = workers[1].query(
        "select public.release_square_checkout_reservation($1,'expired') value",
        [later.order_id],
      );
      assert.equal(
        await Promise.race([
          expiry.then(() => false),
          new Promise((resolve) => setTimeout(() => resolve(true), 50)),
        ]),
        true,
        "Expiry must wait for payment transaction lock",
      );
      await workers[0].query("commit");
      assert.equal((await expiry).rows[0].value, false);
      assert.equal((await db.query(query, values)).rows[0].value.duplicate, true);
      for (let replay = 0; replay < 2; replay++)
        await db.query(
          "select public.record_square_payment_details($1,$2,'COMPLETED',1000,'USD',$3)",
          [
            squareId,
            paymentId,
            { source_type: "CARD", card_type: "VISA", card_last4: "1111" },
          ],
        );
      assert.equal(
        (
          await db.query(
            "select public.release_square_checkout_reservation($1,'expired') value",
            [later.order_id],
          )
        ).rows[0].value,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from public.payment_transactions where order_id=$1",
            [later.order_id],
          )
        ).rows[0].n,
        1,
      );
    }
  } finally {
    await stack.close();
  }
});
