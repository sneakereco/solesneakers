# Checkout Reference Visual Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/checkout` match the approved reference composition outside Square-owned iframes, restore secure Card fields, isolate Square payment-method failures, and retain every existing server-authoritative checkout and security boundary.

**Architecture:** Keep `CheckoutClient` as the form/payment pipeline coordinator. Extract checkout header, contact, delivery, express-wallet, payment-panel, and Square-style/diagnostic concerns into focused modules. Load Square `Payments` once, but initialize Card, Apple Pay, Google Pay, Cash App Pay, and Afterpay independently so one failure cannot suppress the others.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.9, Tailwind CSS, Square Web Payments SDK, Jest 30.

**Spec:** [2026-09-08-checkout-reference-visual-restructure-design.md](../specs/2026-09-08-checkout-reference-visual-restructure-design.md)

## Global Constraints

- Do not change quote, prepare, reservation, permit, payment, webhook, inventory, tax, or fraud-control authority.
- Square continues to own all raw card fields and payment-method eligibility.
- Do not fake card-brand or wallet artwork. Omit card-brand artwork until genuine approved assets are supplied.
- Preserve unrelated working-tree changes. Stop if a planned file contains overlapping user edits.
- Before editing Next.js layout, Link, or Image code, read the relevant local Next 16 guides under `node_modules/next/dist/docs/01-app/01-getting-started/`.

---

### Task 1: Repair Card initialization with supported Square styles

**Files:**

