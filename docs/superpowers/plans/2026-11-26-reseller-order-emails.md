# Reseller Order Email Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, followed by one independent final review.

**Goal:** Email `SolesneakersLLC@yahoo.com` when an order becomes paid and include the change in PR #51.

**Architecture:** Add a distinct `reseller_order_placed` outbox notification to the existing paid-order trigger. Dispatch a branded HTML/plain-text summary through the existing audited SMTP service. Keep customer confirmation and pickup jobs independent and admit all three jobs to prompt processing.

**Tech Stack:** Next.js, TypeScript, Supabase/PostgreSQL, Nodemailer, Jest, local disposable database fixtures.

**Spec:** The user's November 26 request authorizes this feature and the exact recipient. Order summaries include purchased product names/sizes/quantities, totals, customer email when available, fulfillment method, and a staff-authenticated admin order link. Existing sender and branding apply.

## Global Constraints

- Recipient is server-controlled: `SolesneakersLLC@yahoo.com`.
- Queue only on transition to paid; preserve unique per-order event keys and existing customer/pickup notifications.
- Persist separate audit and retry state for each recipient; do not copy the customer into the reseller email.
- Preserve the current feature branch and all existing PR #51 changes. No production migration, order mutations, or real test messages during implementation.
- Existing staff authentication protects admin links; never include customer access tokens in reseller mail.

## Review Focus

- Webhook/status replays must not create duplicate reseller jobs.
- A missing customer email or failed customer mail must not suppress the reseller alert, and reseller SMTP failure must not suppress customer confirmation.
- Quantity and money must use persisted purchase snapshots and existing dollar units, including multi-quantity and missing optional details.
- Untrusted product names/customer email must be escaped in HTML; the admin URL must use the configured site origin.
- Pickup creates three independent jobs; prompt processing must admit all three and retries must skip an already accepted send.
- Migration precedes app deployment; legacy workers must continue customer-only processing while upgraded workers claim the new kind through a versioned RPC.

## Task 1: Queue and deliver reseller order emails

**Files:** Mail constants/types, new order email template and export, `OrderEmailService`, checkout notification worker/dependencies/scheduler, a new SQL migration, focused unit/database tests, package test command, and an operations note.

**Interfaces:** New notification kind `reseller_order_placed`; `buildResellerOrderPlacedEmail(input)` returns `{html,text}`; `OrderEmailService.sendResellerOrderPlacedFromDetailed({to,order,itemsDetailed})` uses the existing audit/send path. The recipient comes from `RESELLER_ORDER_NOTIFICATION_EMAIL`.

- [x] Add a failing real-dispatch unit fixture with fake database/SMTP boundaries; assert recipient/content/audit, retry deduplication, missing-customer-email handling, and recipient failure isolation.
- [x] Add disposable PostgreSQL tests for shipping/pickup, unpaid orders, repeated paid transitions, and preserved notification kinds; run before implementation.
- [x] Add the template, fixed recipient, audited service method, dispatcher/schema kind, and three-job prompt admission.
- [x] Add the migration that extends the kind constraint and replaces the paid-order enqueue function, preserving customer jobs and event-key idempotency. No historical sends are backfilled.
- [x] Run focused tests and real local SQL checks, then full unit/integration suites, lint, formatting, typecheck and build. Render the email locally for visual inspection.
- [ ] Obtain one final independent review and resolve material issues with regression tests.
- [ ] Commit/push to PR #51, update its description with the migration and verification, and report deployment status accurately.

## Verification

- Observed five dispatch failures, a prompt-capacity failure, and missing SQL reseller jobs before implementation. Additional compatibility checks reproduced old workers claiming unsupported reseller jobs before the versioned RPC repair.
- Full unit suite: 870 tests passed across 159 suites. Integration: 21 passed. Disposable PostgreSQL: 12 passed, including old/new worker compatibility, actual service-role execution, denied customer-role execution, order/lease isolation, and actual audit-schema insertion.
- Production build, standalone typecheck, changed-file lint and formatting, and whitespace checks passed.
- Rendered and inspected the email at 375px and 700px with no horizontal overflow. No real messages sent; no live migration or data changes performed. Hosted delivery remains a release verification step.
