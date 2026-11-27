# Payment confirmation recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded repair. Steps use checkbox syntax.

**Goal:** Confirm a submitted payment and enqueue its customer emails promptly without depending on the five-minute cron or a webhook.

**Architecture:** After a payment outcome commits, run the existing, order-and-attempt-bound financial inquiry using Next.js `after` and the existing recovery dependency lease. Keep the durable recovery job and all provider verification, stock consumption, review, and notification idempotency checks.

**Tech stack:** Next.js 16, TypeScript, Square, PostgreSQL/Supabase, Jest.

**Spec:** The user's requested investigation and reliability repair, with production evidence in `docs/operations/order-confirmation-incident-2026-11-27.md`.

## Constraints and review focus

- Do not submit another payment or infer confirmation from the browser response.
- Schedule only after the server has committed the exact payment attempt.
- Respect the existing four-slot recovery capacity and ten-second operation deadline.
- Preserve payment results and durable work if scheduling, capacity, or inquiry fails.
- Treat SMTP acceptance as sent; inbox delivery requires separate evidence.
- Production diagnostics are read-only. Do not send test messages to customers.

## Task 1: Prompt payment reconciliation

**Files:** `src/lib/checkout/payment-api-dependencies.ts`, `src/lib/square/financial-inquiry-dependencies.ts`, `tests/unit/payment-confirmation-recovery.test.ts`.

**Interface:** Add `promptSquareAttempt(db, orderId, attemptId): void` beside the existing webhook prompt. It invokes `SquareFinancialInquiry.recoverAttempt(orderId, attemptId)` after the response, under `withDependency`.

- [x] Add and run failing tests for committed succeeded/pending/unknown attempts, scheduling failure, busy capacity, and inquiry failure.
- [x] Wire prompt reconciliation after successful persistence in the production payment dependency factory. Do not prompt ready/declined/canceled/review outcomes.
- [x] Run focused payment, outcome, recovery, and email tests, type checking, and all repository Jest integration suites. The broad unit sweep was interrupted after a slow unrelated analytics test; the complete focused rerun passed 129 tests. No full-unit-suite success is claimed.

## Task 2: Record production evidence and verification limits

- [x] Record the exact order/payment/confirmation timeline and aggregate notification audit results.
- [x] Separate live evidence for order/pickup emails from unobserved shipping/refund/password emails, and identify the separate Supabase Auth path.
- [x] State that local validation does not constitute deployment or inbox-delivery verification.

Independent review found no actionable issues. Production remains unchanged. The existing disabled Square subscription and mismatched production-configuration signing key require a deliberate provider/environment restoration through the release gates. After refreshed AWS authentication, SES/CloudWatch confirmed 32 sends and 32 receiving-server delivery events with no observed bounce, complaint, or rejection metrics in the inspected 24 hours. Per-message delivery attribution remains unavailable because provider IDs/event feedback are not retained.

## Task 3: Authorized production restoration

- [x] Isolate the payment hotfix on the currently deployed beta.10 source.
- [x] Align production Doppler with the existing Square subscription signing key; confirm the protected Vercel variable update. Keep the subscription disabled until deployment verification.
- [x] Review and extract the necessary protected-secret deployment gate correction with regression coverage; exclude unrelated reporting, decline recovery, and migrations.
- [ ] Pass local and remote checks, merge through the staging gate, and release a scoped production tag.
- [ ] Verify the deployed signature handling, enable the existing subscription, and verify idempotent receipt recovery and notification state without creating a customer payment or sending a test customer email.
