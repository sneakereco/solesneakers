import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { after, before, beforeEach, test } from "node:test";
import { Client } from "pg";

// These tests CREATE/DROP only the explicitly named disposable database.
// They deliberately do not accept the application's database environment names.
const suppliedUrl = process.env.SINGLE_STORE_TEST_DATABASE_URL;
assert.ok(
  suppliedUrl,
  "Set SINGLE_STORE_TEST_DATABASE_URL to an isolated local single_store_test_ database",
);
const target = new URL(suppliedUrl);
const databaseName = decodeURIComponent(target.pathname.slice(1));
assert.ok(
  ["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    target.port === "64332" &&
    /^single_store_test_[a-z0-9_]+$/.test(databaseName) &&
    databaseName.length <= 63 &&
    !target.search,
  "Refusing target: tests require loopback:64332 and a single_store_test_ database without URL options",
);

const tables = [
  "checkout_notification_outbox",
  "email_audit_log",
  "featured_items",
  "inventory_reservations",
  "orders",
  "payment_transactions",
  "product_variants",
  "products",
  "profiles",
  "shipping_defaults",
  "shipping_profiles",
  "square_disputes",
  "square_refunds",
  "state_sales_tracking",
  "tag_aliases",
  "tag_brands",
  "tag_candidates",
  "tag_models",
  "tag_sizes",
  "tenant_store_access_settings",
];
const owner = "10000000-0000-0000-0000-000000000001";
const otherOwner = "10000000-0000-0000-0000-000000000002";
const brandA = "20000000-0000-0000-0000-000000000001";
const brandB = "20000000-0000-0000-0000-000000000002";
const migrationFiles = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", "HEAD", "--", "supabase/migrations"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter((file) => /\/\d{14}_.+\.sql$/.test(file));
const versions = migrationFiles.map((file) => file.split("/").at(-1).slice(0, 14));
const maintenanceUrl = new URL(target);
maintenanceUrl.pathname = "/postgres";
const maintenance = new Client({ connectionString: maintenanceUrl.href });
let fixture;
let created = false;
let inspectDatabase;
try {
  ({ inspectDatabase } = await import("../../scripts/single-store/preflight.mjs"));
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") {
    throw error;
  }
}

before(async () => {
  await maintenance.connect();
  // No IF EXISTS / forced drop: an existing database is never overwritten.
  await maintenance.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  created = true;
  fixture = new Client({ connectionString: target.href });
  await fixture.connect();
  await fixture.query(`
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text);
    CREATE TABLE public.tenants(id uuid PRIMARY KEY);
    ${tables.map((name) => `CREATE TABLE public.${name}(id uuid DEFAULT gen_random_uuid(), tenant_id uuid);`).join("\n")}
    ALTER TABLE public.tag_brands ADD canonical_label text;
    ALTER TABLE public.tag_models ADD brand_id uuid, ADD canonical_label text;
    ALTER TABLE public.tag_aliases ADD entity_type text, ADD alias_normalized text;
    ALTER TABLE public.tag_sizes ADD size_type text, ADD canonical_label text;
    ALTER TABLE public.product_variants ADD sku text, ADD product_id uuid, ADD size_id uuid;
    ALTER TABLE public.featured_items ADD product_id uuid;
    ALTER TABLE public.shipping_defaults ADD category text;
    ALTER TABLE public.state_sales_tracking ADD state_code character varying(2), ADD year integer, ADD month integer;
    ALTER TABLE public.shipping_profiles DROP COLUMN id;
    ALTER TABLE public.square_refunds DROP COLUMN id, ADD square_refund_id text;
    ALTER TABLE public.square_disputes DROP COLUMN id, ADD square_dispute_id text;
    ALTER TABLE public.tenant_store_access_settings ADD site_lock_enabled boolean DEFAULT false,
      ADD site_unlock_at timestamptz, ADD checkout_lock_enabled boolean DEFAULT false,
      ADD checkout_lock_message text DEFAULT 'fixture-message';
    ALTER TABLE public.orders ADD status text, ADD expires_at timestamptz, ADD cart_hash text, ADD square_order_id text;
    ALTER TABLE public.inventory_reservations ADD status text, ADD expires_at timestamptz;
    ALTER TABLE public.checkout_notification_outbox ADD status text, ADD next_attempt_at timestamptz, ADD updated_at timestamptz;
    ALTER TABLE public.square_refunds ADD status text;
    ALTER TABLE public.square_disputes ADD state text;
    CREATE FUNCTION public.fixture_tenant_routine(p_tenant_id uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path = '' AS 'SELECT p_tenant_id IS NOT NULL';
    CREATE FUNCTION public.fixture_tenant_trigger() RETURNS trigger LANGUAGE plpgsql
      AS 'BEGIN IF NEW.tenant_id IS NOT NULL THEN RETURN NEW; END IF; RETURN NEW; END';
    CREATE TRIGGER fixture_trigger BEFORE UPDATE OF tenant_id ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.fixture_tenant_trigger();
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_policy ON public.products USING (tenant_id IS NOT NULL);
  `);
  await fixture.query(
    "INSERT INTO supabase_migrations.schema_migrations SELECT unnest($1::text[])",
    [versions],
  );
});

