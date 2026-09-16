import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:64332/postgres";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(connectionString).hostname),
  "Only run this rollback check against local PostgreSQL.",
);
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query("begin");
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260916091000_checkout_pickup_contact.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await client.query(migration.replace(/^begin;/, "").replace(/commit;\s*$/, ""));
  const {
    rows: [item],
  } =
    await client.query(`select p.id as product_id,p.tenant_id,p.name as product_name,v.id as variant_id,v.sku as variant_sku,v.sale_price_cents as unit_price_cents,v.unit_cost_cents,p.condition,p.category
    from public.products p join public.product_variants v on v.product_id=p.id
    where p.is_active and not p.is_out_of_stock and p.go_live_at <= now() and v.stock > 0 limit 1`);
  assert(item, "Seed one in-stock local product before running this check.");
  // All inventory changes and migration DDL roll back at the end.
  await client.query("update public.product_variants set stock=20 where id=$1", [
    item.variant_id,
  ]);
  const billing = {
    given_name: "Billing",
    family_name: "Buyer",
    line1: "1 Main St",
    city: "Winston-Salem",
    state: "NC",
    postal_code: "27101",
    country: "US",
  };
  const pickup = { name: "Pickup Recipient", phone: "3365550100" };
  async function reserve(method, contact, key, fulfillment = "pickup") {
    const args = [
      item.tenant_id,
      null,
      "buyer@example.com",
      "USD",
      fulfillment,
      method,
      key,
      "a".repeat(64),
      new Date(Date.now() + 900000),
      item.unit_price_cents,
      0,
      0,
      item.unit_price_cents,
      "square:test",
      "NC",
      fulfillment === "ship"
        ? { ...billing, name: "Ship Buyer", phone: "3365550101" }
        : null,
      billing,
      JSON.stringify([
        {
          ...item,
          quantity: 1,
          line_total_cents: item.unit_price_cents,
          brand: "Test",
          model: null,
          size_label: "Test",
        },
      ]),
      {},
      contact,
    ];
    return (
      await client.query(
        `select public.reserve_square_checkout_inventory(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        args,
      )
    ).rows[0].result;
  }
  async function rejects(action, message) {
    await client.query("savepoint invalid_contact");
    await assert.rejects(action, message);
    await client.query("rollback to savepoint invalid_contact");
  }
  await rejects(
    () => reserve("googlePay", null, randomUUID()),
    /checkout_pickup_contact_required/,
  );
  await rejects(
    () => reserve("googlePay", { name: "Buyer", phone: "not-a-phone" }, randomUUID()),
    /checkout_pickup_contact_required/,
  );
  for (const method of ["card", "applePay", "googlePay", "afterpay", "cashAppPay"]) {
    const key = randomUUID();
    const order = await reserve(method, pickup, key);
    const {
      rows: [saved],
    } = await client.query(
      "select pickup_name,pickup_phone from public.orders where id=$1",
      [order.order_id],
    );
    assert.deepEqual(saved, { pickup_name: pickup.name, pickup_phone: pickup.phone });
    assert.equal((await reserve(method, pickup, key)).reused, true);
    await rejects(
      () => reserve(method, { ...pickup, phone: "3365550199" }, key),
      /checkout_pickup_contact_conflict/,
    );
    const shipping = await reserve(method, null, randomUUID(), "ship");
    assert.equal(shipping.reused, false);
  }
  await client.query("set local role authenticated");
  await assert.rejects(() => reserve("card", pickup, randomUUID()), /permission denied/);
  console.log(
    "PASS: pickup persistence for all five payment methods, shipping compatibility, idempotency, missing contact rejection and RPC permissions",
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
