import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  applyExpansion,
  connect,
  newSignature,
  reserve,
  seedCatalog,
  testUrl,
} from "./fixtures/single-store-expansion.mjs";

const target = testUrl(process.env.SINGLE_STORE_TEST_DATABASE_URL);
assert.equal(target.pathname, "/single_store_test_expansion_20261123");
let db;
let winner;
let contender;
let catalog;
let winningOrder;
let installed = false;
before(async () => {
  db = await connect(target.href);
  await db.query("begin");
  if (
    !(await db.query("select to_regprocedure($1) present", [newSignature])).rows[0]
      .present
  ) {
    await applyExpansion(db);
    installed = true;
  }
  catalog = await seedCatalog(db);
  await db.query("commit");
  winner = await connect(target.href);
  contender = await connect(target.href);
});
after(async () => {
  for (const client of [winner, contender]) {
    await client?.query("rollback");
    await client?.end();
  }
  if (catalog) {
    await db.query("begin");
    await db.query(
      "delete from public.orders where idempotency_key in ('expansion-concurrency-winner','expansion-concurrency-contender')",
    );
    await db.query("delete from public.product_variants where id=$1", [catalog.variant]);
    await db.query("delete from public.products where id=$1", [catalog.product]);
    await db.query("delete from public.tag_sizes where id=$1", [catalog.size]);
    await db.query("delete from public.tag_brands where id=$1", [catalog.brand]);
    if (installed)
      await db.query(`drop function ${newSignature};
      drop function public.upsert_store_access_settings(boolean,timestamptz,boolean,text);
      drop function public.get_store_access_settings();
      drop function public._single_store_compat_owner()`);
    await db.query("commit");
  }
  await db?.end();
});

test("competing real old/new transactions allocate the last stock exactly once", async () => {
  await winner.query("begin; set local role service_role");
  await contender.query(
    "begin; set local statement_timeout='5s'; set local role service_role",
  );
  winningOrder = await reserve(winner, catalog, { key: "expansion-concurrency-winner" });
  const pending = reserve(contender, catalog, {
    legacy: true,
    key: "expansion-concurrency-contender",
  }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  const blocked = await Promise.race([
    pending.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), 100)),
  ]);
  assert.equal(
    blocked,
    true,
    "Contending old caller must wait while new caller owns the stock lock",
  );
  await winner.query("commit");
  const result = await pending;
  assert.equal(result.error?.message, "checkout_inventory_unavailable");
  await contender.query("rollback");
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        catalog.variant,
      ])
    ).rows[0].stock,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.orders where idempotency_key in ('expansion-concurrency-winner','expansion-concurrency-contender')",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select sum(quantity)::int n from public.inventory_reservations where order_id=$1",
        [winningOrder.order_id],
      )
    ).rows[0].n,
    1,
  );
});