beforeEach(async () => {
  await fixture.query(
    `TRUNCATE public.tenants, ${tables.map((name) => `public.${name}`).join(", ")}`,
  );
  await fixture.query("INSERT INTO public.tenants VALUES ($1)", [owner]);
});

after(async () => {
  if (fixture) {
    await fixture.end();
  }
  if (created) {
    await maintenance.query(`DROP DATABASE "${databaseName}"`);
  }
  await maintenance.end();
});

const inspect = () => {
  assert.equal(
    typeof inspectDatabase,
    "function",
    "Missing preflight implementation: inspectDatabase must produce a report",
  );
  return inspectDatabase({ connectionString: target.href });
};
const blockedBy = (report, code) => report.blockers.some((item) => item.code === code);

test("reports all 20 tables including nullable global records, without exposing row values", async () => {
  await fixture.query(
    "INSERT INTO public.tag_brands(id,tenant_id,canonical_label) VALUES ($1,NULL,'private-fixture-brand')",
    [brandA],
  );
  const result = await inspect();
  assert.equal(result.ready, true);
  assert.equal(Object.keys(result.ownership.tables).length, 20);
  assert.equal(result.ownership.tables.tag_brands.globalRows, 1);
  assert.equal(result.ownership.tenantRows, 1);
  assert.equal(result.baseline.matches, true);
  assert.equal(result.baseline.expectedCount, versions.length);
  assert.equal(result.transaction.readOnly, true);
  assert.equal(result.transaction.isolation, "repeatable read");
  assert.equal(result.transaction.statementTimeoutMs, 15000);
  assert.ok(result.dependencies.policies.tenantDependent >= 1);
  assert.ok(result.dependencies.routines.tenantDependent >= 2);
  assert.ok(result.dependencies.triggers.tenantColumnUpdates >= 1);
  assert.ok(result.dependencies.acl.publicExecutableRoutines >= 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-fixture-brand|10000000-0000|20000000-0000|fixture-message/,
  );
});

test("blocks an independent owner in a peripheral retained table and unknown owners", async () => {
  await fixture.query("INSERT INTO public.products(tenant_id) VALUES ($1)", [owner]);
  await fixture.query("INSERT INTO public.shipping_profiles(tenant_id) VALUES ($1)", [
    otherOwner,
  ]);
  const result = await inspect();
  assert.equal(result.ready, false);
  assert.equal(blockedBy(result, "multiple_owners"), true);
  assert.equal(blockedBy(result, "unregistered_owner"), true);
  assert.equal(result.ownership.distinctOwners, 2);
  assert.equal(result.ownership.tables.shipping_profiles.unregisteredOwnerRows, 1);
});

test("blocks extra tenant identities even when business tables are empty", async () => {
  await fixture.query("INSERT INTO public.tenants VALUES ($1)", [otherOwner]);
  const result = await inspect();
  assert.equal(blockedBy(result, "tenant_cardinality"), true);
});

test("finds canonical collisions across global/owned brands and normalized parent-brand models", async () => {
  await fixture.query(
    "INSERT INTO public.tag_brands(id,tenant_id,canonical_label) VALUES ($1,NULL,'Nike'),($2,$3,'NIKE')",
    [brandA, brandB, owner],
  );
  await fixture.query(
    "INSERT INTO public.tag_models(brand_id,canonical_label) VALUES ($1,'Air Max'),($2,'AIR MAX')",
    [brandA, brandB],
  );
  const result = await inspect();
  assert.equal(blockedBy(result, "canonical_collision"), true);
  assert.deepEqual(result.collisions.brand_name, { groups: 1, rows: 2 });
  assert.deepEqual(result.collisions.model_within_brand, { groups: 1, rows: 2 });
  assert.equal(result.ownership.tables.tag_models.globalRows, 2);
});

