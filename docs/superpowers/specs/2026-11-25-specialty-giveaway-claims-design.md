# Specialty giveaway claims

Date: 2026-11-25

Status: Approved by the user on 2026-11-25; implementation planning requested. An independent builder check on 2026-11-25 found no important unanswered questions before planning. Implementation execution has not yet been requested.

## Intent

Launch the Black Friday specialty giveaway without waiting for the architecture restructuring. Shoppers discover free prizes mixed among ordinary products, submit their Instagram handle and eligibility address, and receive an authoritative claim result. The reseller contacts winners on Instagram to arrange the prize, shipping, pickup, or payout privately.

This is a standalone claim feature. It does not create a cart line, checkout, payment, ordinary order, shipping label, or pickup task.

## Confirmed requirements

- Specialty products appear in random positions among other products and are excluded from public search and filters.
- The product action is Claim. It opens an accessible popup containing Instagram handle and address fields.
- Opening or completing the form reserves nothing. The first complete, valid submission accepted by the server wins available stock.
- There is no payment information, email requirement, fulfillment choice, shipping/pickup configuration, or automated payout in this flow.
- Each successful claim consumes one unit. Quantity greater than one permits multiple distinct winners.
- One successful claim per campaign across all specialty products is allowed for either a normalized address or a normalized Instagram handle. Matching either blocks another win.
- Changing case, extra whitespace, or an optional leading @ must not bypass handle matching. Equivalent address spellings must not bypass address matching; meaningful apartment/unit identifiers must be preserved.
- Winners see next instructions. A confirmed inventory loser sees a clear message such as, "Unfortunately, someone else claimed this item before you."
- Staff have a Specialty Product Claims entry in the admin area, with winner details for contacting them.
- Use direct database transactions, not a durable processing queue. Stress-test 1,000 simultaneous submissions, including competition for one item and simultaneous competition across products.
- Keep the design in text; browser mockups were declined.

## Approaches

1. Direct atomic database claims, selected by the user. A dedicated API validates the submission, then one short Postgres transaction checks eligibility, awards inventory, and persists the result. It uses the existing Supabase setup and has fewer components to deploy and operate. Burst capacity and safe overload behavior require measurement.
2. Durable ordered submissions with background processing, considered but not selected. This can buffer longer surges and survive worker interruptions after acceptance. It adds a queue, workers, ordered processing, result polling, and additional failure recovery. It still requires atomic database eligibility and stock protection.

The selected approach defines acceptance at the successful database decision, not arrival at a web server, client click time, client timestamps, or the start of address validation. Database lock scheduling is not a promise of HTTP arrival order. A request that times out before committing has not been awarded priority over a later committed claim.

## Scope and constraints

This is a focused feature project touching inventory, discovery, claim processing, and admin records. Do not resume the broad architecture migration or redesign ordinary checkout. Keep new business logic together in feature folders and keep framework routes thin; do not move unrelated existing code.

Use the existing Next.js, Supabase Postgres, Shippo address validation, request protection, and admin authentication patterns. The implementation must read the relevant installed Next.js guides before changing framework code. Preserve PR-based staging and production tag gates. This design does not authorize a deployment, merge, tag, or production data change.

Existing code grounding:

- ProductService and ProductForm manage products, variants, images, scheduling, and inventory. Specialty is currently absent from product category validation.
- ProductRepository and StorefrontService drive storefront listings and facets; ProductCard and ProductGrid render ordinary results. The homepage contains FeaturedItems product sections.
- CheckoutReservationRepository already delegates inventory reservation to a Postgres RPC, but its contract includes checkout/payment/fulfillment state. Do not make a fake payment or route prizes through that contract.
- shippingAddressKey currently handles case and whitespace only. It is insufficient by itself for the required address equivalence policy.
- validateShippingAddress already integrates Shippo; its checkout-specific contact shape must not force name, phone, or email collection for claims.
- AdminSidebar provides existing admin navigation. Existing authentication and role checks must protect claim details and admin mutations.

Non-goals include Instagram account ownership verification, proof of one human, prevention of link sharing or automated catalog inspection, raffle/random winner selection, cart restrictions for prizes that never enter the cart, automated messaging, returns/refunds, re-awarding prizes, a reusable marketing campaign builder, and claiming that a load test proves all production traffic patterns.

