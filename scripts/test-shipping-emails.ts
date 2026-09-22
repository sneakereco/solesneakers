// Explicit opt-in: sends three real emails using a disposable local order.
// doppler run -- npx tsx scripts/test-shipping-emails.ts --send --to you@example.com
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";

import { env } from "../src/config/env";
import { POST as trackingWebhook } from "../src/app/api/webhooks/shippo/route";
import { createSupabaseAdminClient } from "../src/lib/supabase/service-role";
import { createCheckoutNotificationDependencies } from "../src/lib/checkout/checkout-notification-dependencies";
import { processCheckoutNotifications } from "../src/lib/checkout/checkout-notification-worker";

async function main() {
  const recipientIndex = process.argv.indexOf("--to");
  const recipient = recipientIndex >= 0 ? process.argv[recipientIndex + 1] : undefined;
  assert(process.argv.includes("--send"), "Use --send to authorize real email delivery.");
  assert(
    recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient),
    "Provide --to email@example.com.",
  );
  for (const url of [env.SUPABASE_DB_URL, env.NEXT_PUBLIC_SUPABASE_URL]) {
    assert(
      ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
      "Only a local database may be used.",
    );
  }

  const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
  await db.connect();
  const orderId = randomUUID();
  const tenantId = randomUUID();
  const trackingNumber = `TEST-${orderId}`;
  const dependencies = createCheckoutNotificationDependencies(
    createSupabaseAdminClient(),
    orderId,
  );
  try {
    assert(
      (
        await db.query(
          "select 1 from pg_trigger where tgname = 'queue_label_created_notification'",
        )
      ).rowCount,
      "Apply the label-created migration locally first.",
    );
    await db.query(
      "insert into public.tenants(id, name) values ($1, 'Disposable shipping email test')",
      [tenantId],
    );
    await db.query(
      "insert into public.orders(id, tenant_id, subtotal, shipping, total, status, fulfillment, guest_email, currency) values ($1, $2, 10, 0, 10, 'paid', 'ship', $3, 'USD')",
      [orderId, tenantId, recipient],
    );
    console.info(
      `Sending three shipping emails for disposable order ${orderId} to ${recipient}. No label is purchased.`,
    );
    await db.query(
      "update public.orders set fulfillment_status = 'ready_to_ship', label_url = 'https://example.com/test-label.pdf', tracking_number = $2, shipping_carrier = 'usps' where id = $1",
      [orderId, trackingNumber],
    );
    assert.deepEqual(await processCheckoutNotifications(dependencies, 1), {
      claimed: 1,
      sent: 1,
      failed: 0,
    });
    await db.query("update public.orders set label_url = label_url where id = $1", [
      orderId,
    ]);
    assert.equal((await processCheckoutNotifications(dependencies, 1)).claimed, 0);

    for (const status of ["TRANSIT", "DELIVERED"]) {
      const request = () =>
        new NextRequest(
          `http://localhost/api/webhooks/shippo?token=${encodeURIComponent(env.SHIPPO_WEBHOOK_TOKEN)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              event: "track_updated",
              data: {
                tracking_number: trackingNumber,
                carrier: "usps",
                tracking_status: { status },
              },
            }),
          },
        );
      assert.equal((await trackingWebhook(request())).status, 200);
      assert.deepEqual(await processCheckoutNotifications(dependencies, 1), {
        claimed: 1,
        sent: 1,
        failed: 0,
      });
      assert.equal((await trackingWebhook(request())).status, 200);
      assert.equal((await processCheckoutNotifications(dependencies, 1)).claimed, 0);
    }
    const { rows } = await db.query(
      "select email_type, delivery_status, message_id from public.email_audit_log where order_id = $1 order by sent_at",
      [orderId],
    );
    assert.deepEqual(
      rows.map((row) => row.email_type),
      ["label_created", "in_transit", "delivered"],
    );
    assert(rows.every((row) => row.delivery_status === "sent" && row.message_id));
    console.info(JSON.stringify(rows, null, 2));
    console.info(
      "PASS: three SMTP acceptances, no duplicate sends. Check the recipient inbox to confirm delivery.",
    );
  } finally {
    try {
      // These IDs are generated above; cleanup never touches existing orders.
      for (const table of [
        "email_audit_log",
        "checkout_notification_outbox",
        "order_access_tokens",
        "order_events",
      ]) {
        await db.query(`delete from public.${table} where order_id = $1`, [orderId]);
      }
      await db.query("delete from public.orders where id = $1", [orderId]);
      await db.query("delete from public.tenants where id = $1", [tenantId]);
    } finally {
      await db.end();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
