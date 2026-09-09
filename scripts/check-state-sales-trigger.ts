import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { Client } from "pg";

// Runs against the configured database; all writes, including the optional
// migration, are rolled back. No orders, stock, or notifications are changed.
loadEnvConfig(process.cwd());

async function main() {
  const client = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '10s'");
    for (const migration of process.argv.slice(2)) {
      const sql = readFileSync(migration, "utf8")
        .replace(/^begin;\s*/i, "")
        .replace(/commit;\s*$/i, "");
      await client.query(sql);
    }
    await client.query("set local search_path = ''");
    await client.query(`create temporary table trigger_check (
      tenant_id uuid, customer_state text, created_at timestamptz,
      status text, total numeric, shipping numeric
    ) on commit drop`);
    await client.query(`create trigger check_sales after insert or update
      on pg_temp.trigger_check for each row
      execute function public.update_state_sales_tracking()`);
    const tenant = (await client.query("select id from public.tenants limit 1")).rows[0];
    assert(tenant, "A tenant is required for this rollback-only check");
    const totals = async () =>
      (
        await client.query(
          `select
      coalesce(sum(transaction_count),0)::int as count,
      coalesce(sum(total_sales),0)::text as sales
      from public.state_sales_tracking where tenant_id=$1 and state_code='SC'`,
          [tenant.id],
        )
      ).rows[0];
    const before = await totals();
    for (const method of ["card", "afterpay", "cashAppPay", "applePay", "googlePay"]) {
      await client.query("savepoint billing_check");
      await assert.rejects(
        client.query(
          `select public.reserve_square_checkout_inventory(
          $1::uuid, null::uuid, 'fixture@example.com', 'USD', 'pickup', $2::text,
          'fixture-id', 'fixture-hash', now() + interval '15 minutes',
          100, 0, 0, 100, null, 'SC', null::jsonb, null::jsonb, '[]'::jsonb, '{}'::jsonb
        )`,
          [tenant.id, method],
        ),
        { message: "checkout_billing_address_required" },
      );
      await client.query("rollback to savepoint billing_check");
    }
    await client.query(
      `insert into pg_temp.trigger_check values
      ($1, 'SC', now(), 'pending', 123.45, 5.00)`,
      [tenant.id],
    );
    await client.query("update pg_temp.trigger_check set status='paid'");
    const paid = await totals();
    assert.equal(paid.count, before.count + 1);
    assert.equal(
      Math.round(Number(paid.sales) * 100),
      Math.round(Number(before.sales) * 100) + 12345,
    );
    await client.query("update pg_temp.trigger_check set total=123.45");
    assert.deepEqual(
      await totals(),
      paid,
      "Repeated paid updates must not double-count sales",
    );
    console.info(
      "PASS: billing required for all methods, empty-search-path paid transition and duplicate update; all writes rolled back",
    );
  } finally {
    await client.query("rollback");
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database regression failed");
  process.exitCode = 1;
});