## Approved product and operational defaults

The following originated as engineering/product proposals and were accepted with approval of this design on 2026-11-25:

- Use one Black Friday 2026 campaign, with an admin-controlled enabled switch. Begin disabled; do not invent an automatic opening time. Existing per-product go-live scheduling still applies.
- US addresses only for this launch, consistent with the earlier Black Friday work program.
- Claims work for guests and signed-in customers; an account is not required. Login or logout does not reset eligibility.
- Model each specialty product as one prize configuration with one stock-bearing, no-size-choice variant. Put any physical size or prize-specific detail in its title/description. Initial quantity is a nonnegative integer; published claimable products require positive remaining stock.
- Default winning instructions: "You claimed [product]. The reseller will contact @[handle] on Instagram to arrange your prize. Keep this confirmation for your records." Allow staff to customize plain-text next instructions per product.
- Staff can mark winner follow-up as New, Contacted, or Fulfilled. Those tracking states do not undo a win, replenish stock, or clear eligibility.
- After the first win, quantities cannot be edited or restocked in this version. Prize deletion and conversion into an ordinary product are blocked. Archiving closes discovery and new claims while preserving records and receipt recovery.

## Product management

Add Specialty to admin product creation/editing and admin inventory filtering. Keep it absent from public category controls and facets. Selecting Specialty exposes prize title, description, images, quantity, optional next instructions, and go-live scheduling. Price is fixed at zero; hide shipping price and ordinary purchase/fulfillment controls.

Reuse products, product_images, and the stock-bearing product_variants row. Keep claim-specific campaign/configuration fields in a separate specialty product configuration record. Existing brand/condition requirements may use neutral compatibility values supplied by the server, without forcing the reseller to invent a brand for a money prize. The exact neutral taxonomy mapping is left to the builder; it must not introduce a public giveaway search/filter option. Validate product, configuration, variant, and images as one coherent creation/update operation so partial products never become discoverable.

An ordinary product cannot be converted to or from Specialty after creation in this version. Changing metadata must never write stale variant stock from the edit form. Specialty stock writes go through a dedicated transaction that uses the same product/variant lock order as claim acceptance and rechecks that no winning claim exists. Ordinary product APIs must reject unsupported specialty stock/variant mutations rather than silently applying ordinary update behavior.

## Discovery and public product behavior

Approved discovery placement:

- Mix at most one eligible specialty card into a random position on an unfiltered Shop All results page.
- Also allow one random specialty card in an existing homepage FeaturedItems product section, at most one per homepage visit. Do not add a giveaway-only page or banner.
- Do not inject specialty cards when a keyword, category, brand, model, size, condition, or price filter is active. View mode, pagination, or a sort-only change may retain discovery; sorting must not collect prizes at the cheapest end of the results.
- Keep ordinary products in their requested order. A specialty card is an extra discovery placement, not part of ordinary product counts, facets, sort ranks, or pagination totals.
- Select from a small eligible specialty pool rather than randomizing or scanning the full ordinary catalog. Stabilize the selection/position during a rendered page visit so rerenders do not move a button under someone's pointer.

Eligibility requires campaign enabled, specialty configuration present, active/unarchived product, reached go-live time, valid zero-price configuration, and remaining stock. Public cache freshness may briefly show a just-claimed card; the claim endpoint always checks authoritative state. Aim for discovery cache freshness of at most five seconds, with invalidation after an award or admin change where supported. Do not cache private claim results.

Specialty cards and the existing product detail route show Claim rather than Add to cart. Both open the same claim form. Cached product pages must not decide whether a claim wins. A direct product link remains usable while the product is live; catalog exclusion is discovery behavior, not a security boundary. Ordinary cart validation and checkout resolution must reject specialty products even if a caller fabricates a cart payload.

## Claim form and result behavior

Collect only Instagram handle, street address, optional apartment/unit, city, state, ZIP, and US country. Explain the one-per-address-or-Instagram rule and that the reseller will contact winners through Instagram. Do not ask for email, card, phone, shipping, pickup, or a legal name solely to fit checkout types.

