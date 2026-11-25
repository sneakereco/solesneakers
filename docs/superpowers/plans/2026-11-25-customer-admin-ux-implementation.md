# Customer and Admin UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved UX repairs, immediate action feedback and intentional loading/skeleton states throughout customer and admin mobile/desktop journeys.

**Architecture:** Add small shared interaction, loading, error and modal primitives; keep feature-specific request/state and skeleton compositions with existing feature components. Apply them to an explicit action/region inventory. Purchase feedback consumes authoritative order facts and order-bound cart snapshots, never URL/cache assertions.

**Tech Stack:** Installed Next.js 16.3.3, React 19, TypeScript, Tailwind/site.css, Jest and existing Playwright/esbuild/PostCSS browser harnesses. No new dependency or full component framework.

**Spec:** `docs/superpowers/specs/2026-11-25-customer-admin-ux-remediation-design.md`, approved by the user including the site-wide feedback/loading expansion.

## Global Constraints

- Preserve current branding, policies, shipping/pickup rules, supported payment methods, security controls, consent choices and the agreed cart identity policy. Do not invent a new guest/account merge rule.
- Keep staging/production release gates intact. This design authorizes no deployment, migration, provider charge, label purchase, refund, order email or production-data modification.
- Do not introduce a full component framework, analytics provider, Figma file, new design service or redesigned business flow for this repair program.
- Every admitted action must acknowledge touch, mouse or keyboard activation immediately, communicate any ongoing work and provide a truthful result. Every asynchronous content region must have an intentional loading presentation on mobile and desktop.
- Skeletons are non-interactive and hidden from the accessibility tree; give the containing region a useful busy state and a single concise loading/status announcement.
- Never manufacture success or delay completed content just to display a loader.
- Preserve required hard-document navigation into checkout and any associated security/provider headers.
- A skeleton or old total cannot enable an unverified payment. Keep initialization retries separate from ambiguous payment recovery.
- Keep feature code together in the existing feature folders. This worktree has no `.codegraph/`; do not query the parent checkout's index for this branch.
- Work only in `C:/dev/projects/sneakereco/solesneakers/.worktrees/ux-remediation`, branch `codex/customer-admin-ux-implementation`, base `37151afc`. Other chats own the parent checkout. Use explicit workdir/absolute paths.

## Review Focus

1. Two taps or Enter plus tap before a pending render must not duplicate a mutation; Tasks 1, 4, 5 and 7 hold the response and assert one command.
2. Cached/URL receipt data and a late response for another identity must never establish purchase authority or consume a new basket; Task 6 tests replay, lineage, identity and storage-write failure.
3. Loading boundaries must not flash signed-out/empty/zero data, expose protected content or stop provider challenges receiving focus; Tasks 3, 4, 5, 7 and 8 exercise those transitions.
4. Escape in a select or nested modal must close only its owner and return focus correctly; Task 2 tests nested/native surfaces and RdkSelect keyboard behavior.
5. Slow/failed/refreshed data must preserve input/current usable content and exit busy state with an actionable result; Tasks 3–8 test failures, cancellation, stale responses and reduced motion.

## File ownership and interfaces

