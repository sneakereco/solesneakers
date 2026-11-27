# Paid-order email notifications

Each transition to paid queues a customer confirmation and a separate
`reseller_order_placed` job. Pickup also queues its existing instructions.
Unique event keys prevent repeated paid-status updates from creating extra jobs.
Existing orders are not backfilled by this migration.

Reseller alerts go to **SolesneakersLLC@yahoo.com**, configured by
`RESELLER_ORDER_NOTIFICATION_EMAIL` in `src/config/constants/mail.ts`. Customer
confirmations retain the account email, or guest checkout email, as their
recipient. Request payloads cannot override the reseller destination.

The reseller email uses the existing sender `info@shopsolesneakers.com` and site
branding. HTML and plain text include the purchased names/sizes/quantities,
subtotal, shipping, tax, total, fulfillment method, customer email when available,
and an authenticated `/admin/transactions/<orderId>` link. Customer access tokens
are not included.

The prompt worker admits three jobs per order, covering pickup instructions,
customer confirmation, and reseller notification. Existing cron processing and
retry scheduling remain the fallback. Each message has its own notification ID,
audit row, and success/failure state; a reseller failure does not suppress the
customer email, and missing customer contact does not suppress the reseller alert.

Apply `20261127020000_reseller_order_notifications.sql` through the existing
migration/release pipeline alongside the application update. Inspect
`checkout_notification_outbox.kind = 'reseller_order_placed'` and
`email_audit_log.email_type = 'reseller_order_placed'` after a paid order.
`delivery_status = 'sent'` and a message ID record SMTP acceptance, which does not
prove inbox delivery. Hosted delivery remains a release verification step.

The migration retains the legacy claim RPCs for customer-only work. The upgraded
application uses `claim_checkout_notifications_v2` to include reseller alerts.
Older workers therefore continue customer delivery during deployment or an app
rollback, leaving reseller jobs pending for an upgraded worker. Both paths retain
row locking, retry leases, and order scoping.

Run `node --test --test-concurrency=1 tests/database/reseller-order-notifications.test.mjs`
with the existing marked disposable local database fixture via
`SPECIALTY_TEST_DATABASE_URL`. It refuses hosted/non-disposable targets and removes
its owned test database afterward. Unit dispatch checks run in
`tests/unit/reseller-order-notification.test.ts`; no real email is sent by them.