test("checks all remaining store-wide unique keys with aggregate collision counts", async () => {
  await fixture.query(`
    INSERT INTO public.tag_aliases(entity_type,alias_normalized) VALUES ('brand','air'),('brand','air');
    INSERT INTO public.tag_sizes(size_type,canonical_label) VALUES ('shoe','10'),('shoe','10');
    INSERT INTO public.product_variants(sku,product_id,size_id) VALUES
      ('secret-sku','${brandA}','${brandB}'),('secret-sku','${brandA}','${brandB}');
    INSERT INTO public.featured_items(product_id) VALUES ('${brandA}'),('${brandA}');
    INSERT INTO public.shipping_defaults(category) VALUES ('shoes'),('shoes');
    INSERT INTO public.state_sales_tracking(state_code,year,month) VALUES ('NY',2026,11),('NY',2026,11);
  `);
  const result = await inspect();
  for (const key of [
    "alias_value",
    "size_name",
    "variant_sku",
    "variant_product_size",
    "featured_product",
    "shipping_category",
    "sales_period",
  ]) {
    assert.deepEqual(result.collisions[key], { groups: 1, rows: 2 }, key);
  }
  assert.doesNotMatch(JSON.stringify(result), /secret-sku/i);
});

test("preserves stored normalized aliases, lower-only labels, and exact SKU/category/state semantics", async () => {
  await fixture.query(`
    INSERT INTO public.product_variants(sku) VALUES (' sku '),('SKU');
    INSERT INTO public.shipping_defaults(category) VALUES (' Shoes '),('SHOES');
    INSERT INTO public.state_sales_tracking(state_code,year,month) VALUES ('ny',2026,11),('NY',2026,11);
    INSERT INTO public.tag_aliases(entity_type,alias_normalized) VALUES ('brand',' air '),('brand','AIR');
    INSERT INTO public.tag_brands(canonical_label) VALUES (' Nike '),('NIKE');
    INSERT INTO public.tag_sizes(size_type,canonical_label) VALUES ('shoe',' 10 '),('shoe','10');
  `);
  const result = await inspect();
  for (const key of [
    "variant_sku",
    "shipping_category",
    "sales_period",
    "alias_value",
    "brand_name",
    "size_name",
  ]) {
    assert.deepEqual(result.collisions[key], { groups: 0, rows: 0 }, key);
  }
});

test("reports zero/one settings and independently blocks multiple/conflicting configurations", async () => {
  assert.deepEqual((await inspect()).storeSettings, {
    rows: 0,
    distinctConfigurations: 0,
  });
  await fixture.query(
    "INSERT INTO public.tenant_store_access_settings(tenant_id) VALUES ($1)",
    [owner],
  );
  assert.deepEqual((await inspect()).storeSettings, {
    rows: 1,
    distinctConfigurations: 1,
  });
  await fixture.query(
    "INSERT INTO public.tenant_store_access_settings(tenant_id,checkout_lock_enabled) VALUES ($1,true)",
    [owner],
  );
  const result = await inspect();
  assert.equal(blockedBy(result, "settings_cardinality"), true);
  assert.equal(blockedBy(result, "settings_conflict"), true);
  assert.deepEqual(result.storeSettings, { rows: 2, distinctConfigurations: 2 });
});

test("missing baseline does not hide ownership, collision, or pending-work diagnostics", async () => {
  await fixture.query(
    "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260919090000'",
  );
  try {
    await fixture.query(
      "INSERT INTO public.tag_sizes(size_type,canonical_label) VALUES ('shoe','10'),('shoe','10')",
    );
    await fixture.query(
      "INSERT INTO public.orders(tenant_id,status,expires_at,cart_hash,square_order_id) VALUES ($1,'pending',now()-interval '1 hour','private-hash','private-provider-id')",
      [otherOwner],
    );
    await fixture.query(
      "INSERT INTO public.checkout_notification_outbox(status,next_attempt_at,updated_at) VALUES ('failed',now()-interval '1 minute',now())",
    );
    const result = await inspect();
    assert.equal(blockedBy(result, "migration_baseline"), true);
    assert.deepEqual(result.baseline.missingVersions, ["20260919090000"]);
    assert.equal(blockedBy(result, "unregistered_owner"), true);
    assert.equal(blockedBy(result, "canonical_collision"), true);
    assert.equal(result.pendingWork.orders.pending, 1);
    assert.equal(result.pendingWork.orders.expiredPending, 1);
    assert.equal(result.pendingWork.outbox.failed, 1);
    assert.equal(result.pendingWork.outbox.due, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-hash|private-provider-id/);
  } finally {
    await fixture.query(
      "INSERT INTO supabase_migrations.schema_migrations VALUES ('20260919090000')",
    );
  }
});

