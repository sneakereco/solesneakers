import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import {
  applyExpansion,
  connect,
  expectSqlError,
  fingerprint,
  newSignature,
  oldSignature,
  reserve,
  seedCatalog,
} from "./fixtures/single-store-expansion.mjs";

let db;
let inspectExpansion;
try {
  ({ inspectExpansion } = await import(
    "../../scripts/single-store/verify-expansion.mjs"
  ));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
before(async () => {
  db = await connect(process.env.SINGLE_STORE_TEST_DATABASE_URL);
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

test("read-only expansion verifier detects absent contracts and records only aggregate fingerprints", async () => {
  assert.equal(
    typeof inspectExpansion,
    "function",
    "Missing read-only expansion verifier",
  );
  const beforeRows = await fingerprint(db);
  const report = await inspectExpansion({
    connectionString: process.env.SINGLE_STORE_TEST_DATABASE_URL,
  });
  assert.equal(report.ready, false);
  assert.equal(report.transaction.readOnly, true);
  assert.deepEqual(report.fingerprints, beforeRows);
  assert.doesNotMatch(
    JSON.stringify(report),
    /fixture@example|supabase_storage|private-password/,
  );
});

test("service can reserve through tenant-free signature without changing old callers", async () => {
  // Before implementation, exercise the desired real SQL interface directly.
  // With implementation present, its DDL runs in this rollback-only transaction.
  try {
    await applyExpansion(db);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const catalog = await seedCatalog(db);
  await db.query("set local role service_role");
  const result = await reserve(db, catalog);
  assert.equal(result.reused, false);
  const repeat = await reserve(db, catalog, { legacy: true });
  assert.equal(repeat.order_id, result.order_id);
  assert.equal(repeat.reused, true);
  await db.query("reset role");
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
        "select count(*)::int n from public.order_billing where order_id=$1",
        [result.order_id],
      )
    ).rows[0].n,
    1,
  );
});

test("expansion retains every row, old routine body/ACL, policy, and existing trigger", async () => {
  const beforeRows = await fingerprint(db);
  const inventory = async () =>
    (
      await db.query(`select jsonb_build_object(
    'routines',(select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,pg_get_functiondef(p.oid),p.proacl) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f'),
    'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public'),
    'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by oid) from pg_trigger where not tgisinternal)
  ) as data`)
    ).rows[0].data;
  const beforeSchema = await inventory();
  await applyExpansion(db);
  assert.deepEqual(await fingerprint(db), beforeRows);
  const afterSchema = await inventory();
  for (const original of beforeSchema.routines)
    assert.ok(
      afterSchema.routines.some(
        (row) => JSON.stringify(row) === JSON.stringify(original),
      ),
    );
  assert.deepEqual(afterSchema.policies, beforeSchema.policies);
  for (const original of beforeSchema.triggers)
    assert.ok(afterSchema.triggers.includes(original));
});

test("exact new/old overloads allow service only and all internal helpers remain owner only", async () => {
  await applyExpansion(db);
  const helpers = (
    await db.query(
      `select p.oid::regprocedure::text signature from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like '_single_store_compat_%' or p.proname in ('reserve_square_checkout_inventory_without_billing','reserve_square_checkout_inventory_with_address'))`,
    )
  ).rows;
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const signature of [
      oldSignature,
      newSignature,
      ...helpers.map((row) => row.signature),
    ]) {
      const entry = [oldSignature, newSignature].includes(signature);
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [
            role,
            signature,
          ])
        ).rows[0].allowed,
        entry && role === "service_role",
        `${role}: ${signature}`,
      );
      if (!(entry && role === "service_role")) {
        const qualified = signature.startsWith("public.")
          ? signature
          : `public.${signature}`;
        const [name, argumentsText] = qualified.slice(0, -1).split("(");
        const args = argumentsText
          ? argumentsText
              .split(",")
              .map((type) => `null::${type}`)
              .join(",")
          : "";
        await db.query(`set local role ${role}`);
        await expectSqlError(db, () => db.query(`select ${name}(${args})`), {
          code: "42501",
        });
        await db.query("reset role");
      }
    }
    await db.query(`set local role ${role}`);
    if (role !== "service_role")
      await expectSqlError(
        db,
        () => reserve(db, { owner: "10000000-0000-0000-0000-000000000001" }),
        { code: "42501" },
      );
    await db.query("reset role");
  }
});

