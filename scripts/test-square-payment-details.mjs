import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const connectionString =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:64332/postgres";
assert(
  ["127.0.0.1", "localhost"].includes(new URL(connectionString).hostname),
  "Local rollback check only",
);
const db = new pg.Client({ connectionString });
try {
  await db.connect();
  await db.query("begin");
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260918140000_square_payment_details.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const {
    rows: [schema],
  } = await db.query(
    "select to_regprocedure('public.record_square_payment_details(text,text,text,bigint,text,jsonb)') is not null as installed",
  );
  if (!schema.installed) {
    await db.query(migration.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, ""));
  }
  const {
    rows: [tenant],
  } = await db.query(
    "insert into public.tenants(name) values ('payment details check') returning id",
  );
  const {
    rows: [order],
  } = await db.query(
    `insert into public.orders
    (tenant_id, status, fulfillment, subtotal, shipping, total, currency, square_order_id, checkout_protection_evidence)
    values ($1, 'pending', 'pickup', 10, 0, 10, 'USD', 'details-check', '{"payment_method":"applePay"}') returning id`,
    [tenant.id],
  );
  const record = (status, details) =>
    db.query(
      "select public.record_square_payment_details('details-check', 'payment-check', $1, 1000, 'USD', $2)",
      [status, details],
    );
  await record("COMPLETED", {
    source_type: "CARD",
    card_type: "VISA",
    card_last4: "4242",
    avs_result_code: "AVS_ACCEPTED",
    cvv2_result_code: "CVV_NOT_CHECKED",
  });
  await record("APPROVED", { source_type: "CARD" });
  const { rows } = await db.query(
    "select payment_method, card_last4, amount_captured, avs_result_code from public.payment_transactions where order_id=$1",
    [order.id],
  );
  assert.deepEqual(rows, [
    {
      payment_method: "applePay",
      card_last4: "4242",
      amount_captured: "10.00",
      avs_result_code: "AVS_ACCEPTED",
    },
  ]);
  assert.equal(
    (await db.query("select status from public.orders where id=$1", [order.id])).rows[0]
      .status,
    "pending",
    "Metadata must never authorize fulfillment",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.checkout_notification_outbox where order_id=$1",
        [order.id],
      )
    ).rows[0].count,
    0,
  );
  for (const [source, method] of [
    ["WALLET", "cashAppPay"],
    ["BUY_NOW_PAY_LATER", "afterpay"],
    ["CARD", "googlePay"],
  ]) {
    await record("COMPLETED", { source_type: source, payment_method: method });
    assert.equal(
      (
        await db.query(
          "select payment_method from public.payment_transactions where order_id=$1",
          [order.id],
        )
      ).rows[0].payment_method,
      method,
    );
  }
  await db.query("savepoint permission_check");
  await db.query("set local role authenticated");
  await assert.rejects(record("COMPLETED", {}), /permission denied/);
  await db.query("rollback to savepoint permission_check");
  console.log(
    "PASS: payment details persist, replay safely, preserve captured amounts, and cannot authorize fulfillment or be written by customers",
  );
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
