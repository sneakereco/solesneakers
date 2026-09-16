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

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260916090000_checkout_notification_delivery.sql",
    import.meta.url,
  ),
  "utf8",
);
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("begin");
  await client.query(migration);

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

  console.info("checkout notification delivery SQL check passed");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
