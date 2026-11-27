# Customer and admin UX coverage

This inventory follows the user-facing operation through its component, route and external boundary. “Local” means the real Next App Router and the loopback Supabase stack. Component runners render the production components in Chromium with a controlled router, network or payment SDK. Source-only rows have no independent browser result for that path. A screenshot records one settled view.

## Routes and async regions

| Route or boundary                                                                                       | Initial content and repeat reads                                                                                                                                                                                                               | Actions, completion, failures and supersession                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Root layout and proxy                                                                                   | Session refresh precedes routing. Suspense reserves the shell while the verified user and profile load. Guest, unavailable and authenticated are distinct. The verified snapshot replaces a superseded refresh.                                | Account retry reads again. The cart waits for identity before permitting edits. Expiry at the proxy returns an unavailable response. POST logout continues through site, CSRF and rate-limit checks, attempts remote revocation and expires this project's local auth cookies even on provider failure. A protected page requires both staff identity and the existing MFA/session checks. | server-session, proxy-session-deadline, admin-guard-deadline, store-session-shell, ux-account-auth, ux-local-journeys                       |
| Store layout and header                                                                                 | Navbar session, cart hydration, menu taxonomy, search and cart validation own separate indicators.                                                                                                                                             | Open/close menu, navigate panels, select category/brand/size, search/suggestions/results, cart, account/logout and footer links. Modified links keep native behavior. Escape returns focus. New search supersedes the prior query.                                                                                                                                                         | ux-overlays, ux-storefront, store-menu, ux-local-journeys                                                                                   |
| /                                                                                                       | Featured and clothing lists show regional skeletons, error recovery and confirmed empty states. Each merchandise photo retains its frame, loading placeholder and failure message independently of its product link.                           | Shop Now, category and merchandise links give press and navigation feedback. Slideshow motion and controls remain local.                                                                                                                                                                                                                                                                   | home-featured-items, home-clothing, home-categories, storefront-branding and ux-storefront, including held and failed photos in both rails. |
| /brands                                                                                                 | Server connection and cached taxonomy before the list. Store route fallback, empty collection or store error boundary.                                                                                                                         | Select a brand to query the catalog. Single main landmark supplied by layout.                                                                                                                                                                                                                                                                                                              | Real local brands landmark/heading. Held cold read and recovery in initial-route-read-deadlines.                                            |
| /store                                                                                                  | Metadata facet labels and product/filter/taxonomy data. First-page skeleton and bounded 15-second read. Query transitions retain the previous confirmed pane.                                                                                  | Filter groups, price, clear, sort, list/grid and pagination. Rapid updates compose against latest intent. Failed data returns retained results and explicit retry; a genuinely empty response shows empty copy. Product photos settle independently.                                                                                                                                       | ux-storefront and real local catalog journey                                                                                                |
| /store/[productId]                                                                                      | Product and metadata share the cache. Detail fallback reserves gallery, sizes, price and add control. Missing products reach not-found.                                                                                                        | Select image or size, expand returns, add item, retry cart. Gallery thumbnail/hero loads are independent of cart admission. Show confirmed cart addition only after storage acknowledges it.                                                                                                                                                                                               | ux-storefront, ux-receipt-authority                                                                                                         |
| /cart and drawer                                                                                        | Hydration, session, stock validation and estimates have separate states. Retain same-owner rows during a refresh.                                                                                                                              | Add/update/remove/clear, shipping estimate and hard checkout entry. Lock/write/storage failure retains basket and gives a recoverable message. Empty after successful hydration only.                                                                                                                                                                                                      | ux-storefront, ux-receipt-authority, checkout-ui                                                                                            |
| /contact                                                                                                | Static form at entry.                                                                                                                                                                                                                          | Submit, retain fields and distinguish confirmed delivery from unknown/failed submission. Native mail, social and map links leave the app.                                                                                                                                                                                                                                                  | ux-account-auth; mail intercepted                                                                                                           |
| /hours, /authenticity-guarantee                                                                         | Published information, opening hours, directions and guarantee text.                                                                                                                                                                           | Links use navigation/native destinations. No request starts when reading static copy.                                                                                                                                                                                                                                                                                                      | Source                                                                                                                                      |
| /privacy, /refunds, /shipping, /terms and /legal/privacy, /legal/refunds, /legal/shipping, /legal/terms | Published policy entries and aliases share policy content.                                                                                                                                                                                     | Follow policy and contact links. No page-specific async operation.                                                                                                                                                                                                                                                                                                                         | Source                                                                                                                                      |
| /auth/login, /auth/register                                                                             | Server checks existing user. Form, registration, verification and forgot-password steps have independent owners.                                                                                                                               | Password visibility and code entry are local. Password sign-in, OTP request/verify/resend, signup, verified email, recovery request/verify/update and logout retain input, prevent duplicate admissions and show failure/continuation. Resend cooldown has a real timer.                                                                                                                   | ux-account-auth, ux-storefront, auth unit suites; real local login and matching-owner reset                                                 |
| /auth/2fa/setup, /auth/2fa/challenge                                                                    | Enrollment/QR module, secret and challenge metadata load independently. Mobile manual setup does not require downloading QR markup.                                                                                                            | Generate setup data, copy key including clipboard denial/fallback, verify code/challenge, resend/retry, redirect and hand session to destination.                                                                                                                                                                                                                                          | ux-account-auth, ux-storefront; local administrator TOTP                                                                                    |
| /account                                                                                                | Server verifies session or shows recoverable unavailability. Profile, addresses and order history independently read, retain and retry.                                                                                                        | Change password, toggle visibility, add/remove address, set/clear default, recover a partial save by refreshing or retrying only the default. Uncertain writes require confirmation. Owner changes invalidate previous work.                                                                                                                                                               | ux-account-auth, account API units                                                                                                          |
| /order-status/[orderId]                                                                                 | Token-aware order read has a regional placeholder, then confirmed order, denied access or unavailable state.                                                                                                                                   | Retry existing order/read, follow support/tracking. No cart consumption from status.                                                                                                                                                                                                                                                                                                       | checkout-success, ux-receipt-authority; order API suites                                                                                    |
| /checkout/start, /checkout/cancel                                                                       | Start redirects to checkout. Cancel presents its result without waiting for a new payment.                                                                                                                                                     | Return to basket or store. Old cancel visits preserve newer attempts.                                                                                                                                                                                                                                                                                                                      | checkout-progress, checkout page suites, real cancel visit with a newer draft                                                               |
| /checkout                                                                                               | Server checks access then verified identity, shipping profile and provider configuration. Customer, quote, preparation, method availability and card/SDK initialization are distinct boundaries.                                               | Select fulfillment/address/method/billing; validate, accept or revise address; quote, prepare, tokenize, submit and reconcile the existing attempt. Drafts survive retry. A changed owner cannot continue private review. Unresolved or ambiguous payment never invites duplicate submission.                                                                                              | ux-checkout, checkout-ui, shipping-validation, payment-methods. Provider responses controlled                                               |
| /checkout/processing and /checkout/success                                                              | Order-specific polling, 60-second deadline, receipt details, authoritative evidence and independent cart cleanup. No success from local cache.                                                                                                 | Status retry/secure access, contact support and related links. Confirmed details close progress; delayed/review/denied stay actionable. Replacing the order ID resets view and cancels the previous poll.                                                                                                                                                                                  | checkout-progress, checkout-success, ux-checkout, ux-receipt-authority                                                                      |
| /locked, /too-many-requests                                                                             | Lock checks current settings and verified session. Countdown uses the configured unlock time. Rate-limit notice renders directly.                                                                                                              | Retry at unlock, navigate to available destinations. Browser view does not establish production admission limits.                                                                                                                                                                                                                                                                          | Source, site-lock-proxy                                                                                                                     |
| /admin, /admin/orders/[orderId], /admin/sales                                                           | Staff guard then redirect/alias to dashboard or transaction views.                                                                                                                                                                             | Target owns subsequent reads. Shared sidebar, disclosure, menu, profile and logout retain normal keyboard behavior.                                                                                                                                                                                                                                                                        | Source, ux-overlays, admin-button-contrast                                                                                                  |
| /admin/dashboard                                                                                        | Metrics and activity reads; skeleton on first load, confirmed zero only after a valid response.                                                                                                                                                | Refresh or retry. An unavailable metric/activity does not become zero.                                                                                                                                                                                                                                                                                                                     | ux-admin dashboard                                                                                                                          |
| /admin/inventory                                                                                        | Server filters and reads rows/counts. Repeat query retains rows while busy.                                                                                                                                                                    | Search/filter/page/select, navigate create/edit, archive/restore/delete, bulk commands, CSV export and recovery lookup. Empty results differ from unknown. Exact ID/SKU lookup includes archived products and sibling SKUs.                                                                                                                                                                | ux-admin, six actual local API reads and genuine authorized segment timeout/retry                                                           |
| /admin/inventory/create and /admin/inventory/[id]/edit                                                  | Server taxonomy and existing product; editor retains draft through title parsing, model/taxonomy refresh and failed save.                                                                                                                      | Brand/model overrides, sale/cost/stock, add/remove/select sizes, scheduling, file selection/previews/compression/upload/reorder/remove/primary, create/update/restore, unknown create lookup. Fields link validation to focused controls.                                                                                                                                                  | ux-admin, shipping/product unit suites, local create form at four widths and real create/edit timeout/retry                                 |
| /admin/featured-items                                                                                   | Initial read, retained existing featured list on lookup/refresh failure.                                                                                                                                                                       | Search/select product, add/remove, drag/keyboard reorder, confirm result then refresh.                                                                                                                                                                                                                                                                                                     | ux-admin                                                                                                                                    |
| /admin/tags                                                                                             | Independent brands, models, aliases, sizes and candidates populate tabs.                                                                                                                                                                       | Select tab, edit related taxonomy, add/edit/delete and accept/reject candidate. Keep draft and distinguish a confirmed command from failed refresh.                                                                                                                                                                                                                                        | ux-admin tag modes and confirmed tag/failed refresh                                                                                         |
| /admin/transactions and /admin/transactions/[orderId]                                                   | A page request retains the last authorized rows for the same staff owner, role and queue. Loading and failed reads identify the displayed page. Pagination remains mounted and preserves keyboard focus. Access denial clears rows and counts. | Row navigation, expand item/cost detail, preview/resend email, fulfillment/refund where available, refresh status. Unknown command or audit state stays unknown.                                                                                                                                                                                                                           | ux-admin controlled page hold, failure, focused Next and access denial. admin-transaction-detail covers detail navigation.                  |
| /admin/pickups and /admin/shipping                                                                      | The shared queue retains the confirmed page while the next page loads or fails within its authorized scope. Row mutations remain unavailable on a pending or failed list. A new owner, role or queue starts a fresh read.                      | Select tabs, expand order items, complete pickup; shipping rate/label creation, selection, tracking/support and operator recovery. Unknown label avoids duplicate purchase.                                                                                                                                                                                                                | ux-admin, admin-transaction-detail; controlled providers                                                                                    |
| /admin/settings/shipping                                                                                | Origin, package defaults and carriers.                                                                                                                                                                                                         | Open/close modal, change origin/package/carrier, validate/save, preserve draft on failure and refresh confirmed values.                                                                                                                                                                                                                                                                    | shipping-settings-modal, ux-admin, ux-overlays                                                                                              |
| /admin/settings/store-access and /admin/profile                                                         | Existing access settings or server-authorized user/profile.                                                                                                                                                                                    | Store/checkout settings fields, save/retry, read-only staff profile and sidebar navigation.                                                                                                                                                                                                                                                                                                | ux-admin, ux-account-auth; local remote settings untouched                                                                                  |
| Route errors and not-found                                                                              | Store, account, cart, catalog, checkout and admin errors expose route-specific recovery and support/navigation destinations. Root and store not-found handle missing pages.                                                                    | Each boundary uses the installed Next retry callback. The pending retry control hands progress to the destination loading surface while a fresh RSC read runs. Back/home/store links navigate. A missing page has no background request solely to show a loader.                                                                                                                           | ux-storefront six controlled retry callbacks plus two missing-page views. Real Next refetched an unavailable product at the same URL.       |

