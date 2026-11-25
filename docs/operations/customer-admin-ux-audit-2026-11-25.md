# Customer and admin UX audit — November 25, 2026

The site needs targeted repairs before a broad UX sign-off. The strongest findings concern truthful purchase/account feedback, lost cart state, accessible form labels and keyboard operation of overlays. A visual redesign is not needed to address those findings.

This is the initial assessment the user selected. No product code, schema, production setting or release was changed by this audit. The recommendations below are proposed repairs, not an approved implementation design or a claim that the site is fixed.

## Target and evidence

- Branch created from freshly fetched `origin/main`: `codex/customer-admin-ux-audit`.
- Audited application revision: `d8ce10191a294a0974be759bb2cb43b0bd980c53`.
- Target: local Next.js 16.3.3 development server, local Supabase, development configuration and Square Sandbox configuration. This is not the deployed production site or a production-build performance assessment.
- Primary viewports: Chromium desktop 1440 × 1000 and mobile 390 × 844. Representative pages were also checked at widths 320 and 768. These are browser viewport checks, not physical iPhone/Android/Safari tests.
- Inventoried 45 page route files and inspected public/admin navigation, relevant component/service paths, existing browser coverage and current related GitHub issues. Route inventory and selected source hashes are in the [evidence manifest](customer-admin-ux-audit-2026-11-25.evidence.json).
- Local UI observations, controlled HTTP failures and virtual-clock scenarios are distinguished below. Existing component harnesses use synthetic responses; they do not establish native wallet or real provider completion.
- Other chats added documentation commits to this shared branch during the audit. A final source comparison must remain empty for `src` and `supabase` against the audited application revision; unrelated work is not part of this report's changes.