test("service settings defaults preserve zero legacy rows, explicit saves preserve configured values", async () => {
  await applyExpansion(db);
  await db.query("set local role service_role");
  const settings = (await db.query("select public.get_store_access_settings() value"))
    .rows[0].value;
  assert.deepEqual(settings, {
    site_lock_enabled: false,
    site_unlock_at: null,
    checkout_lock_enabled: false,
    checkout_lock_message:
      "Sorry, we currently cannot accept payments. Please message @soles.neakers on Instagram with the items you would like to purchase.",
  });
  await db.query("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from public.tenant_store_access_settings"))
      .rows[0].n,
    0,
  );
  await db.query("set local role service_role");
  const saved = (
    await db.query(
      "select public.upsert_store_access_settings(true, '2027-01-01T00:00:00Z', true, 'configured message') value",
    )
  ).rows[0].value;
  assert.equal(saved.site_lock_enabled, true);
  assert.equal(saved.checkout_lock_message, "configured message");
  assert.deepEqual(
    (await db.query("select public.get_store_access_settings() value")).rows[0].value,
    saved,
  );
  await db.query("reset role");
  for (const role of ["anon", "authenticated"]) {
    await db.query(`set local role ${role}`);
    await expectSqlError(
      db,
      () => db.query("select public.get_store_access_settings()"),
      { code: "42501" },
    );
    await expectSqlError(
      db,
      () => db.query("select public.upsert_store_access_settings(false,null,false,'x')"),
      { code: "42501" },
    );
    await db.query("reset role");
  }
});

test("configured settings survive expansion without replacing messages or lock state", async () => {
  await db.query(`insert into public.tenant_store_access_settings(tenant_id,site_lock_enabled,checkout_lock_enabled,checkout_lock_message)
    select id,true,true,'keep exact configured message' from public.tenants`);
  const beforeRows = await fingerprint(db);
  await applyExpansion(db);
  assert.deepEqual(await fingerprint(db), beforeRows);
  assert.equal(
    (await db.query("select public.get_store_access_settings() value")).rows[0].value
      .checkout_lock_message,
    "keep exact configured message",
  );
});

