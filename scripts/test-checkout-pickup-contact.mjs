import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  const {
    rows: [item],
  } =
    await client.query(`select p.id as product_id,p.tenant_id,p.name as product_name,v.id as variant_id,v.sku as variant_sku,v.sale_price_cents as unit_price_cents,v.unit_cost_cents,p.condition,p.category
    from public.products p join public.product_variants v on v.product_id=p.id
    where p.is_active and not p.is_out_of_stock and p.go_live_at <= now() and v.stock > 0 limit 1`);
  assert(item, "Seed one in-stock local product before running this check.");
  // All inventory changes roll back at the end.
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
  async function reserve(
    method,
    contact,
    key,
    fulfillment = "pickup",
    tenantId = item.tenant_id,
  ) {
    const args = [
      tenantId,
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
    () => reserve("applePay", null, randomUUID()),
    /checkout_pickup_contact_required/,
  );
  await rejects(
    () => reserve("applePay", { name: "Buyer", phone: "not-a-phone" }, randomUUID()),
    /checkout_pickup_contact_required/,
  );
  await rejects(
    () => reserve("card", pickup, randomUUID(), "pickup", randomUUID()),
    /checkout_inventory_unavailable/,
  );
  async function stock() {
    return (
      await client.query("select stock from public.product_variants where id=$1", [
        item.variant_id,
      ])
    ).rows[0].stock;
  }
  async function release(orderId) {
    return (
      await client.query(
        "select public.release_square_checkout_reservation($1,$2) as released",
        [orderId, "retirement_check"],
      )
    ).rows[0].released;
  }
  for (const method of ["card", "applePay", "afterpay", "cashAppPay"]) {
    const before = await stock();
    const key = randomUUID();
    const order = await reserve(method, pickup, key);
    assert.equal(await stock(), before - 1, "Reserve deducts once");
    const { rows: bills } = await client.query(
      "select line1 from public.order_billing where order_id=$1",
      [order.order_id],
    );
    assert.equal(bills[0]?.line1, billing.line1, "Order billing remains required");
    const {
      rows: [saved],
    } = await client.query(
      "select pickup_name,pickup_phone from public.orders where id=$1",
      [order.order_id],
    );
    assert.deepEqual(saved, { pickup_name: pickup.name, pickup_phone: pickup.phone });
    assert.equal((await reserve(method, pickup, key)).reused, true);
    assert.equal(await stock(), before - 1, "Idempotent reuse does not deduct twice");
    await rejects(
      () => reserve(method, { ...pickup, phone: "3365550199" }, key),
      /checkout_pickup_contact_conflict/,
    );
    assert.equal(await release(order.order_id), true);
    assert.equal(await release(order.order_id), false);
    assert.equal(await stock(), before, "Release restores exactly once");
    const shipping = await reserve(method, null, randomUUID(), "ship");
    assert.equal(shipping.reused, false);
    const consumeSql =
      method === "card"
        ? "select public.consume_square_checkout_reservation($1,$2) as consumed"
        : "select public.consume_square_checkout_reservation($1,$2,now()) as consumed";
    const paymentId = `retirement-${randomUUID()}`;
    for (let retry = 0; retry < 2; retry++) {
      const { rows } = await client.query(consumeSql, [shipping.order_id, paymentId]);
      assert.equal(rows[0].consumed, true);
    }
    assert.equal(
      await release(shipping.order_id),
      false,
      "Paid order cannot be released",
    );
    assert.equal(
      await stock(),
      before - 1,
      "Consume/retry does not deduct or restore again",
    );
  }
  await client.query("set local role authenticated");
  await assert.rejects(() => reserve("card", pickup, randomUUID()), /permission denied/);
  console.log(
    "PASS: pickup/billing persistence for all four active payment methods, shipping, stock reserve/reuse/release/consume, paid protection, contact rejection and RPC permissions",
  );
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
