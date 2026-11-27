import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { reserve, seedCatalog } from "./fixtures/single-store-expansion.mjs";
import { before, after, beforeEach, afterEach, test } from "node:test";
import {
  applySpecialtyMigrations,
  asRole,
  prepareTestDatabase,
  seedActor,
  seedPrize,
  prizeInput,
  dropTestDatabase,
} from "./fixtures/specialty-claims.mjs";

let db;
before(async () => {
  db = await prepareTestDatabase();
  await applySpecialtyMigrations(db);
});
after(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
});
afterEach(async () => {
  await db.query("rollback");
});

test("campaign starts disabled with a stable normalization version", async () => {
  const row = (
    await db.query(
      "select * from public.specialty_campaigns where slug='black-friday-2026'",
    )
  ).rows[0];
  assert.equal(row.enabled, false);
  assert.equal(row.normalization_version, 1);
});
test("atomically creates one zero-price no-size prize and its images/configuration", async () => {
  const prize = await seedPrize(db, { quantity: 3 });
  const row = (
    await db.query(
      "select p.category,p.size_type,p.shipping_price_cents,v.stock,v.sale_price_cents from public.products p join public.product_variants v on v.product_id=p.id where p.id=$1",
      [prize.productId],
    )
  ).rows[0];
  assert.deepEqual(row, {
    category: "specialty",
    size_type: "none",
    shipping_price_cents: 0,
    stock: 3,
    sale_price_cents: 0,
  });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.product_variants where product_id=$1",
        [prize.productId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.product_images where product_id=$1",
        [prize.productId],
      )
    ).rows[0].n,
    1,
  );
});
test("failed prize creation cannot leave a partially published product", async () => {
  const { actor, owner } = await seedActor(db);
  const count = (await db.query("select count(*)::int n from public.products")).rows[0].n;
  await db.query("savepoint bad_create");
  await assert.rejects(
    db.query("select public.save_specialty_product(null,$1::jsonb,$2,$3)", [
      JSON.stringify(prizeInput(-1)),
      actor,
      owner,
    ]),
    /specialty_invalid_product/,
  );
  await db.query("rollback to savepoint bad_create");
  assert.equal(
    (await db.query("select count(*)::int n from public.products")).rows[0].n,
    count,
  );
});
test("ordinary and specialty category conversion cannot bypass dedicated prize creation", async () => {
  const prize = await seedPrize(db);
  await db.query("savepoint conversion");
  await assert.rejects(
    db.query("update public.products set category='accessories' where id=$1", [
      prize.productId,
    ]),
    /specialty/,
  );
  await db.query("rollback to savepoint conversion");
});
test("direct stock and sale price writes cannot bypass prize protections", async () => {
  const prize = await seedPrize(db);
  for (const query of [
    "update public.product_variants set stock=100 where id=$1",
    "update public.product_variants set sale_price_cents=100 where id=$1",
  ]) {
    await db.query("savepoint bad_stock");
    await assert.rejects(db.query(query, [prize.variantId]), /specialty/);
    await db.query("rollback to savepoint bad_stock");
  }
});
test("anon and customer roles cannot read private claims or execute prize mutation", async () => {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(
      asRole(db, role, () =>
        db.query(
          "select instagram_handle,eligibility_address from public.specialty_claims",
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      asRole(db, role, () =>
        db.query("select public.save_specialty_product(null,'{}'::jsonb,null,null)"),
      ),
      /permission denied/,
    );
  }
});
test("metadata saves preserve quantity and reject stale revisions", async () => {
  const prize = await seedPrize(db, { quantity: 2 });
  const updated = {
    ...prize.input,
    mode: "update",
    productId: prize.productId,
    expectedRevision: prize.revision,
    name: "Edited fixture",
  };
  delete updated.quantity;
  const result = (
    await db.query("select public.save_specialty_product($1,$2::jsonb,$3,$4) result", [
      prize.productId,
      JSON.stringify(updated),
      prize.actor,
      prize.owner,
    ])
  ).rows[0].result;
  assert.equal(result.revision, prize.revision + 1);
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        prize.variantId,
      ])
    ).rows[0].stock,
    2,
  );
  await db.query("savepoint stale");
  await assert.rejects(
    db.query("select public.save_specialty_product($1,$2::jsonb,$3,$4)", [
      prize.productId,
      JSON.stringify(updated),
      prize.actor,
      prize.owner,
    ]),
    /specialty_revision_conflict/,
  );
  await db.query("rollback to savepoint stale");
});
test("enabling pins key identity and cannot silently rotate it", async () => {
  const { actor } = await seedActor(db);
  const campaign = (
    await db.query(
      "select * from public.specialty_campaigns where slug='black-friday-2026'",
    )
  ).rows[0];
  const result = (
    await db.query(
      "select public.set_specialty_campaign_enabled($1,true,$2,$3,$4) result",
      [campaign.id, Number(campaign.revision), actor, "a".repeat(64)],
    )
  ).rows[0].result;
  assert.equal(result.enabled, true);
  await db.query("savepoint rotate");
  await assert.rejects(
    db.query("select public.set_specialty_campaign_enabled($1,true,$2,$3,$4)", [
      campaign.id,
      result.revision,
      actor,
      "b".repeat(64),
    ]),
    /specialty_identity_key_mismatch/,
  );
  await db.query("rollback to savepoint rotate");
  const disabled = (
    await db.query(
      "select public.set_specialty_campaign_enabled($1,false,$2,$3,null) result",
      [campaign.id, result.revision, actor],
    )
  ).rows[0].result;
  assert.equal(disabled.enabled, false);
});

