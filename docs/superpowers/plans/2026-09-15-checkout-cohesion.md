# Checkout Cohesion Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent tasks with explicit file ownership, then review the whole branch. Track each task below.

**Goal:** Repair pickup contacts, Afterpay, and notification delivery while unifying checkout and branding.

**Architecture:** Extend the existing prepare/reservation/order contracts with pickup contact. Reuse the notification outbox and shared email theme. Keep payment-provider adapters and security rules intact.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Supabase/PostgreSQL, Square Web Payments SDK, Nodemailer, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-checkout-cohesion-design.md`

## Global constraints

- Pickup instructions remain a separate email.
- No extra Pay click to finish express checkout; no weakening security, billing, address, totals, or inventory protections.
- No new dependencies. Preserve unrelated changes and storage compatibility.
- No production deployment or migration. Record real staging coverage separately from mocked/local checks.

## Task 1: Separate immediate notifications

**Files:** `src/lib/checkout/checkout-notification-*.ts`, paid reconciliation callers/routes, `src/services/order-email-service.ts`, `supabase/migrations/20260916090000_checkout_notification_delivery.sql`, related notification tests.

**Interfaces:** Consume persisted paid orders. Produce `pickup_instructions` outbox jobs and an order-scoped notification dispatch using existing claim/send/finish semantics.

- [ ] Add regression cases proving paid pickup queues both kinds exactly once, delivery failures retry independently, and sent audit records prevent a retry after queue completion failure.
- [ ] Run focused tests and record expected failures.
- [ ] Implement the migration, order-scoped claim, dispatch after persisted successful payment, and confirmation audit linkage. Reuse Next `after` for route lifetime where appropriate; fallback cron remains authoritative.
- [ ] Verify with Jest and a rollback database check, including concurrency and failed send.

```ts
expect(notifications.map(({ kind }) => kind).sort()).toEqual([
  "order_confirmation", "pickup_instructions",
]);
expect(replayedNotifications).toHaveLength(2);
```

## Task 2: Pickup contact contract

**Files:** checkout request/client/payment components, checkout hash/prepare/reservation, Square order payload, admin orders/pickups, generated database types, migration `20260916091000_checkout_pickup_contact.sql`.

**Interfaces:** `pickupContact: { name: string; phone: string } | null`; email remains the authoritative buyer email. Wallet completion resolves only missing fields in its existing attempt.

- [ ] Test missing/invalid pickup contact rejection, persistence, identity changes, and Square recipient mapping.
- [ ] Observe failures, then carry the contact end to end and display it to staff.
- [ ] Add continuation for missing wallet contact without retokenizing or charging before completion.
- [ ] Run contract tests and browser cases for pickup card/wallet contact handling.

```ts
expect(prepareCheckoutRequestSchema.safeParse({ ...pickup, pickupContact: null }).success).toBe(false);
expect(order.fulfillments?.[0]?.pickupDetails?.recipient).toMatchObject({
  displayName: "Pickup Buyer", phoneNumber: "3365550100", emailAddress: "buyer@example.com",
});
```

## Task 3: Afterpay shipping and checkout progress

**Files:** `SquarePaymentMethods.tsx`, a focused Afterpay shipping helper if needed, existing payment dialog/panel, related tests.

**Interfaces:** Authoritative prepared address and quote supply shipping options; the callback compares normalized full destination fields where provided and never treats a shared ZIP as proof of an identical address. Pickup supplies provider pickup details.

- [ ] Test ZIP+4 equivalence, different street/apartment rejection, missing contact, pickup, and exact totals.
- [ ] Implement the smallest provider-specific correction; retain normal address review and total reauthorization.
- [ ] Use the existing payment dialog for app-owned progress; avoid simultaneous button/dialog spinners and treat provider cancel consistently.
- [ ] Verify flow and focus behavior in existing browser harnesses.

## Task 4: Email styling and customer-visible branding

**Files:** `src/lib/email/theme.ts`, `template.ts`, transactional templates, customer-visible legacy-brand locations, auth email templates as applicable.

**Interfaces:** Existing template inputs and centralized brand/contact constants remain stable.

- [ ] Render representative confirmation, pickup, shipping, refund, and auth messages; keep separate pickup instructions explicit.
- [ ] Soften typography, borders, spacing and buttons; remove slogans and redundant product metadata while preserving prices, status, appointment/ID instructions, and support.
- [ ] Replace old visible brand names, logo references, SEO and social links using existing constants.
- [ ] Run template checks and inspect rendered desktop/mobile output. Do not rename storage/rate-limit keys without compatibility work.

## Task 5: Integration, review, and staging coverage

**Files:** Existing tests plus `docs/operations/checkout-validation.md`.

- [ ] Run relevant SQL rollback checks, unit/integration suites, typecheck, lint, formatting and build.
- [ ] Review the complete diff for money, security, concurrency, and required business-rule preservation; fix actionable findings.
- [ ] Run the authorized staging Sandbox matrix where access/device capabilities permit; record each outcome and concrete blockers. Do not claim mocked SDK tests as live payment evidence.
- [ ] Keep a reviewable feature branch/PR and report deployment/migration requirements without changing production.