- Shared primitives live under `src/components/ui`; shared HTTP failure classification under `src/lib/http`. Request ownership stays with features.
- Feature skeletons live under the corresponding existing `store`, `cart`, `account`, `admin`, `auth` and `checkout` component folders. Route `loading.tsx` files import those compositions.
- `ActionButton` preserves native button props and caller classes, with `pending?: boolean`, `pendingLabel?: string`, `variant?: "primary" | "secondary" | "ghost" | "danger"`; its default must not override existing feature appearance.
- `useAsyncAction()` returns `{ pending: boolean, run: <T>(operation: () => Promise<T>) => Promise<T | undefined> }`. It synchronously admits one operation, resets in finally and rethrows errors to feature handling. Duplicate admission is a no-op, not a second request.
- `Skeleton({className?})`, `LoadingState({label,children,className?})`, `RequestError({message,onRetry?,retrying?,signInHref?})`, and `readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T>`. The HTTP helper throws a typed `ResponseError` carrying status; UI copy remains safe/feature appropriate.
- `ModalPortal` retains its existing props and adds `label?`, `labelledBy?`, `describedBy?`, `placement?: "center" | "left" | "right"`, and `initialFocusRef?`. It supplies one native named modal surface, correct body scroll lifecycle, Escape/backdrop handling and focus restoration. Consumers stop adding a second dialog role.
- `RdkSelect` additionally accepts `id?`, `aria-label?` and `aria-labelledby?` for the real trigger so later feature-label repairs can associate visible field labels without duplicating select implementations.
- Cart ownership remains guest sessionStorage (`rdk_cart_session`) versus per-user localStorage (`rdk_cart_user_<id>`). Internal storage may migrate legacy arrays to a versioned envelope to atomically persist items, revision/line lineage and consumed-order metadata. Keep reading legacy arrays/legacy migration safely.
- Task 6 adds optional authoritative `purchasedItems?: Array<{productId:string;variantId:string;quantity:number}>` and `customerId?: string | null` to `OrderStatusResponse`; authenticated/token authorization remains unchanged. Older/mock responses without this evidence must not mutate a cart.
- Task 6 exposes `captureCheckoutSnapshot(): CartCheckoutSnapshot`, `bindCheckoutSnapshot(orderId: string, snapshot: CartCheckoutSnapshot): void`, and `consumeConfirmedOrder(order: OrderStatusResponse): boolean` through the cart context; exact opaque snapshot type is owned by `src/lib/cart/checkout-snapshot.ts`. Task 7 captures before preparation awaits and binds only the returned order ID.

---

### Task 1: Shared action, loading and request-state primitives

**Files:** Create `src/components/ui/ActionButton.tsx`, `useAsyncAction.ts`, `Skeleton.tsx`, `RequestError.tsx`, `src/lib/http/read-json-response.ts`, `tests/unit/ux-primitives.test.tsx`, `tests/unit/read-json-response.test.ts`, `tests/browser/ux-primitives.mjs`, `tests/browser/helpers/ux-harness.mjs`; modify `src/styles/site.css`.

**Interfaces:** Produces the shared interfaces above for Tasks 2–8. Existing components are not migrated in this task.

- [ ] Write failing tests: SSR semantics of pending buttons and hidden skeletons; safe HTTP 401/429/503/invalid-JSON classification; browser held-request admission, stable button geometry, touch/Space/Enter, error release and static reduced-motion skeletons.
- [ ] Run `node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath tests/unit/ux-primitives.test.tsx tests/unit/read-json-response.test.ts` and `node tests/browser/ux-primitives.mjs`; record expected failures before implementation.
- [ ] Implement the interfaces. Use CSS `:active`/focus-visible for synchronous acknowledgement, stable pending content, scoped classes/data attributes rather than a global event interceptor, and one accessible busy/status announcement per region. Native disabled/selected semantics and unrelated actions remain intact.
- [ ] Re-run the focused checks and `node node_modules/tsc/bin/tsc --noEmit`; format the changed files. The browser harness compiles real components and holds fixture requests; no fake waits or duplicated product logic.
- [ ] Self-review and commit only this task's files; write RED/GREEN commands/output and concerns to its report.

### Task 2: Accessible shared overlays and keyboard interaction

**Files:** Modify `src/components/ui/ModalPortal.tsx`, `ConfirmDialog.tsx`, `Select.tsx`, `src/components/cart/CartDrawer.tsx`, `src/components/search/SearchOverlay.tsx`, `src/components/shell/StoreMenuDrawer.tsx`, `src/components/admin/AdminSidebar.tsx`, existing ModalPortal consumers under `src/components/admin/orders`, `src/components/admin/shipping`, `src/app/admin/shipping/page.tsx`, `src/app/admin/settings/shipping/page.tsx`; create `tests/browser/ux-overlays.mjs`; adapt `src/components/ui/hydration.test.tsx` if markup semantics change.