test("ordinary checkout still reserves stock while legacy checkout cannot take a specialty prize", async () => {
  await seedActor(db);
  const ordinary = await seedCatalog(db);
  const reserved = await reserve(db, ordinary, {
    key: "ordinary-claim-regression-" + randomUUID(),
  });
  assert.ok(reserved.order_id);
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        ordinary.variant,
      ])
    ).rows[0].stock,
    0,
  );
  const prize = await seedPrize(db);
  await db.query("savepoint forbidden_checkout");
  await assert.rejects(
    reserve(
      db,
      { owner: prize.owner, product: prize.productId, variant: prize.variantId },
      { legacy: true, key: "forged-specialty-" + randomUUID() },
    ),
    /specialty_/,
  );
  await db.query("rollback to savepoint forbidden_checkout");
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        prize.variantId,
      ])
    ).rows[0].stock,
    1,
  );
});

test("fresh populated baseline replays the additive migration without altering ordinary inventory", async () => {
  const originalUrl = process.env.SPECIALTY_TEST_DATABASE_URL;
  const target = new URL(originalUrl);
  target.pathname = "/specialty_test_populated_" + randomUUID().replaceAll("-", "");
  let copy;
  try {
    process.env.SPECIALTY_TEST_DATABASE_URL = target.href;
    copy = await prepareTestDatabase();
    process.env.SPECIALTY_TEST_DATABASE_URL = originalUrl;
    assert.equal(
      (await copy.query("select to_regclass('public.specialty_campaigns') value")).rows[0]
        .value,
      null,
    );
    const { owner } = await seedActor(copy);
    const brand = (
      await copy.query(
        "insert into public.tag_brands(canonical_label) values($1) returning id",
        ["Ordinary fixture " + randomUUID()],
      )
    ).rows[0].id;
    const size = (
      await copy.query(
        "insert into public.tag_sizes(canonical_label,size_type) values($1,'none') returning id",
        ["Fixture " + randomUUID()],
      )
    ).rows[0].id;
    const product = (
      await copy.query(
        "insert into public.products(tenant_id,name,category,condition,size_type,brand_id) values($1,'Existing ordinary item','accessories','new','none',$2) returning id",
        [owner, brand],
      )
    ).rows[0].id;
    await copy.query(
      "insert into public.product_variants(tenant_id,product_id,size_id,sku,sale_price_cents,stock) values($1,$2,$3,$4,1500,7)",
      [owner, product, size, "ordinary-" + randomUUID()],
    );
    const snapshot = () =>
      copy.query(
        "select to_jsonb(p) product,to_jsonb(v) variant from public.products p join public.product_variants v on v.product_id=p.id where p.id=$1",
        [product],
      );
    const before = (await snapshot()).rows;
    await applySpecialtyMigrations(copy);
    assert.deepEqual((await snapshot()).rows, before);
    assert.equal(
      (
        await copy.query(
          "select enabled from public.specialty_campaigns where slug='black-friday-2026'",
        )
      ).rows[0].enabled,
      false,
    );
  } finally {
    process.env.SPECIALTY_TEST_DATABASE_URL = originalUrl;
    await copy?.end();
    await dropTestDatabase(target.href);
  }
});