## Server and library read owners

| Owner                                                             | Awaited work and exit behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root proxy `refreshSession`, `checkSiteLock`, `protectAdminRoute` | Refresh the current auth cookie, read tenant/access settings, verify the existing staff session, profile and MFA level. Each named check has a 15-second overall budget. Site-lock policy retains its existing fail-open response to an immediate settings/schema error. An unresolved deadline returns 503 with retry guidance. Existing exemptions skip unnecessary settings reads. A confirmed lock still requires the applicable staff bypass.                                                                                                                                                                                                                                                         | site-lock-proxy, proxy-session-deadline, admin-guard-deadline, real-local auth and settings fault injection                                                                                          |
| `SessionShell`, account entry, auth entries and staff shell       | Root verification owns the initial server snapshot. Account and checkout use strict identity for private data. Legacy redirect-only helpers retain their existing fallback behavior. The admin layout owns role-dependent navigation and does not receive protected content on a failed staff guard.                                                                                                                                                                                                                                                                                                                                                                                                       | server-session unit suites, ux-account-auth and real local browser with held profile                                                                                                                 |
| Store, brand and product server entries                           | Store metadata and results read taxonomy, filter, product and pagination data. The catalog owns its result-transition deadline. Brands and product details use their own cached repository reads. The product page shares the result with its metadata and routes missing products to not-found. The lock page loads its own display settings after the proxy. Brands and the shared product metadata/detail read each have a 15-second budget including cache access. Expired cold queries cannot populate their cache with a late result. The lock and auth layout share a bounded tenant/settings read. Its expiry gives the locked page an explicit retry and keeps the authentication form available. | initial-route-read-deadlines covers held brands, metadata, detail, lock and auth. Real catalog/data failure plus a genuine Next segment retry and confirmed absence.                                 |
| Checkout access/data and order readers                            | Check tenant/store admission, verified session, shipping profile and SDK configuration before rendering checkout. Poll processing/success through the existing order status endpoint. Checkout reraises the framework's request-cookie prerender signal.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | checkout-page, checkout-page-data and polling units, controlled checkout browser, real empty checkout and auth outage                                                                                |
| Staff Server Components and server APIs                           | Resolve authorized staff profile and where applicable server-side inventory product/taxonomy and count data. Exact product recovery uses ID or the matched variant filter and a separate full sibling relation. Initial inventory list/count, create taxonomy and edit product/taxonomy/follow-on lookups share a single post-authorization deadline per action. The edit page returns not-found only from a confirmed absent product. Client list readers own their local refresh, empty, error and retry states.                                                                                                                                                                                         | Real six-response local PostgREST/API comparison. Real authorized list/create/edit held reads, pending retry and same-URL recovery. Initial-route deadline units include edit follow-on size lookup. |
| Feature-owned work outside JSX                                    | The checkout polling controller owns timers and response ownership. Square script loading and lifecycle helpers own script presence, attachment, cancellation and retry. The cart service owns storage, lock contention and persisted line identity. Measurement works behind consent and a lazy SDK boundary.                                                                                                                                                                                                                                                                                                                                                                                             | checkout-progress, checkout-success, ux-receipt-authority, payment-methods, ux-checkout and both measurement runners                                                                                 |

