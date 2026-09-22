# Shipping email verification

## Local checks without email delivery

```powershell
node scripts/test-checkout-notification-delivery.mjs
node tests/browser/admin-button-contrast.mjs
```

The SQL check rolls back its test data. Before applying the label migration locally,
append `--with-label-migration` to test that migration inside the same rollback.

## Send three real test emails

Apply `20260922120000_label_created_notification.sql` to the local database first.
Then explicitly choose the recipient:

```powershell
doppler run -- npx tsx scripts/test-shipping-emails.ts --send --to YOUR_TEST_EMAIL
```

This script requires local Supabase and sends real email through the configured
SMTP provider. It creates a disposable guest order, saves a synthetic label,
invokes the actual tracking webhook handler with simulated TRANSIT and DELIVERED
events, and runs the existing notification worker for that order only. It checks
SMTP acceptance/audit records and replays events to verify no duplicate sends.
It purchases no label and removes its database fixtures afterward. Test order
links therefore stop working after cleanup. Confirm all three messages in the
recipient inbox; SMTP acceptance alone is not proof of delivery.

## Staging verification

1. Apply the migration, then deploy the matching application code. Existing labels
   are not automatically resent. Use a staging test order addressed to a controlled
   inbox, and the environment's approved sandbox label-purchase flow.
2. Create its label in the admin UI. Confirm one `label_created` outbox row and
   receipt of the label email. The label response says the notification is queued;
   the prompt worker attempts delivery and the existing cron retries failures.
3. Send an authenticated `track_updated` test event to the staging Shippo webhook
   for that exact tracking number, first with `tracking_status.status = TRANSIT`,
   then with `DELIVERED`. Use the configured webhook token without logging it.
4. Check each notification through `checkout_notification_outbox`,
   `email_audit_log`, and the inbox. Expected email types are `label_created`,
   `in_transit`, and `delivered`; successful audit rows have `sent` and a message ID.
   Replay each event: expect no extra notification or email. Check the deployed
   `/api/cron/checkout-notifications` job if rows remain pending or failed.
5. Verify an event arriving from Shippo itself separately. Simulated requests prove
   application handling, but do not prove the deployed webhook subscription,
   provider connectivity, carrier scans, or the scheduled cron invocation.

The cron is configured every five minutes; backlog or retries can delay delivery.
Never change a real customer's fulfillment status to test email delivery.