**Interfaces:** Consumes Task 1 actions; produces the extended `ModalPortal` above. Feature loading/data changes belong to later tasks.

- [ ] Add browser regressions proving initial focus, Tab/Shift+Tab containment, inert background, Escape, trigger focus return, repeat opening and nested modal/select ownership. Cover cart/search/admin drawer plus shipping editor at 390×844 and 1440×1000.
- [ ] Run `node tests/browser/ux-overlays.mjs` and record the current missing behavior.
- [ ] Implement named native dialog surfaces and portal placement while preserving current geometry, transitions and reduced motion. RdkSelect Escape must stop propagation when its menu consumes Escape; option Enter must not accidentally submit the enclosing form. Label each ModalPortal call site and remove duplicate roles/handlers. Keep the payment provider's existing native dialog/foreign challenge handling unchanged.
- [ ] Run the new browser check and existing `node tests/browser/admin-button-contrast.mjs`, `node tests/browser/shipping-settings-modal.mjs`, `node tests/browser/store-menu.mjs`; run affected unit tests and typecheck. Increase small sidebar text contrast to at least 4.5:1 and compact menu controls to practical touch areas while retaining the theme.
- [ ] Self-review, report and commit the scoped overlay work.

### Task 3: Storefront navigation, browsing and cart loading/feedback

**Files:** Modify `src/app/layout.tsx`, `src/components/shell/ClientShell.tsx`, `Navbar.tsx`, `Footer.tsx`, `src/components/home/FeaturedItems.tsx`, `HomepageCategories.tsx`, `OutfitSlideshow.tsx`, `src/components/store/ProductDetail.tsx`, `ProductCard.tsx`, `ProductGrid.tsx`, `StoreControls.tsx`, `StorefrontFilterBar.tsx`, `src/components/cart/CartDrawer.tsx`, `ShippingEstimate.tsx`, `src/app/(store)/cart/page.tsx`, `src/app/(store)/brands/page.tsx`; create shared link feedback `src/components/ui/FeedbackLink.tsx`, feature skeleton files `StoreSkeletons.tsx`, `CartSkeleton.tsx`, `src/components/shell/SessionShell.tsx`, `RootLoadingShell.tsx`; create root/store/store-detail/cart route loading files and `tests/browser/ux-storefront.mjs`.

**Interfaces:** Consumes Tasks 1–2; `FeedbackLink` preserves Next Link props and modifier/new-tab behavior. Provider/header-isolating checkout anchors stay hard navigations. Cart commands retain their current signatures until Task 6 adds new methods.

- [ ] Add held-response UI tests for featured/clothing/category/search loading, filter/sort/page updates, add-to-cart acknowledgement, cart hydration versus true empty, retry, superseded results and mobile/keyboard press states. Include 320/768/1440 widths and reduced motion.
- [ ] Run `node tests/browser/ux-storefront.mjs` before edits, recording missing feedback/skeleton behavior. Add/adjust focused Jest assertions when server/component markup contracts change.
- [ ] Implement shape-matched card/detail/cart skeletons and first-load route fallbacks. Move root session await into an async `SessionShell` under Suspense with a safe skeleton fallback; retain all session/cart providers and authorization behavior. Shared navigation stays interactive after its shell resolves. Preserve current products during refetch with an honest updating indication; discard stale response ownership. Apply scoped button/link feedback throughout these feature files. Resolve the nested brands main and small view-toggle targets.
- [ ] Run new browser coverage plus existing home/category/clothing/branding/menu browser runners and affected cart/store Jest tests. Verify no fake empty cart, no duplicate add, no layout shift caused by indicator insertion and no disabled prefetch just to force a loader.
- [ ] Report and commit only this task's changes.

### Task 4: Authentication, account and contact feedback and truthful saves

