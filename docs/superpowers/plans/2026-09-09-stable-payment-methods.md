# Stable Payment Methods Implementation Plan

> **For agentic workers:** Implement task-by-task using superpowers:executing-plans or superpowers:subagent-driven-development. Track the checkboxes below.

**Goal:** Keep payment choices stable across shipping, pickup, and address edits.

**Architecture:** Apple Pay and Google Pay remain express wallets with independent requests that update before opening. Cash App and Afterpay are persistent local-payment choices. Serialize SDK attachment and cleanup, and reject stale quote authorization.

**Tech Stack:** Next.js 16.3.3, React 19, Square Web Payments, existing Jest and Playwright.

**Spec:** User-approved design in this task: Apple/Google express; card/Cash App/Afterpay under Payment. Preserve provider eligibility, exact totals, billing validation, and security checks.

## Global Constraints

Work inline. No new dependencies. Preserve single-page checkout and server-authoritative totals. Do not commit or deploy as part of local implementation.

## Tasks

- [x] Stable UI: update CheckoutPaymentPanel and ExpressCheckoutMethods with persistent Cash App/Afterpay choices, independent status, provider-specific action, and SSR regressions. Run `npm run test:jest:unit -- --runInBand checkout-payment-panel express-checkout-methods`.
- [x] SDK lifecycle: separate express requests from Cash App/Afterpay; serialize replacement and disposal; dispose late initialization before attachment. Add runnable delayed-provider tests proving stale methods never attach and old disposal completes before replacement.
- [x] Readiness: pass explicit quote readiness from CheckoutClient, read latest callbacks, update wallet requests before opening, and reject Cash App token completion for changed quote identity. Add stale-quote and update-failure tests.
- [x] CSP: restore `https://google.com/pay` alongside `https://pay.google.com` in production connect-src (development already permits HTTPS); prove regression fails before restoring removed source.
- [x] Verify: focused tests, full unit/integration tests, lint, typecheck, build, and diff review. Report local evidence separately from staging wallet validation.

## Verification evidence

- 314 unit tests and 20 integration tests passed.
- Lint, typecheck, build (97 pages), and git diff --check passed.
- `node tests/browser/payment-methods.mjs` passes with the real React DOM and a simulated external Square SDK. The same harness fails against the original HEAD component sources because Cash App is not a visible payment choice.
- Independent review found no significant new correctness/security issues.
- Live staging SDK eligibility, popup/QR approval, payment capture, and order redirect remain deployment checks; no deployment or commit was performed.
