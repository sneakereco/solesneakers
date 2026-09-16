# Checkout Confirmation Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the time from clicking Pay to seeing Order Confirmed without weakening payment verification.

**Architecture:** Keep Square and database reconciliation authoritative. Give the webhook a short grace period, reconcile on the second pending status check, carry the verified paid response across the soft navigation, and keep the normal status fetch as a background refresh.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest, Playwright browser harness.

**Spec:** Approved in the current task after the checkout latency investigation.

## Global Constraints

- Do not show confirmation until `/api/orders/:orderId` returns `paid`.
- Preserve the 60-second deadline and reconciliation cooldown.
- Do not change Square charging, idempotency, or fulfillment behavior.
- Keep the existing uncommitted generated database types file untouched.

---

### Task 1: Faster verified polling

**Files:**

- Modify: `src/lib/checkout/checkout-order-polling.ts`
- Test: `tests/unit/checkout-order-polling.test.ts`

**Interfaces:**

- Produces: `startCheckoutOrderPolling(..., onState)` supplies the paid order response as the callback's second argument.
- Produces: first retry after 500 ms with `reconcile=1`; later retries remain at 2 seconds.

- [x] Add a test that the second request occurs at 500 ms, includes `reconcile=1`, and returns the paid response to the callback.
- [x] Run the focused test and confirm it fails against the current 2-second/third-attempt behavior.
- [x] Implement the 500 ms second attempt and paid-response callback.
- [x] Run the focused test and confirm it passes.

### Task 2: Remove the redundant confirmation wait

**Files:**

- Create: `src/lib/checkout/confirmed-order-cache.ts`
- Modify: `src/app/checkout/processing/page.tsx`
- Modify: `src/app/checkout/success/page.tsx`
- Test: `tests/browser/checkout-progress.mjs`
- Test: `tests/unit/confirmed-order-cache.test.ts`

**Interfaces:**

- Produces: `storeConfirmedOrder(status)` stores only a verified paid response for its order ID.
- Produces: `readConfirmedOrder(orderId)` returns a minimally validated paid response once, then removes it.

- [x] Add unit tests for matching paid data and rejection of malformed, pending, or wrong-order data.
- [x] Change the browser test to require Order Confirmed after the first paid response, without waiting for a second response.
- [x] Run both tests and confirm they fail.
- [x] Store the paid response before navigation and initialize the success page from the one-time cache while retaining its background refresh.
- [x] Run both tests and confirm they pass.

### Task 3: Observable end-to-end timing

**Files:**

- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `src/app/checkout/processing/page.tsx`
- Test: `tests/browser/checkout-progress.mjs`

**Interfaces:**

- Produces: Performance entry `checkout-click-to-confirmed` for a successful soft-navigation checkout.

- [x] Add a browser assertion for the completed performance measure and confirm it fails.
- [x] Mark payment start before preparation and measure confirmation after the verified paid response.
- [x] Run the browser test and confirm it passes.

### Task 4: Verification

**Files:**

- Verify all files above.

- [x] Run focused unit and browser tests.
- [x] Run all unit tests, checkout browser suites, lint, and scoped diff checks.
- [x] Run typecheck and report the existing generated database-types failures separately if they remain.