**Files:** Modify all forms under `src/components/auth/login`, `auth/register`, `auth/2fa`, shared `auth/ui/authStyles.tsx`, `src/components/account/AccountProfile.tsx`, `src/components/contact/ContactForm.tsx`; create `src/components/account/AccountSkeletons.tsx`, `src/components/auth/ui/AuthSkeleton.tsx`; add `src/app/auth/loading.tsx`, `src/app/(store)/account/loading.tsx`; create `tests/browser/ux-account-auth.mjs` and `tests/unit/account-action-results.test.ts` if factoring an address-result helper.

**Interfaces:** Consumes Task 1 request/action primitives. Account default update returns an explicit success/failure result; source owns its typed result helper locally, rather than silently returning void. No auth/security policy is changed.

- [ ] Write failing browser cases for account first load and 503 versus confirmed empty, address-save success/default-save 503, retrying only default selection, pending duplicate submissions, retained inputs on failure, named address/password/auth fields and small visibility toggles. Contact sends are intercepted in-browser; email/code flows use controlled responses, never deliver mail.
- [ ] Run `node tests/browser/ux-account-auth.mjs` and focused existing authentication/account tests to establish RED for the new cases.
- [ ] Migrate all listed actions to consistent press/pending/result treatment: password/email code/register/resend/reset/TOTP/copy/sign-out/address/default/password/contact. Add persistent associated labels, described errors and useful focus. Keep initial account loads separate from current data refreshes; use skeletons for addresses/orders/profile and explicit retry/sign-in notices for failures. Report the exact partial-save outcome and preserve saved address/draft state.
- [ ] Run new browser checks, relevant Jest tests and typecheck; assert touch and keyboard paths share admission guards, busy labels remain visible, duplicate action prevention does not disable unrelated work, and reduced motion produces static placeholders.
- [ ] Report and commit this task's changes.

### Task 5: Admin list, form and operational feedback/loading coverage

**Files:** Modify `src/app/admin/dashboard/page.tsx`, `inventory/client.tsx`, `inventory/create/client.tsx`, `inventory/[id]/edit/client.tsx`, `featured-items/client.tsx`, `transactions/page.tsx`, `transactions/[orderId]/page.tsx`, `shipping/page.tsx`, `pickups/page.tsx`, `tags/page.tsx`, `settings/shipping/page.tsx`, `profile/page.tsx`, `src/components/admin/settings/StoreAccessSettingsPanel.tsx`, `src/components/admin/shipping/CreateLabelForm.tsx`, `OriginModal.tsx`, `src/components/inventory/ProductForm.tsx`; create `src/components/admin/AdminSkeletons.tsx`, admin group/leaf loading files, `tests/browser/ux-admin.mjs` and focused unit tests as needed.

**Interfaces:** Consumes Tasks 1–2; no third-party charge/email/order action is executed against real providers. Existing HTTP/API/business semantics remain authoritative. Feature-owned helper extraction is allowed when it reduces an already large touched component.

- [ ] Add held/failed-response cases for dashboard/list/count reads, inventory/featured/tag operations, product save/upload/parse, shipping rates and settings, pickup completion and transaction email-action previews using browser-only fixtures. Assert loading metrics are not $0, HTTP 401/429/503/network errors are not zero sales, retries preserve data and all newly active commands acknowledge input.
- [ ] Run `node tests/browser/ux-admin.mjs` and focused affected Jest tests to record RED.
- [ ] Add metrics/table/list/detail/form skeletons and appropriate route fallbacks. Keep current data while updating and make failures recoverable. Apply shared pending controls and single-admission guards to every listed mutating command, including row actions, reorder/save/export/upload/restore/tag modes. Associate product, variant, shipping and access-setting labels/errors with unique control IDs. Resolve image-required copy according to the accepted optional rule. Preserve actual upload work counts and never invent percentages.
- [ ] Run new browser coverage plus existing admin transaction/contrast/shipping modal browser suites, relevant unit tests and typecheck. Check native-modal select behavior, row keyboard access, fixed mobile form actions and preserved drafts. Provider-facing actions remain intercepted/controlled in tests.
- [ ] Report and commit the admin work with a per-feature command/region coverage list, including any concrete remaining gap.

