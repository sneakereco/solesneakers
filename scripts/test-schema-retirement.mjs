import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
const connectionString = process.env.SUPABASE_DB_URL;
assert(connectionString, "Provide the local test database explicitly");
const target = new URL(connectionString);
assert(["127.0.0.1", "localhost"].includes(target.hostname));
assert.equal(target.port, "64332", "Sole Sneakers local database only");
assert(
  target.pathname.startsWith("/codex_retirement"),
  "Use a disposable retirement database",
);
const db = new pg.Client({ connectionString });
await db.connect();
try {
  await db.query("begin read only");
  await db.query("set local statement_timeout = '10s'");
  const retired = [
    "admin_audit_log",
    "chargeback_evidence",
    "nexus_registrations",
    "sellers",
    "tax_rate_cache",
    "tenant_checkout_settings",
    "tenant_tax_settings",
    "transaction_audit_log",
    "checkout_api_logs",
    "user_billing_addresses",
    "payment_events",
    "shipping_tracking_events",
  ];
  for (const table of retired) {
    const { rows } = await db.query("select to_regclass($1) as object", [
      `public.${table}`,
    ]);
    assert.equal(rows[0].object, null, `${table} must be retired`);
  }
  for (const table of [
    "orders",
    "order_billing",
    "payment_transactions",
    "state_sales_tracking",
  ]) {
    const { rows } = await db.query("select to_regclass($1) as object", [
      `public.${table}`,
    ]);
    assert.notEqual(rows[0].object, null, `${table} must remain`);
  }
  const columns = {
    orders: [
      "fee",
      "tax_transaction_id",
      "seller_id",
      "public_token",
      "square_payment_link_id",
      "square_payment_link_url",
      "square_payment_link_deleted_at",
    ],
    payment_transactions: ["card_bin", "three_ds_eci", "amount_refunded"],
    user_addresses: ["is_default"],
    square_webhook_events: ["processing_error"],
  };
  for (const [table, names] of Object.entries(columns)) {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])`,
      [table, names],
    );
    assert.deepEqual(rows, [], `${table} still has retired columns`);
  }
  for (const signature of [
    "decrement_variant_stock(uuid,integer)",
    "increment_variant_stock(uuid,integer)",
    "mark_order_paid_and_decrement(uuid,text,jsonb)",
    "attach_square_payment_link(uuid,text,text,text,integer,integer,integer,text)",
    "mark_square_payment_link_deleted(uuid,text)",
  ]) {
    const { rows } = await db.query("select to_regprocedure($1) as object", [
      `public.${signature}`,
    ]);
    assert.equal(rows[0].object, null, `${signature} must be retired`);
  }
  const { rows: triggers } = await db.query(`
    select c.relname, count(*)::int as count from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_proc p on p.oid=t.tgfoid
    where c.relnamespace='public'::regnamespace
      and c.relname in ('products','shipping_profiles')
      and p.proname in ('rdk_set_updated_at','update_updated_at_column')
    group by c.relname order by c.relname`);
  assert.deepEqual(triggers, [
    { relname: "products", count: 1 },
    { relname: "shipping_profiles", count: 1 },
  ]);
  for (const index of [
    "order_billing_order_id_unique",
    "order_shipping_order_id_key",
    "product_variants_tenant_sku_key",
  ]) {
    const { rows } = await db.query(
      "select indisunique from pg_index where indexrelid=to_regclass($1)",
      [`public.${index}`],
    );
    assert.equal(rows[0]?.indisunique, true, `${index} must remain unique`);
  }
  const { rows: release } = await db.query(`select has_function_privilege('authenticated',
    'public.release_square_checkout_reservation(uuid,text)', 'execute') as allowed`);
  assert.equal(release[0].allowed, false, "Authenticated clients cannot release stock");
  await db.query("rollback");
  await db.query("begin");
  await db.query("set local lock_timeout = '5s'");
  await db.query("set local statement_timeout = '10s'");
  // Only on a disposable database: reconstruct the preflight fields inside a rollback.
  await db.query(`alter table public.orders add column square_payment_link_id text,
    add column square_payment_link_deleted_at timestamptz`);
  const {
    rows: [tenant],
  } = await db.query(
    "insert into public.tenants(name) values ('retirement guard check') returning id",
  );
  await db.query(
    `insert into public.orders(tenant_id,subtotal,shipping,total,status,fulfillment,square_payment_link_id)
    values ($1,1,0,1,'review','pickup','guard-test-only')`,
    [tenant.id],
  );
  const candidate = await readFile(
    new URL(
      "../supabase/migrations/20260919090000_retire_unused_application_schema.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await assert.rejects(
    () => db.query(candidate.replace(/^begin;$/m, "").replace(/commit;\s*$/, "")),
    /retire_and_verify_legacy_square_links_before_schema_cleanup/,
  );
  console.log("Retirement catalog and active-link preflight assertions passed");
} finally {
  await db.query("rollback").finally(() => db.end());
}
