# Customer and admin UX remediation design

Date: November 25, 2026. Status: approved by the user, including the expanded mobile feedback and skeleton loading scope; implementation authorized.

Scope update: the user subsequently requested consistent mobile tap feedback and skeleton loaders across all loading states. This revision adds the feedback/loading coverage below to the existing twelve-finding repair program. The user then explicitly approved the expanded plan and implementation.

## Intent and selected approach

Make the existing shopping and staff tasks trustworthy and usable on mobile and desktop. The user requested assessment of available UX skills and the full customer/admin flows, then selected an assessment first followed by targeted fixes and regression checks. They requested a branch based on main; `codex/customer-admin-ux-audit` was created from freshly fetched `origin/main` at `d8ce10191a294a0974be759bb2cb43b0bd980c53`.

The [assessment](../../operations/customer-admin-ux-audit-2026-11-25.md) contains twelve findings, reproduction evidence and explicit coverage limits. Its [manifest](../../operations/customer-admin-ux-audit-2026-11-25.evidence.json) pins the inspected source. This document records the approved repair scope; the later explicit implementation approval is recorded below.

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
- Every admitted action must acknowledge touch, mouse or keyboard activation immediately, communicate any ongoing work and provide a truthful result. Every asynchronous content region must have an intentional loading presentation on mobile and desktop.
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

### 6. Site-wide interaction feedback and skeleton loading

The user described mobile actions that feel unresponsive because tapping provides no visible acknowledgement. They also requested skeleton loaders for all loading states. Treat this as full customer/admin coverage, including navigation, content fetching, refetching, form submission and long-running operations. The intent is a responsive, restrained presentation that fits the current site.

**Verified starting point:** no `loading.*` route files, shared Button component or shared Skeleton component were found in the current source inventory. A few hand-built pulse placeholders already exist in `SearchOverlay`, `Navbar`, `ShippingEstimate` and the MFA QR fallback. `FeaturedItems`, account lists and several admin screens use text or default values while loading. Some buttons already change labels such as “Saving...” or “Logging in...”; preserve useful behavior while making it consistent. These source observations extend the assessment; they are not new browser tests of every interaction.

#### Shared feedback behavior

- **Press:** provide an immediate visual pressed state on actionable buttons, icon buttons and links. It must work on touch and keyboard, including controls without hover. Use a restrained surface/border/opacity change; any small transform must respect reduced motion. Do not animate the whole page or require a minimum animation before handling the action.
- **Pending action:** show an action-specific label and compact indicator, such as “Adding...”, “Saving...” or “Signing in...”, as soon as the operation is admitted. Keep the button's size stable. Prevent duplicate side effects for that command, retain focus appropriately and keep unrelated actions usable. Keyboard submission must enter the same pending path as a tap.
- **Result:** show an inline result, updated selection/cart count, or an accessible status/toast appropriate to the action. Confirm only the change that actually succeeded; retain input and a useful retry on failure. Synchronous local actions can show their true result directly without a manufactured spinner or delay.
- **Navigation:** show pressed/selected feedback on the initiating link and meaningful route/region loading UI while the destination is unresolved. Keep shared navigation usable. Preserve required hard-document navigation into checkout and any associated security/provider headers.

A shared action primitive, link feedback treatment and state styles should provide a consistent contract while existing feature code continues to own its requests/results. Preserve native semantics, form submission, link modifier/new-tab behavior, disabled behavior and payment-provider controls. Do not apply a global event interceptor, global spinner or blanket style transformation to every DOM button or third-party iframe.