### Task 6: Order-bound cart snapshots and trusted receipt consumption

**Files:** Modify `src/types/domain/cart.ts`, `src/types/domain/checkout.ts`, `src/services/cart-service.ts`, `src/components/cart/CartProvider.tsx`, `src/services/orders-service.ts`, `src/repositories/orders-repo.ts` and `src/app/checkout/success/page.tsx`; create `src/lib/cart/checkout-snapshot.ts`, `tests/unit/cart-receipt-consumption.test.ts`, `tests/unit/orders-status-purchase-snapshot.test.ts`, `tests/browser/ux-receipt-authority.mjs`; adapt direct storage-shape tests/harnesses where the intentional migration changes them.

**Interfaces:** Produces cart-context snapshot methods and optional trusted order fields defined above for Task 7. Existing cart APIs continue to work; legacy cart arrays remain readable. This is client basket correctness and an authorized read DTO extension, not a new provider/financial state machine or migration.

- [ ] Write RED cases for unauthorized/pending/failed/review receipts, forged cached status, replay, later quantity increases, removed-and-readded line identity, guest/account transitions, stale validation responses, cross-tab writes and denied/failed storage. A receipt without a locally bound matching checkout snapshot or trusted purchased items must preserve the basket.
- [ ] Run focused Jest tests and `node tests/browser/ux-receipt-authority.mjs`, recording the original cart clearing/false confirmation behavior.
- [ ] Give cart lines stable lineage and cart writes a revision/owner guard. Bind the original pre-await checkout snapshot to its returned order ID. Consume only quantities bounded by both that snapshot and server-authoritative purchased items; preserve newer lineages/identity/unrelated lines. Store replay protection and cart result atomically in one versioned storage write; fail conservatively without consuming if persistence fails. Discard validation responses for another revision/identity and observe relevant cross-tab storage changes. Add an authorized purchased-item repository read to both authenticated/token success paths without exposing items before authorization. Remove URL/cache-based clearing and unverified confirmation copy from the receipt.
- [ ] Run focused tests plus cart/order service tests; browser checks must show no order read/unauthorized read causes no cart side effect, and cached data cannot establish payment authority. Verify legacy-array migration and existing cart entry points still work. Unbound historical receipts preserve shopping state by design.
- [ ] Report and commit with the exact envelope/lineage invariants and consumption evidence. Any collision with another checkout/cart branch is resolved by comparing reviewed code, not by merging an unreviewed branch.

### Task 7: Checkout progress, SDK recovery, totals and order loading

**Files:** Modify `src/components/checkout/CheckoutClient.tsx`, `SquarePaymentMethods.tsx`, `CheckoutPaymentPanel.tsx`, `CheckoutOrderSummary.tsx`, `CheckoutPaymentDialog.tsx` only as needed for continuity, `BillingAddressFields.tsx`, `CheckoutDeliverySection.tsx`, `CheckoutContactSection.tsx`, `src/app/checkout/success/page.tsx`, `processing/page.tsx`, `src/components/orders/OrderStatusView.tsx`, `src/lib/checkout/checkout-order-polling.ts` where needed; create `CheckoutSkeletons.tsx`, checkout/order-status loading files, `tests/browser/ux-checkout.mjs`; adapt existing checkout-success/progress harness expectations to trusted authority rather than forged cache success.

**Interfaces:** Consumes Tasks 1, 2, 6. Capture checkout snapshot before prepare awaits and bind it after a successful prepared order response. Use the existing serialized polling helper, 60-second deadline and explicit delayed/review/error/unauthorized outcomes; callbacks consume trusted response data only.