## Checkout and navigation recovery after final review

- Preparation and payment authorization bound both the POST headers and its response body to 15 seconds. Expiry leaves the current draft and attempt available for deliberate continuation. A late response cannot begin the next step.
- A dropped, stalled or unreadable payment reply opens the prepared order’s processing page. A status recheck sends no new payment. The controlled browser verifies one payment POST, retains the attempt while unresolved and clears only that matching attempt after paid evidence. An explicit decline keeps its correction path.
- Controlled Square startup verifies Apple Pay creation and Afterpay/Cash App attachment can expire, retry on a new instance and dispose retired resources. Card startup, the native approval handoff and issuer UI keep their existing ownership. Guest verification can retry failed or stalled script/widget initialization. An interactive challenge can outlast startup and only a current widget token enables payment.
- The homepage CTA, rate-limit and checkout recovery destinations use link-local feedback. Checkout entry uses a native document request and the staff drawer remains open on modified navigation. These browser checks use controlled routing and SDKs. Provider settlement and real device approvals require separate evidence.

## Residual review coverage

- The Shipping browser fixture opens a recipient form before a count returns 403. Captured callbacks attempt a rate request or label purchase after denial, and the test counts every matching browser fetch. Purchases submitted before denial retain their operator recovery record, including purchased-without-tracking evidence. Shipping and Pickups item-dialog cases cover private detail removal and preservation across a transient count failure.
- The cart test stops a held native checkout request through Chromium. The original cart remains usable, receives zero page-restoration events and clears its loading announcement after the feedback deadline.
- The guest checkout test omits the public verification key, fills the contact and name fields and checks the disabled payment button’s accessible description against the visible security notice. The fixture records zero payment requests. Configured challenge and retry paths retain separate coverage.

## Boundaries independent of fetch

- Regular product-card, detail and thumbnail image requests reserve geometry. An undecoded photo has a visual placeholder. A native error gives the photo a neutral unavailable state while the product remains usable. The browser controls image-fetch timing. The gallery test releases the held response explicitly. The gallery regression holds actual browser image loads and switches photos after failure. The logo, slideshow, QR, upload previews, payment marks and order thumbnails have separate owners in the source census.
- ProductForm owns file selection, previews of accepted upload URLs, the compression-library import, compression, upload and file-count outcomes. Its use of the compression package puts internal file reading behind the library boundary. The inventory CSV download creates and revokes an object URL. The application has no direct FileReader call. The controlled upload regression covers failure and held save prevention. Camera/library selection, compression throughput and native mobile memory limits need device checks.
- Clipboard permission and fallback selection belong to EnrollmentForm. QRDisplay imports on demand. Payment SDK loading, attach/detach, native wallets and issuer challenges belong to SquarePaymentMethods and its lifecycle helpers. Browser fixtures can hold/fail methods and verify app-owned controls. A successful native wallet or issuer round trip requires its device and provider.
- Consent-gated analytics and optional script imports are background operations. They never delay a customer action. Measurement trigger and SDK boundary runners inspect controlled events, without measuring a production analytics project.
- Web Locks, session/local storage, order snapshot binding and confirmed consumption are asynchronous from the caller's perspective. The two-tab cart runner checks revision changes independently from storage errors. Native interoperability and long-lived old clients remain separate from these Chromium fixtures.

## Source index before the final review fixes

At implementation base `4324dee7`, the App Router tree contained 45 page files, 8 layouts, 22 route loading files, 6 segment error files and 2 not-found files. An AST pass over app UI, components and contexts found 488 control or navigation sites, 198 await sites and 44 native asset/SDK sites across 120 source owners. Repeated JSX sites can render multiple controls. API handler internals are outside this UI count. The route matrix above identifies the evidence boundary for each group. The line references describe that base. The route rows and final-review section above describe the subsequent repairs.

### src/app/(store)/account/error.tsx

- **Controls and navigation** — RouteRetryButton RouteRetryButton L36 · Link /auth/login L40

### src/app/(store)/account/page.tsx

- **Controls and navigation** — FeedbackLink /auth/login?next=%2Faccount L49 · FeedbackLink /auth/register?next=%2Faccount L55
- **Await owners** — AccountPage → readServerSession L25

### src/app/(store)/authenticity-guarantee/page.tsx

- **Controls and navigation** — a /refunds L44 · a mailto:${SUPPORT_EMAIL} L52

### src/app/(store)/brands/page.tsx

- **Controls and navigation** — FeedbackLink buildBrandHref(brand.id) L98
- **Await owners** — listBrandsCached → repository.listBrands L24 · BrandsPage → connection L59 · BrandsPage → listBrandsCached L60

### src/app/(store)/cart/error.tsx

- **Controls and navigation** — RouteRetryButton RouteRetryButton L31 · Link /store L35

### src/app/(store)/cart/page.tsx

- **Controls and navigation** — FeedbackLink /store L54 · FeedbackLink /store/${item.productId} L81 · FeedbackLink /store/${item.productId} L96 · ActionButton Decrease quantity for ${item.titleDisplay} L117 · ActionButton Increase quantity for ${item.titleDisplay} L135 · ActionButton Remove ${item.titleDisplay} from cart L152 · a !isReady // writePending ? undefined : "/checkout" L180 · FeedbackLink /store L188
- **Native assets and SDK calls** — Image item.imageUrl L85

### src/app/(store)/contact/page.tsx

- **Controls and navigation** — a mailto:${SUPPORT_EMAIL} L25

### src/app/(store)/error.tsx

- **Controls and navigation** — RouteRetryButton RouteRetryButton L48 · Link / L53

### src/app/(store)/hours/page.tsx

- **Controls and navigation** — a mailto:${SUPPORT_EMAIL} L63 · a INSTAGRAM_URL L66 · Link /contact L74

### src/app/(store)/legal/terms/page.tsx

- **Controls and navigation** — a /privacy L38 · a /refunds L92 · a /refunds L161

### src/app/(store)/not-found.tsx

- **Controls and navigation** — Link / L31 · Link /store L38

### src/app/(store)/order-status/[orderId]/page.tsx

- **Controls and navigation** — Link / L73
- **Await owners** — StatusRead → fetch L23

### src/app/(store)/page.tsx

- **Controls and navigation** — Link /store L38
- **Native assets and SDK calls** — Image /images/hero.jpg L15

### src/app/(store)/store/[productId]/page.tsx

- **Await owners** — getCachedProduct → repo.getById L22 · generateMetadata → params L37 · generateMetadata → getCachedProduct L56 · ProductDetailPage → params L100 · ProductDetailPage → getCachedProduct L110