test("unexpected migration values block without echoing arbitrary registry values", async () => {
  await fixture.query(
    "INSERT INTO supabase_migrations.schema_migrations VALUES ('sensitive-registry-value'),('20990101000000')",
  );
  try {
    const result = await inspect();
    assert.equal(blockedBy(result, "migration_baseline"), true);
    assert.equal(result.baseline.unexpectedVersionCount, 1);
    assert.equal(result.baseline.invalidVersionCount, 1);
    assert.doesNotMatch(
      JSON.stringify(result),
      /sensitive-registry-value|20990101000000/,
    );
  } finally {
    await fixture.query(
      "DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('sensitive-registry-value','20990101000000')",
    );
  }
});

test("accepts an explicit committed baseline cutoff and rejects unknown cutoffs", async () => {
  assert.equal(typeof inspectDatabase, "function", "Missing preflight implementation");
  const result = await inspectDatabase({
    connectionString: target.href,
    baselineThrough: "20260922120000",
  });
  assert.equal(result.baseline.through, "20260922120000");
  assert.equal(result.baseline.matches, true);
  await assert.rejects(
    inspectDatabase({ connectionString: target.href, baselineThrough: "20990101000000" }),
    (error) => error.message === "unknown_baseline_cutoff",
  );
});

test("unknown schema gaps block while safe aggregate diagnostics continue", async () => {
  await fixture.query(
    "ALTER TABLE public.shipping_defaults RENAME COLUMN category TO unknown_category; CREATE TABLE public.fixture_extra(tenant_id uuid); DROP TABLE public.shipping_profiles; INSERT INTO public.products(tenant_id) VALUES (NULL)",
  );
  try {
    const result = await inspect();
    assert.equal(blockedBy(result, "schema_gap"), true);
    assert.equal(result.schema.unexpectedTenantTableCount, 1);
    assert.ok(result.schema.missingColumns.includes("shipping_defaults.category"));
    assert.equal(result.collisions.shipping_category, null);
    assert.equal(result.ready, false);
    assert.equal(result.ownership.tables.shipping_profiles, null);
    assert.equal(result.ownership.tables.products.globalRows, 1);
    assert.equal(result.ownership.globalRows, null);
    assert.equal(result.ownership.unregisteredOwnerRows, null);
    assert.equal(result.ownership.distinctOwners, null);
    assert.equal(result.ownership.tables.shipping_defaults.rows, 0);
    assert.equal(result.pendingWork.orders.rows, 0);
  } finally {
    await fixture.query(
      "ALTER TABLE public.shipping_defaults RENAME COLUMN unknown_category TO category; DROP TABLE public.fixture_extra; CREATE TABLE public.shipping_profiles(tenant_id uuid)",
    );
  }
});

test("CLI returns a nonzero blocker result without secrets, and missing URL never falls back to environment", async () => {
  await fixture.query("INSERT INTO public.tenants VALUES ($1)", [otherOwner]);
  const blocked = spawnSync(process.execPath, ["scripts/single-store/preflight.mjs"], {
    encoding: "utf8",
    env: { ...process.env, SINGLE_STORE_DATABASE_URL: target.href },
  });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).ready, false);
  assert.equal(blocked.stderr, "");
  const absent = spawnSync(process.execPath, ["scripts/single-store/preflight.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SINGLE_STORE_DATABASE_URL: "",
      DATABASE_URL: target.href,
      SUPABASE_DB_URL: target.href,
    },
  });
  assert.equal(absent.status, 2);
  assert.equal(JSON.parse(absent.stdout).error, "explicit_connection_url_required");
  assert.doesNotMatch(
    blocked.stdout + blocked.stderr + absent.stdout + absent.stderr,
    /postgres(?:ql)?:\/\/|private-/,
  );
});

test("preflight leaves business data and migration registry byte-for-byte intact", async () => {
  await fixture.query("INSERT INTO public.products(tenant_id) VALUES ($1)", [owner]);
  const fingerprint = async () =>
    (
      await fixture.query(`SELECT jsonb_build_object(
    'tables',(SELECT jsonb_object_agg(name, value) FROM (
      ${["tenants", ...tables].map((name) => `SELECT '${name}' AS name, (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM public.${name} t) AS value`).join(" UNION ALL ")}
    ) x),
    'migrations',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
  ) AS result`)
    ).rows[0].result;
  const beforeReport = await fingerprint();
  await inspect();
  assert.deepEqual(await fingerprint(), beforeReport);
});