Criteria: [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), [WCAG 2.2 guidance](https://www.w3.org/WAI/WCAG22/quickref/) and the [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). The WCAG criteria identify what a repair should verify; this is not a complete conformance audit.

## Available UX skills: assessment and selection

| Skills reviewed                                                    | Useful contribution                                                                 | Limits and application here                                                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ux-audit-critique`, `user-flows`                                  | Heuristics, task entry/success/error paths, severity and recovery                   | Useful audit structure. They do not discover routes, operate the application or prove behavior themselves.                                                                   |
| `ecommerce-ux`                                                     | Product/variant clarity, filters, costs, guest checkout, payment feedback and trust | Apply to the existing business rules. Sticky buttons, reviews and other suggestions are not automatic requirements. Do not invent social proof or change the returns policy. |
| `dashboard-saas-ui`                                                | Staff navigation, data tables, status, empty states and permissions                 | Useful for operational tasks. Check actual failures and staff actions, rather than applying a generic dashboard layout.                                                      |
| `accessibility-audit`                                              | Labels, contrast, keyboard access, focus, text resizing, motion and targets         | A starting checklist. Validate details against W3C guidance, including target-spacing exceptions, and add assistive-technology testing.                                      |
| `forms-onboarding-ux`, `ux-writing-microcopy`                      | Persistent labels, required/optional clarity, validation, actionable errors         | Highly relevant to the confirmed form and false-success findings. Preserve entered data and explain partial success.                                                         |
| `layout-grid-hierarchy`, `design-system-builder`, `design-handoff` | Consistent controls, tokens, responsive behavior and documented states              | Prefer small improvements to existing shared patterns. Fixed grid counts and spacing scales are design suggestions, not pass/fail rules.                                     |
| `usability-testing`                                                | Realistic tasks, task success, errors and ease ratings with shoppers/staff          | Real participants are still needed. A fixed five-person rule cannot establish coverage across every audience, device and task.                                               |
| High-fidelity mockup, prototyping and Figma skills                 | Visual alternatives when a repair requires a design choice                          | Available for later use. They are not necessary for proving the state, feedback and accessibility defects in this assessment.                                                |

The selected method combines those checklist topics with application walkthroughs, source tracing, controlled failures and existing browser checks. The plugin checklists were evaluated as reference material; their generic prescriptions are not treated as project requirements. No additional design service, framework or dependency is needed for this assessment.

## Journey coverage

**UI** means the actual local application was inspected. **Controlled** means a browser response or clock was substituted. **Source/harness** means code or existing component tests were reviewed/executed. These are different evidence levels.

| Journey                                | Desktop and mobile assessment                                                                                                                                                                                                                      | Important remaining boundary                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home and shopping navigation           | UI: home, featured/clothing sections, category links, storefront menu, search and empty search results. Existing home/menu harnesses passed.                                                                                                       | Local catalog initially had one product. Large populated catalogs and physical touch interaction were not user-tested.                                          |
| Catalog, filters and product detail    | UI: `/store`, clothing empty state, brand-filter expansion, product size/condition/price, add to cart. Representative reflow checks passed.                                                                                                        | Complex combined filters, long result pagination and unavailable-variant races require additional fixtures.                                                     |
| Cart                                   | UI: empty and populated cart, mobile drawer and quantity/remove control names. Real local add-to-cart and cart navigation worked. Invalid-receipt cart loss reproduced.                                                                            | This pass does not independently re-prove every identity/revision/cross-tab case in the separate checkout/cart assessment.                                      |
| Shipping and pickup checkout           | UI: guest contact, shipping/pickup switch, billing controls, order summary, policy links and sign-in return link. Existing payment/address harnesses passed.                                                                                       | Local guest verification rejected the audit hostname and payment fields failed to initialize. No real payment or native wallet completion was performed.        |
| Authentication                         | UI: password sign-in with temporary customer and super-admin accounts; actual TOTP enrollment and verification; register, email-code, forgot-password and verification screens at mobile/desktop widths. Customer access to admin redirected away. | OTP email delivery, full password reset, recovery codes and a fresh native authenticator challenge were not completed. No verification email was requested.     |
| Customer account                       | UI: addresses, orders, password and sign-out controls. Controlled failed order/address reads and failed default-address update after a successful local address save.                                                                              | Password change, sign-out failure and successful default-address update were not independently exercised end to end.                                            |
| Confirmation and order recovery        | UI: invalid order confirmation URL cleared a real local cart. Controlled anonymous receipt claimed payment acceptance; pending status stopped polling after the deadline. Order-access, cancel/start and recovery pages inspected.                 | Authoritative paid/shipped tracking, signed live order links and closed-browser provider recovery remain separate gates.                                        |
| Contact, pickup hours and policies     | UI: contact, hours, authenticity, brands, shipping/refunds/privacy/terms; contact failure retained the draft and announced an error. Submission was intercepted in-browser.                                                                        | No message was delivered. Policy legal accuracy was not assessed.                                                                                               |
| Admin overview and inventory           | UI: dashboard, inventory/filter controls, create/edit forms, validation, export affordance. A temporary product was created without images (HTTP 201), then its price changed from $125 to $130 (HTTP 200) through the UI.                         | Export contents, archived-product restore, uploads and multi-variant scheduling were not fully exercised. The temporary product was reserved for exact cleanup. |
| Admin merchandising and taxonomy       | UI: featured-products and product-tags screens at desktop/mobile widths; source inventory covers the available actions.                                                                                                                            | Persistent drag reorder, all tag CRUD modes and multi-item keyboard ordering need dedicated task fixtures. No existing merchandising/taxonomy data was changed. |
| Admin transactions                     | UI: list and loaded detail, statuses, item/cost breakdown and email checklist. Transaction row could be opened using keyboard Enter. Controlled HTTP 503 produced a false empty state. Existing detail harness passed.                             | Refund execution and email resend were not triggered. Existing local records are not evidence of a fresh provider payment.                                      |
| Admin shipping and pickups             | UI: queues, item expansion affordances, create-label entry points, pickup status/complete controls, shipping origin editor and default-package settings. Existing shipping-related harnesses passed.                                               | No carrier label was purchased, pickup completed, refund made or order email sent.                                                                              |
| Admin settings, profile and navigation | UI: store/checkout access settings, shipping settings, admin profile, mobile navigation and aliases in the route inventory.                                                                                                                        | Store access, carrier and existing shipping settings were not saved or changed.                                                                                 |
| Recovery and aliases                   | UI: `/checkout/start`, `/checkout/cancel`, unauthorized order status, `/too-many-requests`, `/locked` and a 404. Legacy routes are recorded in the inventory.                                                                                      | Rendering a recovery page does not prove admission limits, a timed launch, provider recovery or every redirect parameter.                                       |

## Findings

Severity is this audit's impact assessment; existing GitHub priorities were not changed. **Critical** means a materially false purchase result or lost shopping state. **Major** means a task/accessibility barrier or misleading outcome. **Minor** means localized clarity or usability work.

### UX-01 — Critical: an unverified receipt clears the cart and can claim a successful payment

**Reproduction:** add the local test product, visit `/cart` and confirm one item. Navigate directly to `/checkout/success?orderId=00000000-0000-4000-8000-000000000099`. The cart became empty before any `/api/orders/…` read. In a separate controlled anonymous-session case, with no trusted order result, the page displayed **“Order Confirmed!”** and **“Your payment was accepted.”**

**Source:** [receipt side effects](../../src/app/checkout/success/page.tsx#L54), [unverified confirmation branch](../../src/app/checkout/success/page.tsx#L171). Related current open work: [#33](https://github.com/sneakereco/solesneakers/issues/33).

**Required repair:** render unknown/denied/pending results truthfully. Consume only confirmed purchased snapshot quantities once; preserve unrelated/later basket edits, guest address and another checkout's retry state. URL parameters and browser caches must not establish payment authority.

**Acceptance:** invalid, denied, pending, failed and replayed receipt cases preserve the correct cart; only authoritative purchase confirmation triggers order-bound consumption. Do not encourage a fresh charge while payment outcome is unknown.

### UX-02 — Major: pending payment feedback continues after polling has stopped

**Controlled reproduction:** return `pending` for order status and advance the browser clock. There were 32 reads at 61 seconds and still 32 at 71 seconds, while the page continued **“Processing your payment”** and asked the shopper to keep the page open. No explicit deadline/recovery state appeared.

**Source:** [fixed polling deadline](../../src/app/checkout/success/page.tsx#L135). Related [#36](https://github.com/sneakereco/solesneakers/issues/36) and the separate checkout/cart assessment.

**Required repair:** after the bounded checking window, show an honest unresolved state with a safe status-check/recovery action and durable order access. Retry the existing attempt; do not turn a timeout into a failed-payment assertion or a new charge.

### UX-03 — Major: failed data reads appear as zero business activity or an empty account

**Controlled reproduction:** HTTP 503 for dashboard product/order reads produced $0 revenue, 0 orders, 0 products and “No orders yet.” A settled transaction read failure produced “No transactions found.” Failed account order/address reads produced “You have not placed an order yet” and “No saved addresses yet.” No useful retry action appeared.

**Source:** [dashboard loading](../../src/app/admin/dashboard/page.tsx#L28), [transaction loading](../../src/app/admin/transactions/page.tsx#L209), [account reads](../../src/components/account/AccountProfile.tsx#L95). Related current open work: [#36](https://github.com/sneakereco/solesneakers/issues/36).

**Required repair:** check HTTP status and distinguish loading, confirmed empty, stale-but-available and unavailable data. Keep existing data where useful, identify unavailable totals and offer a bounded retry. Extend the same treatment to 401/429/network failures and settings reads rather than silently substituting defaults.

### UX-04 — Major: address partial success is reported as complete success

**Reproduction:** save an address on the temporary local customer account with “Set as default shipping address” checked. The address save succeeded (HTTP 200); the separate default update was intercepted as HTTP 503. The banner nevertheless said **“Address saved successfully and set as default shipping.”** The same page still showed **“No default address selected yet.”**

**Source:** [silent default update](../../src/components/account/AccountProfile.tsx#L153), [unconditional combined-success message](../../src/components/account/AccountProfile.tsx#L310).

**Required repair:** return a result from the default update. State “address saved; default could not be updated” when appropriate and offer retry of only the failed step. Retain the successfully saved address and do not create a duplicate.

### UX-05 — Major: key account and staff form controls lack associated labels

**UI evidence:** the customer address/password controls had visible sibling labels but no corresponding input `id`/`htmlFor`, wrapping label or ARIA label. The same pattern appears in product title/price/stock/description controls, shipping origin/package editors and store-access fields. Ten account inputs were unnamed by those associations; the default-address checkbox was properly wrapped in a label.

**Source:** [account address fields](../../src/components/account/AccountProfile.tsx#L589), [account password](../../src/components/account/AccountProfile.tsx#L806), [product fields](../../src/components/inventory/ProductForm.tsx#L1095), [origin fields](../../src/app/admin/settings/shipping/page.tsx#L724).

**Required repair:** connect persistent labels to stable, unique IDs, including repeated variants; associate help/errors and expose required/invalid state. Authentication and some checkout inputs also rely visually on placeholders: preserve their existing accessible names while adding persistent visible context where needed. A placeholder fallback is not equivalent to every input being unnamed.

**Acceptance:** keyboard and screen-reader users can identify and correct each field without relying on layout; clicking visible labels targets their controls. Check WCAG 1.3.1, 3.3.1, 3.3.2 and 4.1.2 as applicable.

### UX-06 — Major: storefront cart/search overlays allow focus into the background

**UI evidence after hydration:** the open cart had `translate-x-0` and was no longer inert, but focus remained on its trigger. Tab visited the close controls and then background “Shop Now,” slideshow controls and other page links. Search correctly focused its input, but Tab also escaped into background content while the search overlay remained open.

**Source:** [cart effect and dialog](../../src/components/cart/CartDrawer.tsx#L27), [search opening behavior](../../src/components/search/SearchOverlay.tsx#L166).

**Required repair:** move initial focus appropriately, contain Tab/Shift+Tab, make background content unavailable while modal, and restore focus to the trigger on close. Preserve Escape, scroll locking, reduced-motion behavior and search cancellation. The closed cart already uses `inert`; do not mistake its retained DOM nodes for an automatically exposed screen-reader dialog.

### UX-07 — Major: admin mobile navigation and generic modals lack a complete dialog contract

**UI evidence:** the mobile admin drawer opened without dialog semantics or an initial focus move; Escape did not close it. The shipping-origin editor had nine unassociated inputs, no dialog role, left focus on the opening control and remained open after Escape.

**Source:** [admin drawer](../../src/components/admin/AdminSidebar.tsx#L238), [generic modal portal](../../src/components/ui/ModalPortal.tsx#L43), [shipping editor](../../src/app/admin/settings/shipping/page.tsx#L699).

**Required repair:** provide a named modal surface, initial/contained/restored focus, Escape close and background inertness. Give long editors an internally scrollable region and keep controls visible above mobile browser/keyboard occlusion. Reuse an accessible primitive across the audited existing overlays rather than redesigning each page.

### UX-08 — Major: card initialization failure asks for a retry without offering a direct retry

**Observed locally:** checkout showed “Secure payment fields could not be loaded. Please retry.” No card reload/retry action was offered. The retry callback is supplied for non-card method errors only.

**Source:** [card initialization error](../../src/components/checkout/SquarePaymentMethods.tsx#L617), [retry selection](../../src/components/checkout/SquarePaymentMethods.tsx#L1523).

**Required repair:** offer a bounded, explicit retry of failed SDK/card initialization that preserves contact, fulfillment, billing and cart data, or offer another usable method. Keep initialization retry separate from ambiguous payment recovery. The local provider/hostname failure is an environment limitation; it does not prove production card initialization fails.

### UX-09 — Minor: image requirements contradict actual product behavior

The form displays **“Images \*”** and also **“Images are optional.”** Creating the temporary local product without images succeeded (HTTP 201).

**Source:** [required marker](../../src/components/inventory/ProductForm.tsx#L1435), [optional help](../../src/components/inventory/ProductForm.tsx#L1591).

**Required repair:** make the visible requirement match the accepted business rule. Do not make images mandatory merely to resolve contradictory copy.

### UX-10 — Minor: the brands page nests a main landmark

The rendered `/brands` document contains two nested `main` elements; other sampled standard storefront pages had one.

**Source:** [brands page main](<../../src/app/(store)/brands/page.tsx#L78>).

**Required repair:** let the shared storefront shell own `main` and use a section/container inside the page. Verify landmarks and page heading structure. This observation is not a standalone claim of complete accessibility nonconformance.

### UX-11 — Minor: some mobile actions have unnecessarily small hit areas

Measured examples at 390px: registration password-visibility buttons were 16 × 16px; the catalog grid-view control and product image-remove action were 20 × 20px. Several text actions were approximately 16–23px high.

**Required repair:** expand the interactive areas around compact icons and frequently used actions, aiming for 44px where practical without making icons visually larger. Assess WCAG 2.5.8 spacing and inline-text exceptions before classifying any individual 24px-minimum failure; the raw size scan alone is not a conformance verdict.

### UX-12 — Minor: small admin sidebar text has insufficient normal-text contrast

Computed colors for “Operations” and the role caption were `rgb(82,82,91)` against `rgb(10,10,10)`, at approximately 9.3–9.6px. The contrast ratio is recorded in the evidence manifest and is below 4.5:1 for normal text.

**Source:** [sidebar section label](../../src/components/admin/AdminSidebar.tsx#L129), [role caption](../../src/components/admin/AdminSidebar.tsx#L219).

**Required repair:** use a readable semantic secondary-text color and review the tiny type size. Check active/hover/focus text against its actual background separately. These samples do not represent a whole-site contrast scan.

## What already works

- The sampled customer/admin pages reflowed without document-level horizontal overflow at 320, 768 and 1440px. Data-table contents may still require local horizontal scrolling; this does not prove every state at every width.
- Product-to-cart navigation and local product create/edit saves worked. Product price, selected size and condition are visible. Empty catalog/cart states offer meaningful next steps.
- Checkout exposes guest sign-in, shipping/pickup, an order summary, billing choices and policy links. Its sign-in link preserves `next=/checkout` in the URL; the complete cart-identity transition was not independently re-proved here.
- Actual password login and TOTP setup/verification worked with temporary accounts. A customer was redirected away from an admin route. This is a bounded role check, not a security audit.
- Search initially focuses its input; the storefront menu initially focuses its container. Transaction rows support keyboard Enter navigation.
- A contact HTTP failure retained the typed message and produced an alert. No contact message was delivered.
- All 13 existing browser runners completed successfully on the audited source. Their assertions cover selected component, visual/state and synthetic-provider scenarios, not every journey above.

## Proposed repair order and continuing UX checks

1. Coordinate UX-01/02 with existing #33/#36 and the [separate checkout/cart assessment](2026-11-25-black-friday-checkout-cart-assessment.md). Preserve authoritative payment state, order-bound cart consumption and the agreed identity policy. Do not start a competing financial-state implementation.
2. Fix truthful unavailable/partial-success states (UX-03/04), then shared overlay behavior and field labeling (UX-05/06/07). These affect both shoppers and staff.
3. Add safe SDK initialization recovery (UX-08). Finish the copy, landmark, target and contrast repairs (UX-09–12) using existing components and theme conventions.
4. For each repair, add a focused regression that fails for the reproduced behavior. Extend the browser acceptance matrix with keyboard open/close/focus return, HTTP 401/429/500/network failures, partial saves, invalid/replayed receipts, pending deadlines and preserved form/cart data. Check mobile and desktop at each affected flow.
5. Run the repaired release candidate in production-like staging, with correctly configured security/provider hostnames. Complete Sandbox payments and real-device/native-wallet checks before claiming payment completion. Do not disable guest verification, MFA or other security controls to manufacture a passing run.
6. Finish manual assistive-technology, 200% text/zoom, 400% reflow, physical mobile keyboard, reduced-motion and shopper/staff usability tasks. Define task success and recovery expectations before observing participants. Browser smoke tests alone cannot prove good UX for all users at all times.

This assessment does not approve a visual redesign, business-rule change, production deployment or a complete WCAG conformance claim. It provides concrete repair scope and acceptance conditions for the next design/implementation decision.

## Verification and cleanup

Selected visual evidence: [unverified confirmation](customer-admin-ux-audit-2026-11-25/unverified-confirmed-mobile.png), [contradictory default-address success](customer-admin-ux-audit-2026-11-25/address-partial-save-mobile.png), [mobile inventory form](customer-admin-ux-audit-2026-11-25/inventory-create-mobile.png) and [open cart](customer-admin-ux-audit-2026-11-25/cart-open-mobile.png).

Executed successfully: `payment-methods`, `checkout-ui`, `shipping-validation`, `checkout-success`, `checkout-progress`, `admin-transaction-detail`, `admin-button-contrast`, `shipping-settings-modal`, `store-menu`, `home-featured-items`, `home-clothing`, `home-categories`, `storefront-branding`, each under `tests/browser/*.mjs`.

Use the existing browser cache on this host:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\dsrus\AppData\Local\ms-playwright'
node tests/browser/checkout-success.mjs
node tests/browser/checkout-progress.mjs
node tests/browser/admin-button-contrast.mjs
```

The evidence manifest records the remaining runner names, source fingerprints, selected screenshots and ad hoc observation files. Most raw observations live in the ignored `test-results/ux-audit-2026-11-25` directory and are local evidence, not portable CI fixtures. They may contain existing local test-customer records; do not publish the whole directory as a public artifact. Only selected screenshots free of existing customer data accompany this report.

Cleanup is complete: the two audit accounts, their address and the one audit product/variant were removed. Exact-ID checks found no remaining audit users, profiles, variants or address rows; the original one product and three orders remained. The five credential/session/fixture files, isolated browser profile and local audit server were removed or stopped. The evidence manifest records these results. Existing settings were not changed.

Development logs included hydration mismatch warnings on authentication/inventory controls and Supabase session-use warnings. Their production-build impact was not established here; investigate them on the integrated release candidate rather than treating the development smoke checks as a clean production console result.

No payment, label purchase, refund, order completion, message delivery, migration or deployment was performed.
