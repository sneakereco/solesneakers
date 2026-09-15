# Checkout UI Implementation Plan

**Goal:** Apply the approved screenshot design around Square's grouped secure card form.
**Architecture:** Keep the existing SDK instances and authorization flow. Share native field validation across checkout inputs, validate regular checkout before payment, and keep express checkout independent.
**Tech Stack:** React, Next.js, Tailwind/CSS, Square Web Payments SDK, existing Jest and Playwright tooling.
**Spec:** Approved design in this task: continuous selected panel, detected card brands, shared billing section, blur/submit errors, reduced-motion-aware transitions. No additional payment methods or custom card-number inputs.

1. [x] Add a browser regression for blur/submit validation, shared billing, card events, method switching and express bypass; run it against current components to establish failure.
2. [x] Update CheckoutPaymentPanel and card brand assets; keep the secure form mounted and put wallet descriptions inside their selected row.
3. [x] Add shared CheckoutField validation, update contact/delivery/billing inputs, and wire regular submission in SquarePaymentMethods without weakening quote/security gates.
4. [x] Subscribe to documented Square field/brand events; apply supported card styles and CSS transitions; preserve values and keyboard focus.
5. [x] Run browser regressions, checkout/Square Jest tests, lint, typecheck and build. Inspect desktop/mobile screenshots; explicitly report any live-provider checks not performed.

Regular payment reveals invalid visible contact, address, and cardholder-name fields before preparation. Square tokenization owns secure-card submit validation; event metadata is used for blur feedback, never as an autofill-sensitive submission gate. Express checkout must not acquire page-form prerequisites. Blank optional billing phone and apartment fields remain valid. Square native errors remain inside its grouped secure form; fallback messages appear below it without duplicating native errors. Only SDK metadata is observed.

Validation: 54 targeted Jest suites / 218 tests passed; browser regressions cover regular/express validation, shared billing, wallet lifecycle, card events, stale autofill metadata, Enter submission, INVALID token blocking, responsive layout and reduced motion. Real Square Sandbox iframe checked with test card data and screenshots. No real charge, deployed staging checkout, or production payment was exercised. Final lint and production build are recorded in the task results.