test("second owner aborts expansion before any retained row changes", async () => {
  await db.query("insert into public.tenants(name) values ('Expansion extra owner')");
  const beforeRows = await fingerprint(db);
  await expectSqlError(db, () => applyExpansion(db), /single_store_owner_cardinality/);
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("canonical global and owned brand collision aborts without merging or deleting", async () => {
  await db.query(`insert into public.tag_brands(tenant_id,canonical_label) select id,'Expansion collision' from public.tenants;
    insert into public.tag_brands(canonical_label) values ('EXPANSION COLLISION')`);
  const beforeRows = await fingerprint(db);
  await expectSqlError(db, () => applyExpansion(db), /single_store_canonical_collision/);
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("unregistered owner aborts without changing retained rows", async () => {
  // This historical table has no owner FK; test the actual legacy schema.
  await db.query(`insert into public.shipping_defaults(tenant_id,category,default_weight_oz,default_length_in,default_width_in,default_height_in)
    values ('90000000-0000-0000-0000-000000000009','accessories',1,1,1,1)`);
  const beforeRows = await fingerprint(db);
  await expectSqlError(db, () => applyExpansion(db), /single_store_unregistered_owner/);
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("conflicting settings abort even under one owner and preserve both configurations", async () => {
  await db.query("drop index public.tenant_store_access_settings_tenant_id_key");
  await db.query(`insert into public.tenant_store_access_settings(tenant_id,checkout_lock_enabled,checkout_lock_message)
    select id,false,'first' from public.tenants;
    insert into public.tenant_store_access_settings(tenant_id,checkout_lock_enabled,checkout_lock_message)
    select id,true,'second' from public.tenants`);
  const beforeRows = await fingerprint(db);
  await expectSqlError(
    db,
    () => applyExpansion(db),
    /single_store_settings_cardinality_or_conflict/,
  );
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("collision checks preserve exact stored alias equality and canonical label whitespace", async () => {
  const brand = (
    await db.query(
      "insert into public.tag_brands(canonical_label) values ('Expansion key semantics') returning id",
    )
  ).rows[0].id;
  await db.query(
    `insert into public.tag_aliases(entity_type,brand_id,alias_label,alias_normalized)
    values ('brand',$1,'First','Expansion exact'),('brand',$1,'Second',' expansion exact ')`,
    [brand],
  );
  await db.query(
    "insert into public.tag_brands(canonical_label) values (' Expansion whitespace '),('EXPANSION WHITESPACE')",
  );
  const beforeRows = await fingerprint(db);
  await applyExpansion(db);
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("exact global alias collision blocks and leaves rows unchanged", async () => {
  const brand = (
    await db.query(
      "insert into public.tag_brands(canonical_label) values ('Expansion alias collision') returning id",
    )
  ).rows[0].id;
  await db.query(
    `insert into public.tag_aliases(entity_type,brand_id,alias_label,alias_normalized)
    values ('brand',$1,'First','expansion duplicate')`,
    [brand],
  );
  await db.query(
    `insert into public.tag_aliases(tenant_id,entity_type,brand_id,alias_label,alias_normalized)
    select id,'brand',$1,'Second','expansion duplicate' from public.tenants`,
    [brand],
  );
  const beforeRows = await fingerprint(db);
  await expectSqlError(
    db,
    () => applyExpansion(db),
    /single_store_canonical_collision: alias_value/,
  );
  assert.deepEqual(await fingerprint(db), beforeRows);
});

test("partial stock failure rolls back every allocation and creates no order", async () => {
  await applyExpansion(db);
  const catalog = await seedCatalog(db);
  const beforeRows = await fingerprint(db);
  await db.query("set local role service_role");
  const items = [
    {
      product_id: catalog.product,
      variant_id: catalog.variant,
      quantity: 1,
      line_total_cents: 500,
    },
    {
      product_id: catalog.product,
      variant_id: "90000000-0000-0000-0000-000000000001",
      quantity: 1,
      line_total_cents: 500,
    },
  ];
  await expectSqlError(
    db,
    () => reserve(db, catalog, { items }),
    /checkout_inventory_unavailable/,
  );
  await db.query("reset role");
  assert.deepEqual(await fingerprint(db), beforeRows);
});

// This fixture applies the single-store expansion migration alone. The full
// hardening replay separately verifies that a no-ledger hold stays protected.
test("the historical expansion alone restores a canceled reservation once", async () => {
  await applyExpansion(db);
  const catalog = await seedCatalog(db);
  await db.query("set local role service_role");
  const result = await reserve(db, catalog);
  assert.equal(
    (
      await db.query(
        "select public.release_square_checkout_reservation($1,'cancelled') value",
        [result.order_id],
      )
    ).rows[0].value,
    true,
  );
  assert.equal(
    (
      await db.query(
        "select public.release_square_checkout_reservation($1,'cancelled') value",
        [result.order_id],
      )
    ).rows[0].value,
    false,
  );
  await db.query("reset role");
  assert.equal(
    (
      await db.query("select stock from public.product_variants where id=$1", [
        catalog.variant,
      ])
    ).rows[0].stock,
    1,
  );
});