Use the site's visual style and existing dialog primitives. The popup must support keyboard focus, labels, inline field errors, mobile scrolling, and focus restoration. Opening, validating, correcting, or closing an unsubmitted form creates no inventory hold.

During submission, prevent repeated button clicks while keeping an accessible processing message. Closing the popup or losing the connection cannot cancel a committed win. Persist only the opaque attempt/recovery credentials and product reference in browser session storage, not the raw eligibility address. Reopening the form in that browser recovers an unfinished attempt before offering a fresh one.

Result states are distinct:

| State                                | Customer behavior                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Won                                  | Show product, claim reference, submitted Instagram handle, and saved next instructions.                                         |
| Sold out                             | Explain someone else claimed the available item first; do not imply the visitor has used their campaign allowance.              |
| Already claimed                      | Explain the campaign limit was already used for this Instagram handle or address, without revealing another claimant's details. |
| Invalid information                  | Show field errors or a corrected-address confirmation and allow correction. Nothing is reserved.                                |
| Closed/unavailable product           | Explain the claim is no longer available.                                                                                       |
| Temporarily unavailable/rate limited | Preserve the form and attempt; show a retryable message and bounded retry guidance. Do not call this a lost claim.              |
| Unknown after timeout                | Check the saved attempt result, or retry the same attempt. Do not show Won or Sold out without a committed result.              |

## Validation and normalization

Instagram: apply one shared server normalization version, normalize supported Unicode compatibility forms, trim surrounding whitespace, remove one optional leading @, and lowercase. Validate the resulting handle against supported Instagram username syntax; reject malformed values and internal whitespace. Preserve periods and underscores because removing them could merge different handles. Accept @handle and handle; full profile URLs may receive a helpful validation error. This validates syntax, not account existence or ownership.

Address: validate and standardize using the existing address provider through a claim-specific adapter. Use the provider's canonical street/city/state/country and normalize case, whitespace, punctuation conventions, ZIP versus ZIP+4, and equivalent street/unit designators consistently. Keep unit identity: Apt 4 and #4 must match, but unit 4 and unit 5 must remain distinct. Do not include Instagram, name, or phone in the address eligibility identity. Do not just lowercase a raw address or indiscriminately strip all punctuation/digits.

If an address needs correction, obtain confirmation before submission can be accepted. If validation is unavailable or ambiguous, fail safely with a retryable/validation result; no unchecked-address override may bypass the cap. An address cap is a household/destination rule and cannot establish a unique human. Provider-standardized results are not infallible; test representative US street/unit/ZIP equivalents and record known limitations.

Address validation may run while the form is completed, without reserving anything. Issue a short-lived signed validation token, proposed lifetime ten minutes, bound to the campaign, canonical address identity, normalized handle, normalization version, and browser context. Editing those fields invalidates it. The final submission can validate on demand if there is no usable token. Verified tokens avoid another external provider call on the hot database decision path.

The server derives campaign-scoped HMAC eligibility identifiers. Clients cannot supply authoritative identifiers. Pin normalization version and HMAC key for the active campaign; a rollout or key rotation must not create a new eligibility identity for previous winners. Changing normalization requires a reviewed compatibility/backfill strategy before activation.

## Data and authorization

Add additive schema changes, not a destructive reset. Exact SQL names may be adjusted by the builder:

- specialty_campaigns: stable campaign identifier/slug, enabled state, normalization version, timestamps.
- specialty_product_config: product reference, campaign reference, designated variant reference, optional plain-text winning instructions. Enforce one configuration per product and one designated claim variant.
- specialty_claims: immutable claim ID, campaign/product/variant references, campaign-scoped address and handle identifiers, canonical Instagram handle and restricted canonical address, product/instruction snapshots, accepted decision metadata, and staff follow-up state/audit timestamps.
- specialty_claim_attempts: unique opaque idempotency key, hashed recovery credential, normalized payload fingerprint, terminal result, and optional winning claim reference. Do not retain losing applicants' raw addresses or handles merely for retry recovery.

Database unique constraints enforce one winning claim per campaign/address identifier and separately per campaign/handle identifier. The idempotency key is also unique. Claimed product/variant deletion must not cascade away winners or reset allowance; preserve snapshots and use restrictive references where appropriate. Protect claim identity/contact and acceptance facts from ordinary staff status edits.

