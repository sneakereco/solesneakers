# Wallet Checkout Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wallet checkout quote, billing, loading, and provider CSP behavior reliable without blocking standard checkout.

**Architecture:** Keep Square as the pricing and payment authority. Preliminary wallet destinations omit the incomplete Square shipment fulfillment; the final token supplies the complete fulfillment and optional billing snapshot. Optional wallet methods initialize independently while a stable, accessible express-checkout loading shell remains visible.

**Tech Stack:** Next.js 16 client components, React 19, Square Web Payments SDK, TypeScript, Jest.

**Spec:** Approved remediation plan in the 2026-09-09 checkout debugging task.

## Global Constraints

- Do not add dependencies or change the single-page checkout layout.
- Do not block card checkout while optional wallet methods initialize.
- Preserve final server-side price reconciliation and fail closed when totals genuinely change.
- Make no commits unless the user requests one.

---

### Task 1: Redacted wallet quote

**Files:**

- Modify: `tests/unit/square-checkout-order-payload.test.ts`
- Modify: `src/lib/square/checkout-order-payload.ts`

**Interfaces:**

- Consumes: `buildSquareCheckoutOrder(locationId, input)`
- Produces: an order calculation payload without a shipment fulfillment for a redacted destination; full final addresses still produce the existing shipment contract.

- [x] Change the redacted-destination test to require `fulfillments` to be absent.
- [x] Run the focused test and verify it fails because a shipment is currently emitted.
- [x] Gate shipment creation on a complete shipping address.
- [x] Run the focused test and verify both preliminary and final payload tests pass.

### Task 2: Wallet billing snapshot

**Files:**

- Modify: `tests/unit/square-payment-methods.test.tsx`
- Modify: `src/lib/square/web-payments.ts`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`

**Interfaces:**

- Consumes: `SquareTokenResult.details.billing`
- Produces: normalized `CheckoutBillingAddress | null` passed to `prepare()` when the wallet returns a complete US billing contact.

- [x] Add a failing test for normalizing wallet billing contact.
- [x] Run it and verify the helper is missing.
- [x] Add billing token typing, request billing contact, and pass normalized billing into preparation.
- [x] Run the focused wallet tests and verify they pass.

### Task 3: Stable express loading and independent methods

**Files:**

- Modify: `tests/unit/express-checkout-methods.test.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`
- Modify: `src/components/checkout/ExpressCheckoutMethods.tsx`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`

**Interfaces:**

- Consumes: `loading` plus per-method readiness.
- Produces: an accessible loading shell and concurrent, independently settled wallet initialization.

- [x] Add a failing render test requiring the heading and loading message before readiness.
- [x] Run it and verify the section is currently hidden.
- [x] Render the shell while loading and collapse it only after no methods are available.
- [x] Initialize provider methods concurrently and settle loading after all eligible methods finish.
- [x] Run both focused component test files.

### Task 4: Focused payment CSP

**Files:**

- Modify: `tests/unit/security-headers.test.ts`
- Modify: `src/config/security.ts`

**Interfaces:**

- Produces: exact Google Pay connection and Square Marketplace script origins in development and production CSP policies.

- [x] Add failing CSP assertions for `https://pay.google.com`, `https://js-sandbox.squarecdn.com`, and `https://js.squarecdn.com`.
- [x] Run the security-header test and verify the sources are absent.
- [x] Add only those observed provider origins.
- [x] Run the security-header test and verify it passes.

### Task 5: Verification

**Files:**

- Verify all modified files.

**Interfaces:**

- Produces: clean focused tests, unit suite, lint, typecheck, and production build.

- [x] Run the focused checkout and security tests.
- [x] Run `npm run test:jest:unit`.
- [x] Run `npm run lint` and `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Inspect the final diff and confirm no unrelated files changed.
