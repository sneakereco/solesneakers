import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

export const migrationPath = new URL(
  "../../../supabase/migrations/20261123120000_single_store_compatibility.sql",
  import.meta.url,
);
export const oldSignature =
  "public.reserve_square_checkout_inventory(uuid,uuid,text,text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)";
export const newSignature =
  "public.reserve_square_checkout_inventory(uuid,text,text,text,text,text,text,timestamp with time zone,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)";

export function testUrl(value) {
  assert.ok(value, "Explicit SINGLE_STORE_TEST_DATABASE_URL required");
  const url = new URL(value);
  assert.ok(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.port === "64332" &&
      /^\/single_store_test_[a-z0-9_]+$/.test(url.pathname) &&
      !url.search,
    "Refusing non-disposable target",
  );
  return url;
}

export async function connect(value) {
  const client = new Client({ connectionString: testUrl(value).href });
  await client.connect();
  const { rows } = await client.query("select current_database() as name");
  assert.equal(rows[0].name, decodeURIComponent(new URL(value).pathname.slice(1)));
  return client;
}

export async function applyExpansion(client) {
  const sql = await readFile(migrationPath, "utf8");
  // Tests own the outer transaction. The exact migration is also applied as-is
  // in the separate full-replay/populated-copy rehearsal.
  await client.query(sql.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, ""));
}

export async function fingerprint(client) {
  const { rows } = await client.query(
    "select tablename from pg_tables where schemaname='public' order by tablename",
  );
  const result = {};
  for (const { tablename } of rows) {
    assert.match(tablename, /^[a-z_]+$/);
    result[tablename] = (
      await client.query(`select count(*)::integer as rows,
        md5(coalesce(string_agg(value::text, E'\\n' order by value::text),'')) as hash,
        md5(coalesce(string_agg(complete::text, E'\\n' order by complete::text),'')) as "completeHash"
        from (select to_jsonb(t)-'tenant_id' as value, to_jsonb(t) as complete from public."${tablename}" t) r`)
    ).rows[0];
  }
  return result;
}

export async function seedCatalog(client) {
  const owner = (await client.query("select id from public.tenants")).rows[0].id;
  const brand = (
    await client.query(
      "insert into public.tag_brands(canonical_label) values ('Expansion fixture brand') returning id",
    )
  ).rows[0].id;
  const size = (
    await client.query(
      "insert into public.tag_sizes(size_type,canonical_label) values ('none','Expansion fixture size') returning id",
    )
  ).rows[0].id;
  const product = (
    await client.query(
      `insert into public.products(tenant_id,name,condition,category,brand_id,size_type)
       values ($1,'Expansion fixture product','new','accessories',$2,'none') returning id`,
      [owner, brand],
    )
  ).rows[0].id;
  const variant = (
    await client.query(
      `insert into public.product_variants(tenant_id,product_id,size_id,sku,sale_price_cents,stock)
       values ($1,$2,$3,'expansion-fixture-sku',1000,1) returning id`,
      [owner, product, size],
    )
  ).rows[0].id;
  return { owner, brand, size, product, variant };
}

export async function reserve(
  client,
  catalog,
  {
    legacy = false,
    key = "expansion-fixture",
    items,
    email = "fixture@example.invalid",
    userId = null,
  } = {},
) {
  const values = [
    userId,
    email,
    "USD",
    "pickup",
    "card",
    key,
    "fixture-cart-hash",
    new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    1000,
    0,
    0,
    1000,
    "fixture-tax",
    "SC",
    null,
    {
      given_name: "Test",
      family_name: "Buyer",
      line1: "1 Main St",
      city: "Columbia",
      state: "SC",
      postal_code: "29201",
      country: "US",
    },
    JSON.stringify(
      items ?? [
        {
          product_id: catalog.product,
          variant_id: catalog.variant,
          quantity: 1,
          unit_price_cents: 1000,
          unit_cost_cents: 0,
          line_total_cents: 1000,
          variant_sku: "expansion-fixture-sku",
          product_name: "Expansion fixture product",
          brand: "Expansion fixture brand",
          model: null,
          category: "accessories",
          condition: "new",
          size_label: "Expansion fixture size",
        },
      ],
    ),
    { device_session_id: "fixture-device" },
    { name: "Test Buyer", phone: "+18035550100" },
  ];
  if (legacy) values.unshift(catalog.owner);
  const types = legacy ? ["uuid", "uuid"] : ["uuid"];
  types.push(
    "text",
    "text",
    "text",
    "text",
    "text",
    "text",
    "timestamptz",
    "integer",
    "integer",
    "integer",
    "integer",
    "text",
    "text",
    "jsonb",
    "jsonb",
    "jsonb",
    "jsonb",
    "jsonb",
  );
  return (
    await client.query(
      `select public.reserve_square_checkout_inventory(${values.map((_, i) => `$${i + 1}::${types[i]}`).join(",")}) as result`,
      values,
    )
  ).rows[0].result;
}

export async function expectSqlError(client, callback, expected) {
  await client.query("savepoint expected_error");
  try {
    await assert.rejects(callback, expected);
  } finally {
    await client.query("rollback to savepoint expected_error");
    await client.query("release savepoint expected_error");
  }
}
