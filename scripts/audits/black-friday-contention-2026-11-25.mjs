// Diagnostic only: the final assertion intentionally reproduces an existing refund-state defect.
// Run only against the explicitly named disposable local audit database; see the assessment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyExpansion,
  connect,
  reserve,
  seedCatalog,
  newSignature,
} from "../../tests/database/fixtures/single-store-expansion.mjs";
const url = process.env.SINGLE_STORE_TEST_DATABASE_URL;
assert.equal(new URL(url).pathname, "/single_store_test_blackfriday_audit_20261125");
const db = await connect(url);
let clients = [];
try {
  await db.query("begin");
  if (!(await db.query("select to_regprocedure($1) f", [newSignature])).rows[0].f)
    await applyExpansion(db);
  const catalog = await seedCatalog(db);
  await db.query("commit");
  clients = await Promise.all(Array.from({ length: 32 }, () => connect(url)));
  await Promise.all(
    clients.map((c) =>
      c.query("begin; set local role service_role; set local statement_timeout='10s'"),
    ),
  );
  let release;
  const start = new Promise((r) => {
    release = r;
  });
  const attempts = clients.map((c, i) =>
    (async () => {
      await start;
      try {
        const result = await reserve(c, catalog, {
          legacy: i % 2 === 0,
          key: "audit-burst-" + i,
        });
        await c.query("commit");
        return { winner: result.order_id };
      } catch (e) {
        await c.query("rollback");
        return { error: e.message };
      }
    })(),
  );
  release();
  const outcomes = await Promise.all(attempts);
  assert.equal(outcomes.filter((o) => o.winner).length, 1);
  assert.equal(
    outcomes.filter((o) => o.error === "checkout_inventory_unavailable").length,
    31,
  );
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        catalog.variant,
      ])
    ).rows[0].stock,
    0,
  );
  console.log(
    "PASS: 32 concurrent real transactions, one winner, 31 stock conflicts, stock=0",
  );
  const orderId = outcomes.find((o) => o.winner).winner;
  const releases = await Promise.all(
    clients
      .slice(0, 2)
      .map((c) =>
        c.query("select public.release_square_checkout_reservation($1,$2) released", [
          orderId,
          "synthetic_audit",
        ]),
      ),
  );
  assert.equal(releases.filter((r) => r.rows[0].released === true).length, 1);
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        catalog.variant,
      ])
    ).rows[0].stock,
    1,
  );
  console.log("PASS: concurrent repeated release restored exactly one unit");
  const line = {
    product_id: catalog.product,
    variant_id: catalog.variant,
    quantity: 1,
    unit_price_cents: 500,
    unit_cost_cents: 0,
    line_total_cents: 500,
    variant_sku: "audit",
    product_name: "Audit",
    brand: "Audit",
    model: null,
    category: "accessories",
    condition: "new",
    size_label: "none",
  };
  await db.query("begin");
  await assert.rejects(
    reserve(db, catalog, {
      key: "audit-basket-rollback",
      items: [line, { ...line, variant_id: randomUUID() }],
    }),
    /checkout_inventory_unavailable/,
  );
  await db.query("rollback");
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        catalog.variant,
      ])
    ).rows[0].stock,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.orders where idempotency_key='audit-basket-rollback'",
      )
    ).rows[0].n,
    0,
  );
  console.log("PASS: failed multi-item basket rolled back its allocated unit and order");
  await db.query("begin");
  const paid = await reserve(db, catalog, { key: "audit-refund-replay" });
  await db.query(
    "select public.consume_square_checkout_reservation($1,'synthetic-payment',now())",
    [paid.order_id],
  );
  await db.query("update public.orders set status='refunded' where id=$1", [
    paid.order_id,
  ]);
  await db.query(
    "select public.consume_square_checkout_reservation($1,'synthetic-payment',now())",
    [paid.order_id],
  );
  assert.equal(
    (await db.query("select status from public.orders where id=$1", [paid.order_id]))
      .rows[0].status,
    "review",
  );
  console.log(
    "REPRODUCED: consuming the same paid reservation after refund changes status from refunded to review",
  );
  await db.query("rollback");
} finally {
  await Promise.all(clients.map((c) => c.end()));
  await db.end();
}