The design call is subtle neutral feedback matching the current storefront/admin themes. Hover, focus-visible, pressed, selected, disabled, pending, success and error must remain distinguishable. Actual operation latency must not be used to time animations. Never manufacture success or delay completed content just to display a loader. [Feedback guidance](https://www.nngroup.com/articles/progress-indicators/).

#### Loading presentation by state

| State                                                                                     | Required presentation                                                                                                                                                | Preservation and exit rule                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First content load                                                                        | Skeleton shaped like the destination: product cards/gallery, account address/order blocks, dashboard metrics, lists/tables or detail panels                          | Reserve realistic responsive geometry; retain headings/shell where known. Exit to content, confirmed empty or error. Never use zero totals or an empty-state message as loading UI.                                                        |
| First route navigation / streamed content                                                 | Appropriate lightweight route fallback and local Suspense boundaries where needed                                                                                    | A route `loading.tsx` does not cover runtime work in its same-segment layout. Keep auth/role gates intact and show only safe placeholders; do not expose protected data before authorization.                                              |
| Filter, sort, pagination, search or background refresh                                    | Keep usable existing content, show a clearly scoped updating indicator, and use local skeletons for genuinely unresolved/new content                                 | Retain current selections and avoid presenting old results as confirmed results for a newly selected query. Apply responses only to the current request; cancel/discard superseded work. Preserve focus, scroll and usable input.          |
| Form/save/add/remove/retry command                                                        | Press feedback followed by a stable pending button/row and a meaningful result                                                                                       | Keep the form/draft visible. Disable or guard only conflicting commands. A content skeleton must not erase the form while saving.                                                                                                          |
| Cart/session hydration and first account data                                             | Cart line/summary or account-detail skeleton until identity/data readiness is known                                                                                  | Do not flash “empty cart”, “signed out”, account absence or default money values before the corresponding fact is known. Do not invent a new cart identity policy.                                                                         |
| Checkout quote or shipping/address lookup                                                 | Local total/rate/address-suggestion placeholder or busy region; retain the rest of checkout                                                                          | Label estimated versus exact totals and unavailable quotes. A placeholder or old total cannot enable an unverified payment. Preserve billing/contact and address corrections.                                                              |
| Payment SDK, wallet handoff, payment submission and receipt resolution                    | Keep suitable field/card placeholders only while fields are being initialized; use persistent, specific progress/status during approval and payment/order resolution | Maintain continuous feedback across route/provider handoffs without competing overlays. Do not replace a provider challenge with a skeleton or imply acceptance before a trusted result. Keep deadline/recovery behavior from UX-01/02/08. |
| Image upload, compression, import/export, shipping rates/labels and multi-step staff work | Button/row progress with named stages; show determinate progress only when real work counts/bytes are available                                                      | Retain the draft/current records. Do not invent percentages or completion estimates. End in a truthful result or recoverable failure; respect confirmation and authorization for provider side effects.                                    |

**Skeleton contract:** use shared neutral shape primitives with feature-owned compositions that match the current mobile/desktop layout. Reserve image aspect ratios, line heights and table/list geometry to limit layout shifts. Skeletons are non-interactive and hidden from the accessibility tree; give the containing region a useful busy state and a single concise loading/status announcement. Do not announce each placeholder or repeated pulse. Use a subtle pulse as the design default, with static placeholders under reduced motion. A slow/failing request must leave skeleton mode for an explicit recoverable state according to the region's deadline policy. Status changes must be available without moving focus unnecessarily. [Status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

**Fast-operation policy:** acknowledge activation immediately. Initial placeholders may reserve their geometry as soon as content is unresolved; an animated indicator can appear after a short presentation delay if necessary to avoid a flash on cached results. This delay must not defer pending state, allow a second mutation or hold back a completed result. Exact animation/reveal timings are builder decisions to validate against the existing theme and slow/fast tests.

#### Coverage required before this scope can close

Build a checked inventory of actual route regions and user actions, rather than treating creation of a shared component as completion. At minimum cover:

- **Storefront:** menu/search, search suggestions/results, featured/clothing/category sections, catalog filters/sort/pagination/view controls, product/gallery/variant selection, add to cart, drawer/full-cart updates and checkout entry.
- **Identity/account/contact:** password and email-code login, signup, verification/resend, password reset, TOTP setup/challenge/copy, sign-out, address add/remove/default, order history, password change and contact submission.
- **Checkout/orders:** cart/session hydration, shipping/pickup changes, quotes, address suggestions/review, payment method and SDK loading/retry, wallet approval, submit/processing/receipt/order-status and recovery navigation.
- **Admin catalog/merchandising:** inventory list/filter/search/page/export, create/edit/restore, brand/model parsing/options, variants, images/uploads, scheduling, featured selection/reorder and all tag tabs/CRUD modes.
- **Admin operations:** dashboard, transaction lists/counts/search/detail, email preview/resend, refund entry points if present, shipping/pickup tabs/details, rate/label actions, pickup completion, origin/default packages/carriers, store/checkout access settings and navigation/profile.

For every asynchronous entry, record initial load, repeat/refetch, admitted action, success, empty, error and cancellation/timeout as applicable. Static/local actions need visible press/selection/result feedback; mark a network loading state as not applicable when no such work exists. Do not add fake waits to static policy pages or already available data.

**Acceptance:** use touch-enabled browser contexts and keyboard on mobile/desktop. Hold requests open and assert acknowledgement before resolving them; verify a second tap cannot duplicate the same write. Exercise fast cached responses, slow/hung/failed requests, repeat navigation, stale responses, reduced motion and recovery. Assert skeleton geometry at representative widths, retained drafts/content, accessible busy/status messages and no placeholder-based enablement of checkout or staff mutations. Existing working request/error/payment behavior must continue to pass. Native devices, assistive technology and production-like staging checks remain separately recorded gates.

The implementation uses the installed Next.js 16.3.3 guidance for `loading.js`, linking/navigation and `useLinkStatus`: route fallbacks cover server-rendered navigation; client fetches/mutations still need their own state; a link-status hook, if needed, must live under its actual Link and must not disable prefetching just to force a loading effect. Specific suspense placement, action primitive boundaries and per-feature skeleton shapes are builder decisions within these constraints.

## Verification and implementation sequencing

1. Pin the actual implementation candidate and reconcile concurrent work. Recheck the assessment's source hashes; close findings only against the code actually integrated.
2. Resolve/integrate the purchase-authority and order-bound cart consumption dependency before changes that depend on it. Keep existing #33/#36 relationships and any related cart/checkout prerequisites visible.
3. Implement truthful reads/partial saves, form labels and shared overlay behavior in independently reviewable changes. Add regressions for the demonstrated failures before each repair.
4. Establish shared press/pending/result feedback and skeleton primitives, then apply them to the complete customer/admin loading/action inventory. Include both route fallbacks and client-data loading states; preserve the state and authorization rules above. This is a required site-wide workstream, not optional polish after the original findings.
5. Complete card initialization recovery and localized copy/landmark/target/contrast changes. Use existing product components and repository conventions.
6. Run affected unit/integration/browser checks, then the existing thirteen browser runners on the integrated candidate. Run type checking and lint/format checks appropriate to actual code changes. Do not turn unrelated generated diagnostics into the source of lint failures.
7. Verify the integrated build in staging with correct provider/security hostnames. Re-run shipping and pickup, signed-in and guest, payment cancellation/failure/unknown/pending/confirmed, data failures, keyboard and responsive paths. Complete native wallet/real-device checks with the user where hardware requires it.
8. Review the report's remaining coverage boundaries with actual shopper/staff tasks. Document manual assistive-technology, text resize/zoom, physical keyboard and provider results separately from simulated checks.

## Completion conditions

Each UX finding has an evidence-linked result: fixed and verified, integrated from another reviewed work item, or explicitly left open with its remaining acceptance evidence. The feedback/loading inventory must also account for every customer/admin action and asynchronous region; shared primitives alone do not satisfy that coverage. No “all UX is good” claim is permitted while material flow or device/provider gates remain unresolved. A green health endpoint, a mocked browser pass or an open PR is not a substitute for the required evidence.

The audit used temporary local accounts, an address and a temporary product. Their cleanup is an assessment obligation, not a migration or seed requirement for the product. Keep credentials/session files out of tracked artifacts.

## Agent calls and decisions left to the builder

- **Agent recommendation:** prioritize truthful state and task access over cosmetic changes; keep the current visual identity.
- **Agent recommendation:** use WCAG 2.2 AA as the accessibility repair baseline and 44px as a practical mobile target where feasible; do not conflate the two target-size thresholds.
- **Agent call:** leave a framework/library addition out of scope; existing React/Next.js/components are sufficient for the proposed repairs.
- **Builder decisions:** exact shared overlay mechanism, existing-component boundaries, error/retry component factoring and test fixture organization. Keep feature code with its approved owner and document material tradeoffs.
- **Requires coordinated evidence:** deployed release/provider results, native-device wallet behavior and any separately approved payment/cart/architecture implementation. This document does not assert those results already exist.

## Approval

The user approved this expanded design and explicitly requested planning and implementation on November 25, 2026. The implementation plan is `docs/superpowers/plans/2026-11-25-customer-admin-ux-implementation.md`. Execution proceeds without another approval question; existing deployment/provider boundaries remain unchanged.