No anonymous or ordinary authenticated database role may directly select claim PII, modify claims/stock, or invoke award functions. Claim RPCs are server-only, with narrowly granted execution and a fixed safe search_path. Staff APIs/pages use the existing admin role checks. Public discovery returns catalog data only.

Use a stable, dedicated server signing/HMAC secret configured through the existing secret-management path. Missing required protection/configuration returns a clear unavailable result rather than opening an unprotected award route. Raw addresses, Instagram handles, signed validation tokens, recovery credentials, and request bodies must not enter logs, analytics, URLs, or error reports.

## Atomic acceptance and recovery

Generate an opaque idempotency key and a separate high-entropy result-recovery credential before the first actual submission. Reuse them for duplicate clicks, retries, timeout recovery, and popup reopen. The key is not itself authorization to read a result. Bind an attempt to one canonical campaign/product/handle/address payload. Reusing its key with a different payload or wrong credential returns a conflict/unauthorized response, not someone else's result.

The claim route checks for an existing authorized committed result before applying current product availability or validation-token expiry. This lets an existing winner recover after the prize sells out, is archived, or the campaign closes. A fresh award still requires current validation, campaign access, bot/rate protection, and product eligibility.

One short RPC transaction performs the authoritative decision:

1. Serialize duplicate work for the attempt and return its existing bound result if present.
2. Lock and recheck the campaign/product configuration and designated stock row using a consistent lock order. Acquire no global exclusive campaign lock that serializes every unrelated product.
3. Check current campaign/product availability and whether either eligibility identifier already won. A new attempt never creates a held claim while waiting for the customer.
4. If eligible and stock remains, insert the winner under both unique constraints, decrement exactly one unit, and persist the successful attempt result and snapshots in the same transaction.
5. If a concurrent different-product claim wins either uniqueness race, record Already claimed without consuming this product's inventory. Handle that conflict within the transaction; do not leave a partial decrement or abort with an unexplained server error.
6. If stock is exhausted, persist Sold out. Persist other terminal business decisions with the same binding. A retryable infrastructure error rolls back acceptance and leaves the same attempt safe to retry.
7. Commit before returning a winning/losing result. A lock timeout, connection error, or response loss must never be translated into a definitive loss.

No network validation, Square/Shippo payment/label operation, notification delivery, or analytics call belongs inside the award transaction. Use server decision ordering under the product lock for audit; timestamps from clients do not select winners. A per-product decision ordinal is preferable to pretending wall-clock timestamps prove cross-server arrival order.

Different products can accept claims concurrently, while shared database uniqueness protects the campaign-wide identity cap. No dedicated per-product queue is created. For stock one, exactly one committed win is possible; for stock N, at most N distinct eligible winners are possible. A successful response lost in transit is still a win and is recovered with the original attempt credentials.

Expose a private no-store result-recovery endpoint using the opaque credentials in a protected request body/header, not a public URL containing secrets. Unknown/uncommitted attempts remain retryable and do not reserve stock. Do not provide anonymous lookups by Instagram or address. There is no email/Instagram notification or cross-device receipt-recovery promise in this version; staff can locate a winner privately if browser credentials are lost.

## Abuse protection and operation

Apply existing same-origin/CSRF, trusted-client-IP, store-access, and browser/bot protection to the claim and validation routes. Give claims a deliberate rate policy rather than accidentally inheriting an unrelated low write quota. Bound per-browser/device, IP, and validation-provider usage without treating an IP as a person or breaking retries from a shared network. Do not weaken ordinary checkout protection.

Use bounded lock/statement durations, connection-pool-aware requests, bounded client retry with jitter, and explicit Retry-After guidance when throttled. The database remains the award authority if a cache is stale. Protection/validation outages prevent new unvalidated wins but do not change committed outcomes. Normal winner recovery does not require rerunning address validation or creating another claim.

Record non-PII operational metrics: outcomes, duplicate replay/conflict counts, lock waits/timeouts, claim/validation latency, rate/protection failures, and error rates. Include request IDs, product/campaign IDs, and deployment/commit metadata; never raw contact details or bearer credentials. Staff can disable new claims through the campaign switch, and accepted receipts remain recoverable.

## Admin claims area

