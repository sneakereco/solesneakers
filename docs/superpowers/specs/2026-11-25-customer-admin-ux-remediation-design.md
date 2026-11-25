# Customer and admin UX remediation design

Date: November 25, 2026. Status: proposed, awaiting user approval.

## Intent and selected approach

Make the existing shopping and staff tasks trustworthy and usable on mobile and desktop. The user requested assessment of available UX skills and the full customer/admin flows, then selected an assessment first followed by targeted fixes and regression checks. They requested a branch based on main; `codex/customer-admin-ux-audit` was created from freshly fetched `origin/main` at `d8ce10191a294a0974be759bb2cb43b0bd980c53`.

The [assessment](../../operations/customer-admin-ux-audit-2026-11-25.md) contains twelve findings, reproduction evidence and explicit coverage limits. Its [manifest](../../operations/customer-admin-ux-audit-2026-11-25.evidence.json) pins the inspected source. This design proposes the repair scope; approval of the audit approach is not approval of this document.

## Approaches

1. **Assessment, then targeted repairs to existing flows — selected.** Preserve the current site identity and operational structure. Use reproduced defects to define small, reviewable changes and shared acceptance checks. This minimizes visual disruption while addressing state, recovery and accessibility together. The user accepted this recommendation before the assessment.
2. **Visual redesign and broad component-system replacement — considered, not selected.** Could address a future visual-direction or design-system objective, but requires new design decisions and a larger migration/review effort. It does not itself establish correct purchase authority, partial success or recovery behavior.
3. **Individual screen polish without shared state/accessibility work — considered, not selected.** Smaller initial changes, but leaves the observed cross-screen errors and shared overlay/form behavior unresolved. It does not satisfy the requested customer and admin journey coverage.

Alternatives 2 and 3 are agent analysis, not preferences attributed to the user. The implementation should use the first approach the user accepted.

## Goals, boundaries and constraints

- A displayed success, failure, empty or pending state must correspond to the available authoritative facts.
- Invalid or repeated receipt navigation must not consume unrelated shopping state or assert a successful payment.
- Address saves must distinguish saved-address success from default-selection success.
- Forms and overlays must be operable and understandable using a keyboard and assistive technology, with persistent labels and useful error recovery.
- Preserve current branding, policies, shipping/pickup rules, supported payment methods, security controls, consent choices and the agreed cart identity policy. Do not invent a new guest/account merge rule.
- Preserve the repository's existing feature ownership and any separately approved architecture work. Use the installed Next.js guides before code changes.
- Keep staging/production release gates intact. This design authorizes no deployment, migration, provider charge, label purchase, refund, order email or production-data modification.
- Coordinate financial/cart work with current #33/#36 and the separate checkout/cart assessment. Do not create an overlapping payment state model or duplicate existing issues.
- Do not introduce a full component framework, analytics provider, Figma file, new design service or redesigned business flow for this repair program.
- A broad accessibility certification or proof of good UX for every future state is outside this repair's claim. Automated checks and manual evidence must state their limits.

## Repair scope

### 1. Purchase confirmation and recovery: UX-01 and UX-02

Use authoritative order status to distinguish unknown, denied, pending, failed and confirmed outcomes. Remove the unconditional confirmation copy for denied/unverified access. Before a trusted confirmation, preserve the basket, shipping draft and another checkout's idempotency state.

Confirmed purchase consumption must be bound to the trusted order snapshot, remove only purchased quantities once, preserve later/unrelated edits and remain harmless on replay. This behavior belongs with the existing cart/checkout correctness work. Integrate a reviewed existing implementation where available; otherwise implement it as the dependency needed by the UX work. Do not solve it with a generic `clearCart()` on confirmation navigation.

When the bounded status-checking window ends, replace indefinite processing copy with an explicit unresolved state. Offer a safe recheck of the existing attempt and usable order access/support instructions. A timeout must not invite a blind new payment. Preserve confirmation rendering when a trusted result is already available.

Acceptance includes invalid/missing/denied/replayed receipt links, pending/failed/review statuses, newer cart edits, delayed responses, refresh and status deadline recovery. Tests must distinguish a client mock from durable provider recovery; live recovery acceptance remains a staging gate.

### 2. Truthful reads and partial writes: UX-03 and UX-04

Check HTTP status before treating dashboard, transaction, account and affected settings responses as usable data. Use explicit loading, confirmed-empty, unavailable and stale-data views. Keep last valid data where useful, label stale/unavailable totals honestly and offer a bounded retry. A 401 needs a route-appropriate sign-in action; rate limits and transient failures need useful recovery without a retry storm.

The default-address helper must return a result that the caller can use. If address creation succeeds and default selection fails, retain the saved address, report the partial result and retry only the default step. Do not clear the successful result, create a duplicate address or show a combined success message.

Acceptance includes HTTP 401/429/500/503, network failure, successful zero results, slow reads, repeated retry and address-save/default-save combinations. Accessible status announcements must not repeatedly interrupt users during background updates.

### 3. Form accessibility: UX-05

Associate existing visible labels with unique control IDs in account addresses/password, inventory create/edit and shipping/access settings. Repeated variants must not create duplicate IDs. Associate help and error text with the appropriate control, expose required/invalid state and move focus to an actionable error summary or first invalid field on submission where needed.