- [ ] Add RED cases for card SDK failure then successful explicit retry with values retained, quote loading/refetch and unavailable totals, guest/session/cart readiness, shipping/pickup change, provider challenge focus, deadline recovery, authorized confirmation consumption and no false success from URL/cache. Assert immediate pending feedback and one payment submission under duplicate input.
- [ ] Run `node tests/browser/ux-checkout.mjs`, receipt authority checks and relevant checkout Jest tests before implementation.
- [ ] Add checkout/summary/address/provider-field skeletons and clear regional busy/result states; keep fields/drafts while preparing or quoting. Add card retry that resets only failed SDK/card initialization, not a payment attempt. Preserve active wallets, exact-total guards, legal copy and provider focus. Replace the success page's independent interval with bounded serialized polling and an explicit safe recheck/support view. Keep one continuous appropriate progress surface across preparation, provider handoff, processing and trusted result, including a delayed result after 60 seconds. Do not show confirmed purchase based only on local cache.
- [ ] Run new browser checks plus all existing payment/checkout/shipping/progress browser runners and focused Jest tests. Update assertions only where the approved authority/recovery behavior supersedes an insecure previous expectation; never weaken assertions to manufacture a pass.
- [ ] Report and commit, separating mocked lifecycle results from native wallet/Sandbox completion not exercised.

### Task 8: Cross-flow acceptance, inventory completion and final integration fixes

**Files:** Create `tests/browser/ux-journeys.mjs`, `docs/operations/customer-admin-ux-implementation-2026-11-25.md`; modify `package.json` to expose `test:ux:browser` and only feature files for concrete gaps found in the approved inventory. Maintain `docs/operations/customer-admin-ux-coverage-2026-11-25.md` with every current route/async action/region and its evidence.

**Interfaces:** Consumes the completed shared/feature work. This task cannot mark shared primitives as whole-site coverage or use source scans as a replacement for behavior tests.

- [ ] Build the route/action/region matrix from current source, covering every group named in spec section 6. Classify initial, refresh, command, success, empty, error and cancellation/deadline states as applicable, with no fake loading on synchronous actions/static pages. Identify any still-unmigrated control or silent request and add a focused failing regression for each material gap.
- [ ] Run the corresponding regression before fixing each concrete gap; keep changes within the approved UX/loading/error scope.
- [ ] Complete those gaps, add one orchestrating `test:ux:browser` command for the new real-component harnesses, and document their synthetic boundaries. Verify button/link geometry, icon targets, contrast, associated labels, one main landmark, reduced motion and modal focus in representative customer/admin tasks at 320/390/768/1440 widths.
- [ ] Run all unit and integration suites, all old/new browser suites, typecheck, scoped ESLint, formatting and a Next build with development/local configuration. Inspect actual rendered local mobile/desktop pages with a temporary local customer/admin when useful; never send real messages or trigger provider charges. Remove all created fixtures/credentials/services, preserving existing data. Record test totals, warnings, screenshots, release/source identity and unverified native-device/provider/assistive-technology gates precisely.
- [ ] Self-review, report and commit. Controller then performs the required broad whole-branch review and its permitted fix wave, verifies the final tree, and leaves the branch/worktree reviewable. No push, merge or deployment is implied.

## Execution ruling and checkpoint

The user explicitly approved the expanded design and instructed planning **and implementation**. Proceed without another plan-approval or execution-method question. Use subagent-driven development with one bounded implementer at a time, a fresh task reviewer after each task, and one broad final review. This follows the recommended execution path and preserves the user's instruction to continue.

Baseline in this worktree: 113 unit suites / 543 tests passed; 3 integration suites / 21 tests passed. Existing test logs include pre-existing shipping-label/CSRF/bot logger noise. It is not introduced UX regression evidence. No product source was changed before this plan.

Self-review: all spec sections map to Tasks 1–8. Interfaces and shared-file dependencies are explicit above; preflight conflict/ruling details and progress live in this plan's `.superpowers/sdd` ledger. Finish all approved tasks; remaining staging/physical-device/provider gates must be disclosed, not represented as local proof.