- Create: `src/components/checkout/square-card-style.ts`
- Create: `src/components/checkout/square-card-initialization.ts`
- Create: `src/components/checkout/square-payment-diagnostics.ts`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`
- Create: `tests/unit/square-payment-diagnostics.test.ts`

- [ ] Write failing tests that require documented focus/error borders, reject `boxShadow`, and require sanitized method/phase/error diagnostics.
- [ ] Run `npm run test:jest:unit -- --runTestsByPath tests/unit/square-payment-methods.test.tsx tests/unit/square-payment-diagnostics.test.ts`; confirm RED because the modules do not exist and `boxShadow` remains.
- [ ] Extract the style object using only documented selector/property combinations. Replace the swallowed Card error with customer-safe retry state plus sanitized diagnostics.
- [ ] Store the successfully created Square `Payments` object before Card creation/attachment so Card failure cannot stop wallet capability checks.
- [ ] Rerun the focused tests, run `git diff --check`, and commit as `fix: isolate Square card initialization`.

---

### Task 2: Add the checkout-only header and direct cart navigation

**Files:**

- Create: `src/components/checkout/CheckoutHeader.tsx`
- Modify: `src/components/checkout/CheckoutClient.tsx`
- Create: `tests/unit/checkout-header.test.tsx`
- Modify: `tests/unit/checkout-client.test.tsx`

- [ ] Read `03-layouts-and-pages.md`, `04-linking-and-navigating.md`, and `12-images.md` from the local Next 16 App Router guides.
- [ ] Write a failing test for the Sole Sneakers logo, direct `/cart` link, accessible item count, and absence of a cart-drawer trigger.
- [ ] Run `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-header.test.tsx tests/unit/checkout-client.test.tsx`; confirm RED because checkout has no route-specific header.
- [ ] Implement a normal-flow checkout header using the existing logo, `next/link`, cart context, and an accessible cart icon/count. Render it only in the main checkout experience so processing, success, and cancel routes do not offer navigation away during payment handling. Keep checkout outside the storefront drawer shell.
- [ ] Rerun the focused tests, run `git diff --check`, and commit as `feat: add checkout header`.

---

### Task 3: Extract Contact and Delivery without changing form authority

**Files:**

- Create: `src/components/checkout/CheckoutContactSection.tsx`
- Create: `src/components/checkout/CheckoutDeliverySection.tsx`
- Modify: `src/components/checkout/CheckoutClient.tsx`
- Create: `tests/unit/checkout-contact-section.test.tsx`
- Create: `tests/unit/checkout-delivery-section.test.tsx`
- Modify: `tests/unit/checkout-client.test.tsx`

- [ ] Write failing Contact tests: guests get `/auth/login?next=%2Fcheckout`; signed-in customers do not; account email is prefilled; no marketing controls render.
- [ ] Write failing Delivery tests: Ship/Pickup semantics, reference field order, pickup location, split first/last UI fields, and no shipping-method chooser.
- [ ] Run the three focused suites and confirm RED because the components do not exist and current Delivery markup differs.
- [ ] Extract controlled presentation components. Keep state, address normalization, quote invalidation, stale-response protection, and prepare payload construction in `CheckoutClient`.
- [ ] Adapt first/last UI values into the existing server address contract; do not change server schemas unless a failing contract test proves it necessary.
- [ ] Rerun the focused tests, run `git diff --check`, and commit as `refactor: split checkout contact and delivery`.

---

### Task 4: Isolate Express wallet presentation and availability

**Files:**

- Create: `src/components/checkout/ExpressCheckoutMethods.tsx`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Create: `tests/unit/express-checkout-methods.test.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`

- [ ] Write failing tests proving Apple Pay, Google Pay, and Cash App Pay render only when individually ready; one failure cannot hide another ready method or Card; zero ready methods collapses Express and its divider.
- [ ] Add a regression test that rejects Card attachment and still expects Google Pay initialization from the shared `Payments` object.
- [ ] Run both focused suites and confirm RED against the coupled component.
- [ ] Extract the Express presentation and give every method independent readiness, cleanup, and diagnostics. Preserve Apple Pay's immediate-click tokenization and Google Pay/Cash App attachment containers.
- [ ] Rerun the focused tests, run `git diff --check`, and commit as `refactor: isolate checkout wallets`.

---

### Task 5: Build the reference Payment panel without fake brand marks

**Files:**

- Create: `src/components/checkout/CheckoutPaymentPanel.tsx`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `src/components/checkout/BillingAddressFields.tsx`
- Delete: `src/components/checkout/PaymentBrandMarks.tsx`
- Create: `tests/unit/checkout-payment-panel.test.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`

- [ ] Write failing tests for Card default selection, conditional Afterpay row, same-as-shipping behavior, required pickup billing, Afterpay redirect copy, and radio semantics.
- [ ] Replace the old brand-mark assertion with one proving no CSS-generated Visa/Mastercard/Amex or `+5` placeholder renders before genuine assets exist.
- [ ] Run both focused suites and confirm RED.
- [ ] Implement the controlled panel with reference borders, selected row, spacing, typography, billing expansion, and responsive grids. Keep Square's iframe mounted in its host.
- [ ] Preserve Card/Afterpay tokenization, billing normalization, Turnstile, prepare, permit, clear-cart, and navigation. Delete the obsolete faux artwork only after no imports remain.
- [ ] Rerun the focused tests, run `git diff --check`, and commit as `refactor: build checkout payment panel`.

---

### Task 6: Apply the approved two-column visual system

**Files:**

- Modify: `src/components/checkout/CheckoutClient.tsx`
- Modify: `src/components/checkout/CheckoutOrderSummary.tsx`
- Modify: `src/components/checkout/checkout-field-styles.ts`
- Modify: `tests/unit/checkout-client.test.tsx`
- Modify: `tests/unit/checkout-order-summary.test.tsx`
- Modify: `tests/unit/checkout-theme.test.ts`

- [ ] Write failing composition tests for left-column order, mobile summary-first order, cart-only summary content, and absence of every explicitly excluded section.
- [ ] Add focused visual-contract checks for approved palette, divider, widths, radii, focus treatment, and responsive grids without snapshotting volatile class order.
- [ ] Run the three focused suites and confirm RED against the current composition.
- [ ] Apply the reference shell, rhythm, divider, fields, segmented control, summary, and mobile collapse. Retain existing cart item data and server quote states.
- [ ] Continue showing configured flat shipping and exact/preliminary tax honestly; add no discount or free-shipping claim.
- [ ] Rerun the focused tests, run `git diff --check`, and commit as `feat: match checkout reference layout`.

---

### Task 7: Run full verification and record external provider gates

**Files:**

- Create: `docs/verification/2026-09-08-checkout-reference-visual-restructure.md`
- Modify checkout files only when a demonstrated test/browser failure requires it.

- [ ] Run all focused checkout suites from Tasks 1–6 together; require PASS.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run test:jest`, and `npm run build`; require exit code 0. If Jest discovers a mounted worktree, apply the documented `.worktrees` exclusion before diagnosing an application regression.
- [ ] Capture 1440px desktop and 390px mobile browser evidence for top, Delivery, Card, separate billing, Pickup, and eligible Afterpay states. Record Square iframe differences separately.
- [ ] On deployed staging, record browser/device, visible state, diagnostic, tokenization, and payment result for Card, Apple Pay, Google Pay, Cash App Pay, and Afterpay. Verify Apple domain registration and Afterpay merchant/amount eligibility as external gates.
- [ ] Record evidence in the verification document, run `git diff --check`, commit as `docs: verify checkout visual restructure`, and confirm `git status --short --branch` contains only intentionally preserved user changes.