Preserve the checkout fields' existing accessible names. Add persistent visible context where placeholder-only presentation obscures what a populated value means. Preserve autofill tokens, input types, input modes, password-manager behavior and entered values.

Acceptance uses accessible-name/description checks, label activation, keyboard submission/error correction and repeated-field fixtures. Include manual screen-reader review of the affected task paths; a DOM association check alone is not full assistive-technology validation.

### 4. Shared overlays: UX-06 and UX-07

Establish a consistent modal contract for the storefront cart/search overlays, mobile admin menu and existing `ModalPortal` consumers. Provide an accessible name, suitable initial focus, contained Tab/Shift+Tab, Escape dismissal, background inertness, focus restoration and reliable scroll-lock cleanup. Preserve search cancellation and reduced-motion transitions.

Use the existing implementation style and choose the smallest reusable mechanism that satisfies those behaviors. Native dialog versus a small shared focus-management helper is left to the implementer, with a brief justification; adding a component framework is not required. Preserve independent nested-dialog behavior where an existing workflow needs it. Do not close a payment-processing state in a way that implies an unknown payment failed.

Long forms must scroll inside the viewport without losing close/save/error controls. Test opening, closing, route navigation, repeated opening, zero/one/many focusable elements, background links, nested overlays and focus return on both mobile and desktop. Include physical mobile keyboard/viewport checks in staging.

### 5. Payment initialization and localized clarity: UX-08 through UX-12

- Provide an explicit bounded retry for SDK/card initialization failure while retaining contact, fulfillment, billing and basket data. Reinitialize only the failed component. Keep this separate from payment submission retries and ambiguous-charge recovery. Preserve working alternative payment options.
- Resolve the image-required marker against the existing accepted optional-image rule; do not change the business rule to match the incorrect marker.
- Remove the nested `main` on the brands page while retaining page headings and shared layout.
- Increase compact mobile action hit areas where practical, aiming for 44px. Evaluate WCAG 2.5.8 spacing/inline exceptions before marking a minimum-size failure. Do not enlarge decorative icons unnecessarily.
- Increase the contrast of the audited small sidebar text using existing semantic/theme conventions. Check normal/hover/focus/active backgrounds separately and preserve readable admin surfaces.

Acceptance includes a failed SDK load followed by a successful safe retry, preserved field values, no duplicate payment submission, an image-free product save, one main landmark, measured target geometry and computed contrast against actual backgrounds. Keep the existing browser suites passing.

## Verification and implementation sequencing

1. Pin the actual implementation candidate and reconcile concurrent work. Recheck the assessment's source hashes; close findings only against the code actually integrated.
2. Resolve/integrate the purchase-authority and order-bound cart consumption dependency before changes that depend on it. Keep existing #33/#36 relationships and any related cart/checkout prerequisites visible.
3. Implement truthful reads/partial saves, form labels and shared overlay behavior in independently reviewable changes. Add regressions for the demonstrated failures before each repair.
4. Complete card initialization recovery and localized copy/landmark/target/contrast changes. Use existing product components and repository conventions.
5. Run affected unit/integration/browser checks, then the existing thirteen browser runners on the integrated candidate. Run type checking and lint/format checks appropriate to actual code changes. Do not turn unrelated generated diagnostics into the source of lint failures.
6. Verify the integrated build in staging with correct provider/security hostnames. Re-run shipping and pickup, signed-in and guest, payment cancellation/failure/unknown/pending/confirmed, data failures, keyboard and responsive paths. Complete native wallet/real-device checks with the user where hardware requires it.
7. Review the report's remaining coverage boundaries with actual shopper/staff tasks. Document manual assistive-technology, text resize/zoom, physical keyboard and provider results separately from simulated checks.

## Completion conditions

Each UX finding has an evidence-linked result: fixed and verified, integrated from another reviewed work item, or explicitly left open with its remaining acceptance evidence. No “all UX is good” claim is permitted while material flow or device/provider gates remain unresolved. A green health endpoint, a mocked browser pass or an open PR is not a substitute for the required evidence.

The audit used temporary local accounts, an address and a temporary product. Their cleanup is an assessment obligation, not a migration or seed requirement for the product. Keep credentials/session files out of tracked artifacts.

## Agent calls and decisions left to the builder

- **Agent recommendation:** prioritize truthful state and task access over cosmetic changes; keep the current visual identity.
- **Agent recommendation:** use WCAG 2.2 AA as the accessibility repair baseline and 44px as a practical mobile target where feasible; do not conflate the two target-size thresholds.
- **Agent call:** leave a framework/library addition out of scope; existing React/Next.js/components are sufficient for the proposed repairs.
- **Builder decisions:** exact shared overlay mechanism, existing-component boundaries, error/retry component factoring and test fixture organization. Keep feature code with its approved owner and document material tradeoffs.
- **Requires coordinated evidence:** deployed release/provider results, native-device wallet behavior and any separately approved payment/cart/architecture implementation. This document does not assert those results already exist.

## Approval

Pending user approval after the builder check. After approval, the next step is the implementation plan under the invoked brainstorming workflow; product code must not be changed before that approval.