Add Specialty Product Claims under the existing admin commerce navigation. Show successful claims with product image/title, claim reference, accepted time/order, Instagram profile link, restricted address details, and New/Contacted/Fulfilled state. Include product/state filtering and pagination for staff. Only authorized staff can change follow-up status; keep an audit of who changed it and when.

Show campaign enabled state and the explicit open/close control. Product inventory remains in the existing inventory area. Do not route these records into paid transaction totals, shipping/pickup queues, tax/payment reporting, or payment-expiry workers. Display the winner-facing instruction snapshot so staff can see what was promised.

## Verification and launch gates

Run tests against actual Postgres with independent concurrent transactions. SQL text assertions or mocked repository calls do not prove the stock/eligibility invariants. Use isolated synthetic fixtures and never mutate or claim real production prizes for testing.

Required coverage:

- Normalized handles: case, @ prefix, surrounding whitespace, malformed/Unicode input, and distinct valid punctuation.
- Addresses: case/spacing, common street and unit equivalents, ZIP/ZIP+4, corrected/invalid/unavailable results, meaningful distinct units, edited/expired/tampered validation tokens.
- Atomic stock-one and stock-N races; same address with different handles; same handle with different addresses; matching identities across different products; unique identities across different products.
- Repeated same-attempt submissions; reused key with changed payload/credential; response loss after commit; response loss before commit; refresh/reopen; retry after campaign close/archive; bounded lock/protection/provider failure behavior.
- No holds when forms open; no specialty entries in normal search/facets/filtered results; no forged cart/checkout purchase; inaccessible claim data/RPCs for anonymous/non-admin roles; admin metadata saves and stock edits racing claims.
- Real browser checks of discovery, keyboard/mobile popup behavior, contact validation, all result states, private recovery, and authorized admin follow-up.

Stress scenarios release 1,000 independent submissions behind a start barrier, including one hot stock-one product, stock N, multiple products, cross-product duplicate identities, and repeated requests. Record the actual arrival window, generator limits, request outcomes, database winners/remaining stock, uniqueness violations, latency, lock waits, and deployed commit. Read the database afterward: every winning response/receipt must correspond to exactly one durable winner, and every consumed unit must be accounted for.

Separate evidence layers: (1) real database contention; (2) HTTP claim path with signed prevalidated synthetic fixtures; (3) hosted application behavior and real browser/protection/address-provider integration. Clearly label synthetic address tokens or provider-supported staging bot test modes. A thousand blocked bot/rate-limit requests is not proof of claim-processing capacity. Exercise on-demand validation and provider throttling separately so prevalidated-token results do not hide that dependency.

Approved performance acceptance target for the prepared valid-submission burst: all 1,000 reach a truthful terminal result or recover to it within 30 seconds, p95 claim response at most 3 seconds, p99 at most 10 seconds, zero oversells/duplicate wins/lost committed wins, and no unhandled server errors. These timings originated as engineering proposals and were included in the approved design; they are targets, not measured capacity. Also test overload beyond capacity: bounded retryable results rather than false losses or corruption. If the target is not achieved on the tested deployment, report the failure and investigate before claiming launch readiness.

Run relevant unit/integration/browser checks plus typecheck, lint, formatting, and a production build for changed paths. Recheck ordinary purchases and admin product management. Apply additive migrations and configure secrets on isolated staging through existing release gates, then record the exact tested deployment and differences from production. Preserve historical giveaway work-program documents as history; this design supersedes their cart/checkout/email/fulfillment requirements for this specialty feature only.

## Left to the builder

Exact feature/file/RPC names, supporting indexes, transaction conflict-handling mechanics, credential hashing/signing implementation, neutral taxonomy compatibility mapping, accessible dialog composition, cache invalidation plumbing, test runner/load generator selection, and bounded timeout/rate-limit values may be chosen during implementation. They must preserve the explicit acceptance semantics, invariant checks, confidentiality, recovery behavior, and evidence distinctions above.

Before building, obtain approval of this design and then create the implementation plan using the writing-plans skill. If review finds a decision that changes customer behavior rather than an implementation detail, bring it back to the user before treating it as agreed.

## Reference material

- PostgreSQL row locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL uniqueness constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
- Existing repository product, storefront, admin, address validation, and reservation paths named above.
