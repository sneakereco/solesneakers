import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import pg from "pg";

const connectionString =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:64332/postgres";
const databaseUrl = new URL(connectionString);
assert(
  databaseUrl.hostname === "127.0.0.1" || databaseUrl.hostname === "localhost",
  "This rollback check only runs against local PostgreSQL.",
);

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("begin");
  if (process.argv.includes("--with-label-migration")) {
    await client.query(
      await readFile(
        new URL(
          "../supabase/migrations/20260922120000_label_created_notification.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }

  const { rows: tenants } = await client.query(
    "insert into public.tenants(name) values ('notification rollback check') returning id",
  );
  const { rows: orders } = await client.query(
    `insert into public.orders(
       tenant_id, subtotal, shipping, total, status, fulfillment, guest_email, currency
     ) values ($1, 10, 0, 10, 'pending', 'pickup', 'rollback@example.com', 'USD')
     returning id`,
    [tenants[0].id],
  );
  const orderId = orders[0].id;

  await client.query("update public.orders set status = 'paid' where id = $1", [orderId]);
  await client.query("update public.orders set status = 'paid' where id = $1", [orderId]);

  const { rows: queued } = await client.query(
    `select kind from public.checkout_notification_outbox
     where order_id = $1 order by kind`,
    [orderId],
  );
  assert.deepEqual(
    queued.map(({ kind }) => kind),
    ["order_confirmation", "pickup_instructions"],
  );

  const { rows: firstClaim } = await client.query(
    "select public.claim_checkout_notifications_for_order($1, 1) as jobs",
    [orderId],
  );
  const { rows: competingClaim } = await client.query(
    "select public.claim_checkout_notifications(2) as jobs",
  );
  const claimed = [firstClaim[0].jobs[0], ...competingClaim[0].jobs].filter(
    ({ orderId: claimedOrderId }) => claimedOrderId === orderId,
  );
  assert.equal(claimed.length, 2);
  assert.equal(new Set(claimed.map(({ id }) => id)).size, 2);

  await client.query("select public.finish_checkout_notification($1, false)", [
    claimed[0].id,
  ]);
  await client.query("select public.finish_checkout_notification($1, true)", [
    claimed[1].id,
  ]);
  const { rows: outcomes } = await client.query(
    `select status, next_attempt_at > now() as delayed
     from public.checkout_notification_outbox
     where id = any($1::uuid[]) order by status`,
    [claimed.map(({ id }) => id)],
  );
  assert.deepEqual(
    outcomes.map(({ status, delayed }) => ({ status, delayed })),
    [
      { status: "failed", delayed: true },
      { status: "sent", delayed: false },
    ],
  );

  await client.query("savepoint permission_check");
  let denied = false;
  try {
    await client.query("set local role authenticated");
    await client.query("select public.claim_checkout_notifications_for_order($1, 1)", [
      orderId,
    ]);
  } catch {
    denied = true;
    await client.query("rollback to savepoint permission_check");
  }
  assert.equal(denied, true, "Authenticated callers must not claim notifications.");

  await client.query(
    "update public.orders set fulfillment = 'ship', fulfillment_status = 'ready_to_ship', tracking_number = 'notification-test-tracking', shipping_carrier = 'usps', tracking_url = 'https://example.com/track', label_url = 'https://example.com/label.pdf' where id = $1",
    [orderId],
  );
  await client.query("update public.orders set label_url = label_url where id = $1", [
    orderId,
  ]);
  const { rows: labels } = await client.query(
    "select kind, payload from public.checkout_notification_outbox where order_id = $1 and kind = 'label_created'",
    [orderId],
  );
  assert.equal(
    labels.length,
    1,
    "Saving a label must atomically queue exactly one notification.",
  );
  assert.equal(labels[0].payload.trackingNumber, "notification-test-tracking");
  assert.equal(labels[0].payload.trackingUrl, "https://example.com/track");
  for (const status of ["shipped", "shipped", "delivered", "delivered", "shipped"]) {
    await client.query(
      "select public.record_shippo_tracking_update($1, $2, 'usps', null)",
      ["notification-test-tracking", status],
    );
  }
  const { rows: milestones } = await client.query(
    "select kind from public.checkout_notification_outbox where order_id = $1 and kind in ('label_created', 'shipping_update', 'delivery_confirmation') order by kind",
    [orderId],
  );
  assert.deepEqual(
    milestones.map((row) => row.kind),
    ["delivery_confirmation", "label_created", "shipping_update"],
  );
  const { rows: finalOrder } = await client.query(
    "select fulfillment_status from public.orders where id = $1",
    [orderId],
  );
  assert.equal(finalOrder[0].fulfillment_status, "delivered");

  console.info("checkout notification delivery SQL check passed");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
