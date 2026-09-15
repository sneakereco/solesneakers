# Shipping deliverability implementation plan

**Goal:** Require Shippo-validated US shipping destinations before payment and preserve both addresses for Square Risk Manager.
**Architecture:** Validate in the protected prepare handler after rate limiting and before returning even reused checkout orders. Use Shippo v2 through server-only credentials. Return structured corrections to the existing payment dialog, accept explicitly, recalculate quotes, and revalidate. Express wallet addresses use the same server gate and remember an accepted correction for a matching wallet contact.
**Tech stack:** Existing Next.js/React, Zod, native fetch, Jest and Playwright. No new dependencies.
**Spec:** User-approved Shippo deliverability and Square address forwarding; existing Square rule is already configured.

- [x] Write failing provider and prepare-handler regressions: valid/correctable/invalid/outage, all shipping payment methods, pickup skip, reused order validation, no reservation on failure.
- [x] Implement Shippo adapter and shared result/error contract; enforce validation before Square order creation/reuse.
- [x] Add explicit correction confirmation, preserve billing, recalculate totals, revalidate wallet corrections without bypassing secure payment gates.
- [x] Verify provider responses with public US addresses, browser correction flows, Square payload regression, lint/typecheck/build and review.

Do not alter popup sequencing, Square Dashboard rules, or billing-address requirements. No deliverability bypass when provider results are ambiguous. No payment or label purchase during testing.

## Completion evidence

- Address checks have a separate rate-limit budget, preserving reservation limits during correction retries.
- The pay handler revalidates the stored shipping destination before charging, including older orders and permits. This intentionally adds a second lookup per completed shipping checkout without introducing persisted validation proofs.
- Billing and shipping remain distinct in Square payment payloads; the existing Dashboard rule was not changed.
- 60 targeted Jest suites / 267 tests, three browser regressions, lint, typecheck, production build, and diff whitespace checks passed. The final wallet-address-change regression failed before the cache fix and passed afterward.
- Live Shippo checks with public US addresses confirmed correction, accepted correction, and invalid-address responses using the configured test token. No payment or label was purchased.
- Focused review has no remaining high or medium findings. Changes are local and not deployed; production credentials and deployed end-to-end behavior remain release checks.