### src/app/(store)/store/error.tsx

- **Controls and navigation** — RouteRetryButton RouteRetryButton L31 · Link /store L35

### src/app/(store)/store/page.tsx

- **Controls and navigation** — FeedbackLink / L254 · FeedbackLink /store L258
- **Await owners** — withStoreReadDeadline → Promise.race L65 · loadStoreData → Promise.all L75 · loadStoreData → service.listProducts L84 · generateMetadata → searchParams L95 · generateMetadata → withStoreReadDeadline L101 · StorePage → searchParams L150 · StorePage → withStoreReadDeadline L200

### src/app/(store)/too-many-requests/page.tsx

- **Controls and navigation** — Link / L45 · button Retry L52

### src/app/admin/dashboard/page.tsx

- **Controls and navigation** — Link /admin/inventory/create L76 · Link /admin/transactions L117 · Link href L176
- **Await owners** — loadDashboard → Promise.all L25

### src/app/admin/error.tsx

- **Controls and navigation** — RouteRetryButton RouteRetryButton L31 · Link /admin/dashboard L35

### src/app/admin/featured-items/client.tsx

- **Controls and navigation** — AdminSearchField (value) => { setSearchQuery(value); } L238 · button () => void run("Adding featured item…", () => addFeaturedItem( L260 · Link / L320 · button Move ${item.product.name} up L367 · button Move ${item.product.name} down L380 · button () => void run("Removing featured item…", () => removeFeatured L431
- **Await owners** — loadFeatured → fetchJsonWithDeadline L55 · FeaturedItemsManager → fetchJsonWithDeadline L78 · run → operation L100 · addFeaturedItem → adminCommand L107 · removeFeaturedItem → adminCommand L135 · saveOrder → adminCommand L184
- **Native assets and SDK calls** — Image primaryImage L270 · Image primaryImage L404

### src/app/admin/inventory/[id]/edit/actions.ts

- **Await owners** — getEditFormInitialData → Promise.all L14 · getEditFormInitialData → taxonomyRepo.getBrandById L29 · getEditFormInitialData → taxonomyRepo.getModelById L34 · getEditFormInitialData → taxonomyRepo.getSizeById L45

### src/app/admin/inventory/[id]/edit/client.tsx

- **Controls and navigation** — ActionButton Restoring… L103 · button Back to Inventory L118 · ProductForm handleSubmit L131
- **Await owners** — handleRestore → adminCommand L41 · handleSubmit → adminCommand L59

### src/app/admin/inventory/[id]/edit/page.tsx

- **Await owners** — EditProductPage → props.params L16 · EditProductPage → getEditFormInitialData L20

### src/app/admin/inventory/actions.ts

- **Await owners** — getInventoryProducts → service.listProducts L33

### src/app/admin/inventory/client.tsx

- **Controls and navigation** — ActionButton Export L209 · Link /admin/inventory/create L217 · form (event) => { event.preventDefault(); navigate(); } L230 · AdminSearchField setQuery L238 · FilterSelect (value) => setCategory(value as Category / "all") L244 · FilterSelect (value) => setCondition(value as Condition / "all") L250 · FilterSelect (value) => setStockStatus(value as StockStatus) L256 · button Apply L262 · ActionButton Checking… L272 · Link /admin/inventory/${product.id}/edit L353 · button Restore product L360 · button Archive product L375 · button Delete product L390 · button Previous L424 · button Next L432 · select (event) => onChange(event.target.value) L469
- **Await owners** — checkDeletedProduct → findInventoryProduct L96 · runAction → adminCommand L124 · runAction → checkDeletedProduct L137 · runAction → checkDeletedProduct L151 · exportInventory → withRequestDeadline L178 · exportInventory → fetch L179 · exportInventory → response.blob L183
- **Native assets and SDK calls** — URL.createObjectURL L190 · Image primaryImage.url L323

### src/app/admin/inventory/create/actions.ts

- **Await owners** — getFormInitialData → Promise.all L12

### src/app/admin/inventory/create/client.tsx

- **Controls and navigation** — ProductForm handleSubmit L84
- **Await owners** — checkProduct → findInventoryProduct L32 · handleSubmit → L47 · handleSubmit → adminCommand L49

### src/app/admin/inventory/create/page.tsx

- **Await owners** — CreateProductPage → getFormInitialData L10

### src/app/admin/inventory/find-inventory-product.ts

- **Await owners** — findInventoryProduct → readJsonResponse L11 · findInventoryProduct → fetch L12

### src/app/admin/inventory/initial-read.ts

- **Await owners** — readInventoryData → requireAdmin L16 · readInventoryData → createSupabaseServerClient L18 · readInventoryData → ensureTenantId L20

### src/app/admin/inventory/page.tsx

- **Await owners** — InventoryPage → searchParams L21 · InventoryPage → getInventoryProducts L33

### src/app/admin/layout.tsx

- **Await owners** — AdminLayout → requireAdmin L7

### src/app/admin/pickups/page.tsx

- **Controls and navigation** — button Previous L281 · button 1 L296 · button () => setPageByTab((prev) => ({ ...prev, [activeTab]: p })) L307 · button () => setPageByTab((prev) => ({ ...prev, [activeTab]: totalPag L323 · button Next L332 · button () => { setActiveTab(tab.key); setPageByTab((prev) => ({ ...pr L392 · AdminSearchField setSearchQuery L418 · tr () => toggleOrderExpansion(order.id) L498 · button Details for order ${order.id} L518 · button (event) => { event.stopPropagation(); toggleOrderItems(order.i L549 · button (event) => { event.stopPropagation(); toggleOrderDetails(order L564 · input Mark order ${order.id} picked up L582 · div (event) => { event.stopPropagation(); openItemDetails(item, ev L610 · input Mark order ${order.id} picked up L756 · div (event) => openItemDetails(item, event.currentTarget) L788 · button View more details L835
- **Await owners** — handleMarkPickedUp → adminCommand L237
- **Native assets and SDK calls** — Image imageUrl L632 · Image getPrimaryImage(item) L803

### src/app/admin/settings/shipping/page.tsx

- **Controls and navigation** — button Edit origin L515 · button () => { void carriersAction.run(saveCarriers); } L544 · button Edit L600 · button Close L635 · input ${id}-lengthInput L658 · input ${id}-widthInput L675 · input ${id}-heightInput L692 · input ${id}-weightInput L713 · input ${id}-shippingCostInput L730 · button Cancel L755 · button () => { void defaultsAction.run(saveDefaults); } L763 · button Close L797 · input ${id}-name L815 · input ${id}-company L837 · input ${id}-phone L864 · input ${id}-line1 L886 · input ${id}-line2 L908 · input ${id}-city L930 · input ${id}-state L952 · input ${id}-postal_code L977 · input ${id}-country L1004 · button Cancel L1040 · button () => { void originAction.run(saveOrigin); } L1048
- **Await owners** — loadShippingSettings → Promise.all L99 · saveDefaults → adminCommand L374 · saveOrigin → adminCommand L412 · saveCarriers → adminCommand L445

### src/app/admin/shipping/page.tsx

- **Controls and navigation** — button Previous L487 · button 1 L502 · button () => setPageByTab((prev) => ({ ...prev, [activeTab]: page })) L513 · button () => setPageByTab((prev) => ({ ...prev, [activeTab]: totalPag L529 · button Next L538 · button Create label L572 · button (event) => { event.stopPropagation(); setModalInvoker(event.cu L586 · tr () => toggleOrderExpansion(order.id) L605 · button Details for order ${order.id} L622 · a trackingUrl L650 · button Print Label L671 · button (event) => { event.stopPropagation(); toggleItems(order.id); } L686 · button (event) => { event.stopPropagation(); toggleDetails(order.id); L699 · div (event) => { event.stopPropagation(); openItemDetails(item, ev L728 · a trackingUrl L850 · button Print label L871 · div (event) => openItemDetails(item, event.currentTarget) L902 · button View more details L943 · button () => setActiveTab(tab.key) L1012 · button Change origin address L1040 · ConfirmDialog ConfirmDialog L1148 · OriginModal handleOriginChange L1165
- **Await owners** — loadSetup → Promise.all L262 · handleMarkShipped → adminCommand L363 · handleSaveOrigin → adminCommand L426
- **Native assets and SDK calls** — Image imageUrl L750 · Image imageUrl L915

### src/app/admin/tags/page.tsx

- **Controls and navigation** — button () => setActiveTab(tab.id) L180 · input New tag label L198 · select Brand L207 · select Alias type L226 · select Alias target L239 · select Size type L258 · ActionButton Add L273 · button Reject L347 · button Accept L354 · button onToggle L389
- **Await owners** — loadTags → Promise.all L29 · run → operation L86 · post → adminCommand L94 · patch → adminCommand L105 · addCurrent → post L117 · addCurrent → post L119 · addCurrent → post L121 · addCurrent → post L128 · acceptCandidate → post L143 · rejectCandidate → adminCommand L149

### src/app/admin/transactions/[orderId]/page.tsx

- **Controls and navigation** — button Back to Transactions L427 · button (event) => openItemModal(item, event.currentTarget) L543 · a order.label_url L732 · button Check email log L803 · button Check email log L875 · button View L908 · ActionButton () => { void command.run(() => handleResendEmail(emailType, la L921 · button Close email preview L1032 · input (e) => setChecked(e.target.checked) L1081 · button Resolve email check L1088
- **Await owners** — handleResendEmail → adminCommand L396
- **Native assets and SDK calls** — Image imageUrl L550

### src/app/admin/transactions/page.tsx

- **Controls and navigation** — button Previous L249 · button 1 L258 · button () => setPage(p) L268 · button () => setPage(totalPages) L279 · button Next L287 · button () => { setActiveTab(tab.key); setPage(1); } L311 · AdminSearchField setSearchQuery L339 · tr View transaction ${order.id} L396

### src/app/auth/layout.tsx

- **Await owners** — AuthLayout → getStoreAccessSettings L25

### src/app/auth/login/page.tsx

- **Await owners** — LoginPage → createSupabaseServerClient L15 · LoginPage → supabase.auth.getUser L18

### src/app/auth/register/page.tsx

- **Await owners** — RegisterPage → createSupabaseServerClient L15 · RegisterPage → supabase.auth.getUser L18

### src/app/checkout/cancel/page.tsx

- **Controls and navigation** — button Return to Cart L23 · button Continue Shopping L29

### src/app/checkout/error.tsx

- **Controls and navigation** — RouteRetryButton RouteRetryButton L33 · Link /cart L37

### src/app/checkout/page.tsx

- **Await owners** — CheckoutPage → loadCheckoutPageAccess L10 · CheckoutPage → loadCheckoutPageData L14

### src/app/checkout/processing/page.tsx

- **Controls and navigation** — button Check order status L84 · a /contact L96

### src/app/checkout/success/page.tsx

- **Controls and navigation** — button Check again L66 · a /contact L70 · button Continue shopping L73 · button Retry cart update L108 · a INSTAGRAM_URL L228 · button Go to Account L243 · button Continue Shopping L250

### src/app/locked/page.tsx

- **Controls and navigation** — a /locked?next=${encodeURIComponent(next)} L48 · Link /auth/login?next=${encodeURIComponent(next)} L92
- **Await owners** — LockedPage → props.searchParams L34 · LockedPage → getServerSession L36 · LockedPage → getStoreAccessSettings L42
- **Native assets and SDK calls** — Image /images/logo.png L81 · Image /images/hero.jpg L101

### src/components/account/AccountProfile.tsx

- **Controls and navigation** — a #addresses L768 · a #orders L771 · a #security L774 · ActionButton Signing out… L779 · ActionButton Clearing default… L852 · ActionButton Removing… L911 · ActionButton Setting default… L930 · ActionButton Checking saved addresses… L953 · ActionButton Retrying default update… L974 · form handleSaveAddress L994 · input name L1013 · input phone L1033 · input line1 L1053 · input line2 L1074 · input city L1091 · input state L1112 · input postal_code L1133 · input country L1157 · input (event) => setSetAsDefault(event.target.checked) L1174 · ActionButton Saving address… L1184 · a trackingUrl L1262 · form handleChangePassword L1291 · input password L1297 · ActionButton newPasswordVisible ? "Hide password" : "Show password" L1313 · input confirm-password L1338 · ActionButton confirmPasswordVisible ? "Hide password" : "Show password" L1354 · ActionButton Changing password… L1372 · ActionButton Signing out… L1389
- **Await owners** — updateDefault → postAccountJson L383 · runAddressAction → work L439 · handleAddressCheck → addressResource.load L457 · handleDefault → updateDefault L502 · handleChangePassword → postAccountJson L552 · handleSaveAddress → postAccountJson L590 · handleSaveAddress → updateDefault L636 · handleDeleteAddress → fetchAccountJson L663 · handleDeleteAddress → updateDefault L686 · handleLogout → withRequestDeadline L730

### src/components/admin/AdminPage.tsx

- **Controls and navigation** — Link backHref L49

### src/components/admin/AdminSearchField.tsx

- **Controls and navigation** — input label L37 · button Clear ${label.toLowerCase()} L49

### src/components/admin/AdminSidebar.tsx

- **Controls and navigation** — Link Solesneakers storefront L121 · Link item.href L145 · button () => setOpenGroups((current) => ({ ...current, [item.key]: !c L165 · Link child.href L187 · Link /admin/profile L210 · Link / L243 · button Open admin menu L256 · button Close admin menu L277

### src/components/admin/admin-command.ts

- **Await owners** — adminCommand → fetch L5 · adminCommand → response.json L6

### src/components/admin/orders/OrderItemDetailsModal.tsx

- **Controls and navigation** — button Close item details L236 · button () => setSelectedImageIndex(idx) L266
- **Native assets and SDK calls** — Image selectedImage L252 · Image img.url // "" L275

### src/components/admin/settings/StoreAccessSettingsPanel.tsx

- **Controls and navigation** — input (event) => setSiteLockEnabled(event.target.checked) L118 · input ${id}-siteUnlockAt L135 · input (event) => setCheckoutLockEnabled(event.target.checked) L155 · textarea ${id}-checkoutLockMessage L172 · ActionButton Saving… L187
- **Await owners** — load → fetchJsonWithDeadline L35 · save → adminCommand L72

### src/components/admin/shipping/CarrierSelector.tsx

- **Controls and navigation** — button () => onToggle(carrier.key) L23

### src/components/admin/shipping/CreateLabelForm.tsx

- **Controls and navigation** — button Close shipping label editor L493 · input ${id}-name L543 · input ${id}-phone L555 · input ${id}-line1 L579 · input ${id}-line2 L602 · input ${id}-city L615 · input ${id}-state L636 · input ${id}-postal_code L664 · input ${id}-country L691 · input ${id}-weightInput L727 · input ${id}-lengthInput L744 · input ${id}-widthInput L761 · input ${id}-heightInput L778 · button () => { void ratesAction.run(getRates); } L790 · input rate L875 · button () => { void buyAction.run(purchase); } L906
- **Await owners** — getRates → adminCommand L334 · purchase → adminCommand L404

### src/components/admin/shipping/LabelRecovery.tsx

- **Controls and navigation** — ActionButton Checking… L66 · input (e) => setVerified(e.target.checked) L87 · button Resolve label check L94
- **Await owners** — check → fetchJsonWithDeadline L43

### src/components/admin/shipping/OriginModal.tsx

- **Controls and navigation** — button Close L60 · input ${id}-name L78 · input ${id}-company L100 · input ${id}-phone L122 · input ${id}-line1 L144 · input ${id}-line2 L166 · input ${id}-city L188 · input ${id}-state L210 · input ${id}-postal_code L232 · input ${id}-country L259 · button Cancel L288 · button onSave L296

### src/components/admin/useAdminOrderQueue.ts

- **Await owners** — useAdminOrderQueue → fetchJsonWithDeadline L18 · useAdminOrderQueue → Promise.all L32 · useAdminOrderQueue → fetchJsonWithDeadline L34

### src/components/analytics/CloudflareWebAnalytics.tsx

- **Native assets and SDK calls** — script BEACON_URL L9

### src/components/auth/2fa/ChallengeForm.tsx

- **Controls and navigation** — form handleVerify L53 · SixDigitCodeField mfa-code L54 · ActionButton Verifying… L64
- **Await owners** — handleVerify → mfaVerifyChallenge L31

### src/components/auth/2fa/EnrollmentForm.tsx

- **Controls and navigation** — form verify L173 · input manual-setup-key L210 · ActionButton Copying key… L221 · ActionButton isMobile ? "Generating setup key…" : "Generating QR code…" L245 · SixDigitCodeField enroll-code L258 · ActionButton Verifying… L271 · FeedbackLink /auth/login L282
- **Await owners** — copyManualKey → navigator.clipboard.writeText L38 · generate → mfaEnroll L99 · verify → mfaVerifyEnrollment L126 · copy → copyManualKey L146
- **Native assets and SDK calls** — import L19 · navigator.clipboard.writeText L38

### src/components/auth/2fa/QRDisplay.tsx

- **Native assets and SDK calls** — img qrCode L12

### src/components/auth/login/EmailCodeFlow.tsx

- **Controls and navigation** — form handleSubmit L143 · input email L153 · SplitCodeInputWithResend ${prefix}-code L169 · ActionButton stage === "request" ? sendButtonSendingLabel : verifyButtonSu L186 · FeedbackLink backHref L201 · ActionButton onBack L205
- **Await owners** — handleSubmit → onRequestCode L99 · handleSubmit → onVerifyCode L110 · handleResend → effectiveResend L130

### src/components/auth/login/ForgotPasswordForm.tsx

- **Controls and navigation** — FeedbackLink /auth/login L167 · form handleSubmit L177 · input email L192 · SplitCodeInputWithResend reset-code L213 · PasswordField new-password L226 · PasswordField confirm-password L235 · ActionButton step === "request" ? "Sending code…" : "Updating password…" L248 · ActionButton Back to sign in L259
- **Await owners** — requestCode → postAuthJson L46 · handleSubmit → requestCode L65 · handleSubmit → postAuthJson L79 · handleSubmit → postAuthJson L108 · handleResend → requestCode L143

### src/components/auth/login/OtpLoginForm.tsx

- **Await owners** — requestOtp → postAuthJson L25 · verifyOtp → postAuthJson L34

### src/components/auth/login/PasswordField.tsx

- **Controls and navigation** — input name L43 · ActionButton visible ? "Hide password" : "Show password" L57

### src/components/auth/login/PasswordLoginForm.tsx

- **Controls and navigation** — form handleSubmit L84 · input email L93 · PasswordField password L106 · ActionButton Forgot your password? L117 · ActionButton Logging in… L127 · FeedbackLink /auth/register${nextUrl !== "/" ? ?next=${encodeURIComponent(n L139 · ActionButton Sign in with email code instead L146
- **Await owners** — handleSubmit → postAuthJson L50

### src/components/auth/login/SplitCodeInputWithResend.tsx

- **Controls and navigation** — SixDigitCodeField id L38 · ActionButton Resending code… L62

### src/components/auth/login/VerifyEmailForm.tsx

- **Await owners** — resendVerification → postAuthJson L38 · verifyCode → postAuthJson L47

### src/components/auth/register/RegisterForm.tsx

- **Controls and navigation** — form handleSubmit L70 · input email L82 · PasswordField password L94 · PasswordField confirmPassword L104 · ActionButton Creating account… L117 · FeedbackLink /terms L128 · FeedbackLink /privacy L132 · FeedbackLink /auth/login${nextUrl !== "/" ? ?next=${encodeURIComponent(next L139
- **Await owners** — handleSubmit → postAuthJson L47

### src/components/auth/ui/AuthShell.tsx

- **Controls and navigation** — Link Return to the locked storefront L24
- **Native assets and SDK calls** — Image /images/logo.png L25

### src/components/auth/ui/SixDigitCodeField.tsx

- **Controls and navigation** — input id L40

### src/components/cart/CartDrawer.tsx

- **Controls and navigation** — ActionButton Close cart L75 · FeedbackLink /store L94 · FeedbackLink /store/${item.productId} L117 · FeedbackLink /store/${item.productId} L133 · ActionButton Decrease quantity for ${item.titleDisplay} L158 · ActionButton Increase quantity for ${item.titleDisplay} L176 · ActionButton Remove ${item.titleDisplay} from cart L193 · a !isReady // writePending ? undefined : "/checkout" L214 · FeedbackLink /store L222 · FeedbackLink /cart L229
- **Native assets and SDK calls** — Image item.imageUrl L122

### src/components/cart/CartFeedback.tsx

- **Controls and navigation** — button Try again L16

### src/components/cart/CartProvider.tsx

- **Await owners** — CartProvider → withRequestDeadline L127 · CartProvider → fetch L128 · CartProvider → cart.setCart L148 · CartProvider → cart.hydrate L174 · write → operation L241 · CartProvider → cart.consumeConfirmedOrder L267 · CartProvider → write L297 · CartProvider → cart.bindCheckoutSnapshot L323

### src/components/checkout/BillingAddressFields.tsx

- **Controls and navigation** — select (event) => onChange("country", event.target.value) L45 · input Billing first name L62 · input Billing last name L75 · input Billing address L91 · input Billing apartment, suite, etc. L109 · input Billing city L122 · select Billing state L143 · input Billing ZIP code L168 · input Billing phone L185

### src/components/checkout/CheckoutAddressReview.tsx

- **Controls and navigation** — form (event) => { event.preventDefault(); const data = new FormData L20 · input field L48 · button Save and continue L62 · button Accept suggested address L81 · button Continue with address I entered L96

### src/components/checkout/CheckoutClient.tsx

- **Controls and navigation** — button Retry checkout L466 · a /cart L470 · a /checkout L481 · Link /store L498
- **Await owners** — requestCheckoutQuote → fetch L72 · requestCheckoutQuote → response.json L78 · quoteWalletShippingDestination → requestCheckoutQuote L293 · resolveWalletShippingContact → requestCheckoutQuote L309 · prepare → fetch L372 · prepare → response.json L392 · prepare → bindCheckoutSnapshot L435

### src/components/checkout/CheckoutContactSection.tsx

- **Controls and navigation** — Link /auth/login?next=%2Fcheckout L23 · input Email L33

### src/components/checkout/CheckoutDeliverySection.tsx

- **Controls and navigation** — button () => { previousHeight.current = fields.current?.getBoundingCl L71 · select Country/Region L102 · input First name L122 · input Last name L137 · input Address L156 · input Apartment, suite, etc. (optional) L176 · input City L191 · select State L212 · input ZIP code L238 · input Phone L271

### src/components/checkout/CheckoutHeader.tsx

- **Controls and navigation** — Link Sole Sneakers home L16 · Link cartLabel L28
- **Native assets and SDK calls** — Image /images/logo.png L17

### src/components/checkout/CheckoutHelpTooltip.tsx

- **Controls and navigation** — button label L17

### src/components/checkout/CheckoutLegalNotice.tsx

- **Controls and navigation** — Link /terms L8 · Link /privacy L12

### src/components/checkout/CheckoutOrderSummary.tsx

- **Controls and navigation** — button Retry totals L119
- **Native assets and SDK calls** — Image item.imageUrl L59

### src/components/checkout/CheckoutPaymentDialog.tsx

- **Controls and navigation** — a /cart L173 · button Confirm $ and continue L186 · button onDismiss L200
- **Native assets and SDK calls** — element.showModal L92

### src/components/checkout/CheckoutPaymentPanel.tsx

- **Controls and navigation** — button name L140 · button Retry card fields L181 · input Name on card L203 · button Retry L228 · input payment-billing L254 · BillingAddressFields onBillingAddressChange L268 · button (event) => { event.preventDefault(); onPay(); } L303 · Link /refunds L331 · Link /shipping L334 · Link /privacy L337 · Link /terms L340 · Link /contact L343
- **Native assets and SDK calls** — Image /images/payments/${method === "cashAppPay" ? "cash-app- L156

### src/components/checkout/CheckoutUnavailable.tsx

- **Controls and navigation** — a /checkout L13 · Link /cart L19

### src/components/checkout/CheckoutWalletDetails.tsx

- **Controls and navigation** — form (event) => { event.preventDefault(); const parsedEmail = check L50 · input (event) => setEmail(event.target.value) L86 · input (event) => setPickup({ ...pickup, name: event.target.value }) L102 · input (event) => setPickup({ ...pickup, phone: event.target.value }) L117 · BillingAddressFields (field, value) => setBilling((current) => ({ ...current, [fiel L130 · input (event) => setShipping({ ...shipping, [field]: event.target.va L153 · button Continue L170

### src/components/checkout/ExpressCheckoutMethods.tsx

- **Controls and navigation** — button Pay with Apple Pay L35

### src/components/checkout/PaymentCardBrands.tsx

- **Controls and navigation** — button Show 4 more accepted card brands L42
- **Native assets and SDK calls** — Image /images/payments/${item.file}.svg L24

### src/components/checkout/SquarePaymentMethods.tsx

- **Controls and navigation** — form (event) => { event.preventDefault(); submitRegularPayment(); } L1601
- **Await owners** — initializePaymentMethodsConcurrently → Promise.allSettled L328 · bindWalletShippingContact → resolveWalletShippingContact L344 · SquarePaymentMethods → payments.card L680 · SquarePaymentMethods → method.destroy L682 · SquarePaymentMethods → method.attach L689 · SquarePaymentMethods → method .destroy?. L694 · SquarePaymentMethods → method.attach L801 · SquarePaymentMethods → method.attach L909 · pay → fetch L984 · pay → response.json L989 · runPayment → action L1037 · prepareOrder → prepare L1089 · prepareWithAddressReview → prepareOrder L1103 · prepareWithAddressReview → new Promise<{ address: ShippingAddress; confirmation?: str L1126 · prepareWithAddressReview → resolveWalletShippingContactRef.current L1138 · prepareWithAddressReview → new Promise<boolean>((resolve) => { totalContinuation.curr L1157 · reauthorizeCashApp → payments.cashAppPay L1180 · reauthorizeCashApp → new Promise<string>((resolve, reject) => { cashAppCancella L1195 · reauthorizeCashApp → method ?.destroy?. L1213 · submitTokenizedWallet → runPayment L1226 · submitTokenizedWallet → prepareWithAddressReview L1231 · submitTokenizedWallet → reauthorizeCashApp L1235 · submitTokenizedWallet → pay L1237 · submitTokenizedWallet → authorizeTokenizedSource L1239 · submitWallet → wallet.tokenize L1280 · submitWallet → new Promise<WalletDetails / null>((resolve) => { walletCon L1367 · submitWallet → resolveWalletShippingContactRef.current L1383 · submitWallet → prepareOrder L1393 · submitWallet → pay L1394 · submitWallet → authorizeTokenizedSource L1396 · submitPreparedMethod → prepareWithAddressReview L1422 · submitPreparedMethod → pay L1452 · submitPreparedMethod → authorizeAndTokenize L1454 · submitPreparedMethod → payment.tokenize L1461
- **Native assets and SDK calls** — method.attach L689 · method.attach L801 · method.attach L909 · wallet.tokenize L1280 · payment.tokenize L1461

### src/components/checkout/square-method-lifecycle.ts

- **Await owners** — destroy → current.destroy L14 · replace → destroy L22 · replace → create L26 · replace → attach L29 · replace → destroy L32 · replace → destroy L36

### src/components/contact/ContactForm.tsx

- **Controls and navigation** — form contact-form L120 · input name L125 · input email L144 · textarea message L163 · ActionButton Sending message… L177
- **Await owners** — handleSubmit → withRequestDeadline L78 · handleSubmit → fetch L79 · handleSubmit → response.json L85

### src/components/home/FeaturedItems.tsx

- **Controls and navigation** — ActionButton () => { setHasError(false); setIsLoading(true); setAttempt((va L164 · ActionButton Previous ${productLabel} L183 · FeedbackLink /store/${product.id} L201 · ActionButton Next ${productLabel} L233 · FeedbackLink /store?category=clothing L246
- **Await owners** — loadFeaturedItems → fetchJsonWithDeadline L53
- **Native assets and SDK calls** — Image product.primaryImage L208

### src/components/home/HomepageCategories.tsx

- **Controls and navigation** — FeedbackLink category.href L122 · ActionButton Retry designer collections L143
- **Await owners** — loadBrands → fetchJsonWithDeadline L28
- **Native assets and SDK calls** — Image /images/homepage_categories/${category.image} L97

### src/components/home/OutfitSlideshow.tsx

- **Controls and navigation** — ActionButton Previous outfit L136 · ActionButton Next outfit L144
- **Native assets and SDK calls** — Image src L119

### src/components/inventory/ProductForm.tsx

- **Controls and navigation** — form (event) => { event.preventDefault(); void work.run(() => { set L1161 · input ${id}-titleRaw L1195 · RdkSelect ${id}-category L1227 · RdkSelect ${id}-condition L1251 · button Retry tag options L1275 · button Retry parsing L1292 · button Did you mean ? L1325 · button Did you mean ? L1334 · input ${id}-brandOverrideInput L1355 · button Clear override L1374 · input ${id}-modelOverrideInput L1392 · button Clear override L1416 · textarea ${id}-description L1435 · button addVariant L1452 · input ${id}-${variant.draft_id}-sku L1500 · RdkSelect ${id}-${variant.draft_id}-size_id L1528 · input ${id}-${variant.draft_id}-salePrice L1554 · input ${id}-${variant.draft_id}-unitCost L1583 · input ${id}-${variant.draft_id}-stock L1611 · button Drag to reorder variant L1634 · button Remove variant L1646 · input (e) => { console.info( "[ProductForm] File input changed, file L1709 · div Add product images L1741 · div () => setPrimaryImage(index) L1790 · button Remove image L1838 · input publish-mode L1875 · input publish-mode L1885 · input ${id}-scheduledGoLiveAt L1912 · ActionButton onCheckSave ? "Checking…" : "Saving…" L1938 · button Cancel L1971
- **Await owners** — loadBrands → fetchJsonWithDeadline L417 · loadModels → fetchJsonWithDeadline L457 · parseTitle → adminCommand L510 · compression → loadImageCompression L704 · ProductForm → Promise.race L717 · handleUploadFiles → compressImage L867 · handleUploadFiles → adminCommand L885 · handleSubmit → onSubmit L1150 · ProductForm → onCheckSave L1948
- **Native assets and SDK calls** — import L38 · img image.url L1812

### src/components/orders/OrderStatusView.tsx

- **Controls and navigation** — a mailto:${status.supportEmail} L83 · a https://instagram.com/soles.neakers L93

### src/components/search/SearchOverlay.tsx

- **Controls and navigation** — form handleSubmit L270 · input Search for products L276 · ActionButton Close search L295 · FeedbackLink /store/${product.id} L374 · FeedbackLink searchHref(suggestion) L426 · FeedbackLink searchHref(normalizedQuery) L442
- **Await owners** — runSearch → fetchJsonWithDeadline L197
- **Native assets and SDK calls** — Image imageUrl L382

### src/components/shell/Footer.tsx

- **Controls and navigation** — a mailto:${SUPPORT_EMAIL} L40 · a INSTAGRAM_URL L48 · FeedbackLink link.href L71 · FeedbackLink link.href L89

### src/components/shell/Navbar.tsx

- **Controls and navigation** — ActionButton Open menu L131 · FeedbackLink Home L141 · ActionButton Account L164 · FeedbackLink /admin L178 · FeedbackLink /account L186 · ActionButton Signing out… L193 · FeedbackLink loginUrl L212 · ActionButton Search L227 · ActionButton handleCartClick L236 · ActionButton Search L248 · ActionButton Cart L257
- **Await owners** — handleLogout → withRequestDeadline L79
- **Native assets and SDK calls** — Image /images/logo.png L147

### src/components/shell/SessionShell.tsx

- **Await owners** — SessionShell → readServerSession L10

### src/components/shell/StoreMenuDrawer.tsx

- **Controls and navigation** — FeedbackLink href L62 · ActionButton onToggle L125 · DrawerLink buildStoreHref({ category, sizeIds: option.id }) L141 · ActionButton Back to main menu L166 · ActionButton Close menu L407 · ActionButton (event) => openPanel(panel, event.currentTarget) L428 · FeedbackLink /store L440 · DrawerLink /brands L468 · ActionButton () => toggleBrandSection("topBrands") L472 · DrawerLink brand.href L503 · DrawerLink buildStoreHref({ category: category.value }) L519 · SizeGroup SizeGroup L539 · SizeGroup SizeGroup L547 · SizeGroup SizeGroup L555 · SizeGroup SizeGroup L563 · SizeGroup SizeGroup L571 · SizeGroup SizeGroup L579
- **Await owners** — loadTaxonomy → fetchJsonWithDeadline L251

### src/components/shell/StoreOverlayLink.tsx

- **Controls and navigation** — FeedbackLink href L20

### src/components/store/ProductCard.tsx

- **Controls and navigation** — FeedbackLink productHref L42 · FeedbackLink productHref L75
- **Native assets and SDK calls** — ProductImage L51 · ProductImage L85

### src/components/store/ProductDetail.tsx

- **Controls and navigation** — ActionButton View product image ${index + 1} L139 · ActionButton () => setSelectedVariantId(variant.id) L201 · ActionButton Adding… L231 · button Retry loading cart L255 · ActionButton Shipping &amp; Returns L272 · FeedbackLink /shipping L294 · FeedbackLink /refunds L297
- **Await owners** — handleAddToCart → addItem L105
- **Native assets and SDK calls** — ProductImage L151 · ProductImage L167

### src/components/store/ProductImage.tsx

- **Native assets and SDK calls** — Image L29

### src/components/store/StoreControls.tsx

- **Controls and navigation** — ActionButton Grid view L119 · ActionButton List view L131 · ActionButton () => setSortOpen((open) => !open) L150 · ActionButton () => { setSortOpen(false); sortTriggerRef.current?.focus(); u L171 · ActionButton Previous L206 · ActionButton () => updateParams({ page: pageNumber }, true) L216 · ActionButton Next L230

### src/components/store/StorefrontFilterBar.tsx

- **Controls and navigation** — ActionButton () => setOpenFacet((current) => (current === facet.key ? null L210 · input store-price L246 · ActionButton Clear price L258 · input () => toggleOption(option) L280 · ActionButton Clear all L311

### src/components/ui/ActionButton.tsx

- **Controls and navigation** — button button L19

### src/components/ui/ConfirmDialog.tsx

- **Controls and navigation** — button Close dialog L66 · ActionButton onCancel L82 · ActionButton onConfirm L91

### src/components/ui/FeedbackLink.tsx

- **Controls and navigation** — Link Link L24 · Link Link L27

### src/components/ui/ModalPortal.tsx

- **Controls and navigation** — dialog label L135
- **Native assets and SDK calls** — dialog.showModal L118

### src/components/ui/RequestError.tsx

- **Controls and navigation** — ActionButton Retrying… L24 · a signInHref L35

### src/components/ui/RouteRetryButton.tsx

- **Controls and navigation** — ActionButton Retrying… L15

### src/components/ui/Select.tsx

- **Controls and navigation** — button ariaLabel L167 · input searchPlaceholder L225 · button ${menuId}-${idx} L255

### src/components/ui/Toast.tsx

- **Controls and navigation** — button Close notification L51

### src/components/ui/useAsyncAction.ts

- **Await owners** — useAsyncAction → operation L18

### src/contexts/SessionContext.tsx

- **Await owners** — SessionProvider → withRequestDeadline L141 · SessionProvider → fetch L142

## Final origin and authorization coverage

The current owner’s shipping configuration controls origin editing independently of order-list loading or 503. Four `ux-admin` origin cases cover opening and saving during failure and a held retry, closing the editor and hiding its toolbar after confirmed denial, and obtaining fresh configuration for a replacement staff owner. Captured stale saves issue no request. Row and label commands retain their separate writable-list requirement. The final reviewed source is `b3a1d4f8`; all 22 default browser runners passed. See the [final verification record](customer-admin-ux-implementation-2026-11-25/final-verification.json).
