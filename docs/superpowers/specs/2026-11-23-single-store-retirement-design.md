# Single-store retirement design

Status: approved by the user on November 23, 2026. Implementation follows the
separate compatibility, application cutover, and contraction releases below.

## Intent and approved requirements

Sole Sneakers operates one Store. The user explicitly confirmed that seller
accounts and tenancy are unused and must be removed. A separate platform is being
built for multiple tenant businesses. Historical multi-tenant plans are not the
requirements for this application.

The target has customers, staff, one catalog, one inventory, and one set of store
settings. Normal application interfaces must not require selecting, creating,
resolving, or passing a tenant. A fixed default tenant is not the final model.

Preserve administrator authorization and MFA, customer/guest order ownership,
payment protection, transactional inventory, purchase snapshots, fulfillment,
financial history, durable notifications, and existing product-image URLs.
Retain email-code sign-in and the already completed invitation-code retirement.

The agreed module convention remains
`Modules/<Module>/Source/Features/<Feature>` with module-owned tests under
`Modules/<Module>/Tests/Features/<Feature>`. This retirement is a prerequisite
cleanup; it does not also move every feature into the future module layout.

## Work already applied

- Remove `seller` from accepted application profile roles.
- Remove the unused optional `sellerId` product-creation/duplication context and
  the two routes' null arguments.
- Rename the transaction display's seller revenue variable and labels to Store
  terminology, preserving every financial calculation.
- Record the business vocabulary in `GLOSSARY.md`.

Square's `sellerKeyedIn` payment-field property belongs to its integration
contract. The legal description of Sole Sneakers as an independent reseller is
also valid. Neither is an independent seller-account capability to delete.

## Evidence and environment limits

The initial source scan found references in 61 source files, including generated
types, 30 test files, five operational scripts, 45 historical migration files,
the seed, and 16 documents. Counts describe the pre-cleanup search surface, not
the number of files that all require implementation changes.

Read-only inspection on November 23, 2026 targeted only the local
`supabase_db_solesneakers` container's `postgres` database. No migration was
applied and no customer records or credentials were printed.

| Local evidence                                                                                 | Result                                                                                                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Recorded migrations                                                                            | 103; latest `20260922120000`                                                                                         |
| Missing committed migrations                                                                   | `20260918180000_remove_marketing_and_contact_attachments.sql`; `20260919090000_retire_unused_application_schema.sql` |
| Tenant rows                                                                                    | 1                                                                                                                    |
| Profiles / seller profiles                                                                     | 1 / 0; the profile is an administrator                                                                               |
| Product rows / order rows                                                                      | 1 / 3                                                                                                                |
| Distinct tenant references across profiles, products, orders                                   | 1                                                                                                                    |
| Tables containing `tenant_id` locally                                                          | 29                                                                                                                   |
| Tables containing `tenant_id` in the intended current generated schema                         | 20, plus the separate `tenants` table                                                                                |
| Local taxonomy, SKU, shipping-category, featured-product, state/month collision groups checked | 0                                                                                                                    |
| Local store-access settings rows                                                               | 0                                                                                                                    |
| Local storage policies                                                                         | 0                                                                                                                    |

Model-name collision checks used normalized parent-brand names as well as model
names. The other checks covered brand labels, aliases, size type/label, SKU,
shipping category, featured product, and state/year/month keys.

These are local facts only. They do not establish staging/production migration
versions, row ownership, uniqueness, deployed policies, storage privileges,
provider state, or Redis contents. In particular, the local database still has
objects such as `sellers` and `orders.seller_id` that committed retirement SQL
already removes. Regenerating types from it now would restore obsolete schema.

The missing retirement migration has a legacy payment-link prerequisite and
destructive cleanup. Do not apply it automatically or fabricate its prerequisite
evidence to make this migration pass.

## Approaches and tradeoffs

1. A fixed tenant or permanent compatibility adapter would reduce immediate
   edits, but retain the business concept that the user has explicitly retired.
   It is unsuitable as the target architecture.
2. A simultaneous application/schema replacement is simpler to describe, but
   existing deployment workflows migrate before deploying the application. Old
   server code, browser requests, permits, and pending purchases would still
   depend on the previous contracts.
3. **Recommended: staged compatibility retirement.** Add tenant-free database
   contracts while retaining old ones temporarily, move application callers and
   transient contracts, prove compatibility, then remove the old schema. It
   requires multiple reviewed releases but has a defined rollback window.

This recommendation is proposed migration mechanics. The user's confirmed
decision is complete seller/tenant retirement, not approval of every step below.

## Target ownership and application changes

| Area                        | Target behavior                                                                                                           | Main current source                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                    | Profiles and sessions contain identity and role; profile creation requires no tenant lookup or bootstrap                  | `src/lib/auth/session.ts`, `src/lib/auth/tenant.ts`, `src/services/auth-service.ts`, `src/services/tenant-service.ts`, `src/repositories/profile-repo.ts` |
| Catalog / inventory         | Product and variant operations use product IDs and staff authorization; query/filter interfaces lose tenant arguments     | `src/repositories/product-repo.ts`, `src/services/product-service.ts`, admin product routes/actions                                                       |
| Taxonomy                    | One canonical brand/model/alias/size namespace and one candidate workflow                                                 | `src/repositories/tag-taxonomy-repo.ts`, taxonomy/title-parsing implementations and routes                                                                |
| Store access                | One store settings row; scheduled opening, checkout lock and messages retain their meanings                               | `src/repositories/store-access-settings-repo.ts`, `src/lib/store-access/get-store-access-settings.ts`, `src/proxy/site-lock.ts`                           |
| Shipping / checkout pricing | One shipping default per category; pickup and maximum-category shipping calculations stay unchanged                       | `src/repositories/shipping-defaults-repo.ts`, `src/lib/checkout/checkout-pricing-gateway.ts`                                                              |
| Checkout                    | No tenant lookup in quote, preparation, permits, charging or expiry; preserve exact totals and all protection             | `src/lib/checkout/*`, `src/repositories/checkout-reservation-repo.ts`                                                                                     |
| Orders / notifications      | Facts, audits and durable jobs attach to the order; no tenant constructor argument or lookup per send                     | notification dependencies, order/refund email implementations, resend route                                                                               |
| Product images              | New paths use product identity and content hash; existing URLs and objects remain readable without moving/deleting assets | `src/services/product-image-service.ts`, product-image upload route                                                                                       |
| Operations                  | Seed, fixture builders, current-schema assertions and RLS tests describe one Store                                        | `supabase/seed.sql`, `tests/rls/rls-check.ts`, five database scripts                                                                                      |

Delete the tenant bootstrap module, repository and helper after their callers are
migrated. Do not replace them with another process that creates a synthetic owner.
Keep proven shared mechanics; normal callers gain leverage from smaller
interfaces and maintainers gain locality around the owning module.

## Schema design and data preservation

After baseline alignment, the 20 expected tenant-bearing tables are:

`checkout_notification_outbox`, `email_audit_log`, `featured_items`,
`inventory_reservations`, `orders`, `payment_transactions`, `product_variants`,
`products`, `profiles`, `shipping_defaults`, `shipping_profiles`, `square_disputes`,
`square_refunds`, `state_sales_tracking`, `tag_aliases`, `tag_brands`,
`tag_candidates`, `tag_models`, `tag_sizes`, `tenant_store_access_settings`.

The final schema removes their tenant columns and the `tenants` table. Rename
`tenant_store_access_settings` to `store_access_settings`, preserving settings and
enforcing a single row. If no legacy settings row exists, initialize that row
with the current application's explicit defaults; do not accidentally lock or
unlock a configured Store. Conflicting legacy configurations block contraction.

Replace tenant-dependent uniqueness with the actual store-wide keys:

- Variant SKU; featured product; shipping category.
- Brand normalized name; model normalized name within canonical brand; alias
  entity type/normalized value; size type/normalized name.
- Sales state/year/month, preserving every historical amount and count.

Preserve the existing key expressions while removing the tenant dimension:
SKU, category, state, and stored `alias_normalized` values keep exact equality;
canonical brand/model/size labels retain `lower(canonical_label)`. Applying new
trimming or case folding to stored identifiers is a separate data-cleanup
decision, not an implicit part of removing tenancy.

Preflight all retained tenant-bearing business rows, including nullable/global
records, rather than only `profiles` or the first tenant. Unexpected independent
owners or conflicting store settings stop the migration for resolution. Do not
choose an arbitrary tenant, discard rows, or create a fake replacement identity.

The first contraction requires collision-free canonical identities. Report and
block on collisions rather than silently merging taxonomy, deleting a variant,
changing SKUs, or choosing a conflicting shipping price. A later reviewed mapping
can resolve actual collisions while preserving product/model/brand/size/alias/
candidate references. Size mappings must also protect product/size uniqueness.

Preserve IDs and non-tenant fields of retained rows, balances, stock, order-item
snapshots, refund/dispute facts, audit rows, outbox IDs and sent evidence. If sales
rows require a separately reviewed consolidation, preserve the sums of
`total_sales`, `taxable_sales`, `tax_collected`, and `transaction_count`; do not
recalculate history from today's order state.

Historical migration files stay intact. Use explicit forward migrations and
restrictive drops. Unknown dependencies must fail visibly; broad `CASCADE` is
not an acceptable cleanup mechanism. The separately retired `admin_invites`
database table remains its own tracked disposition, outside this migration.

## Authorization and database routines

Removing tenant predicates does not remove authorization. Keep validated server
identity, `is_admin()`, the existing admin/super_admin/dev role set, role-change
protection, MFA, and customer/guest ownership checks. Supabase's platform schemas
are not application tenancy and remain unchanged.

Replace 18 expected tenant-dependent policies explicitly. Staff management of
products, variants, images, taxonomy, settings, audits, refunds, disputes and
outbox remains staff-only. Anonymous shoppers retain intended published catalog
reads; customers retain only authorized access to their own records. Financial
order mutation and settlement remain trusted server/database operations.

Two proposed policy corrections need explicit tests and review:

- Payment-transaction policy currently names `admin/staff`, although `staff` is
  not a valid profile role. Normalize operational access to the existing
  administrator roles: admin, super_admin and dev.
- State-sales reads currently rely on tenant membership rather than staff role.
  Internal store sales totals should require administrator authorization.

The existing customer order mutation concern remains covered by readiness issue
#32; this migration must not preserve it by replacing tenant filters with an
unrestricted authenticated policy.

Rewrite nine ordinary routines: `is_admin_for_tenant`, `accept_tag_candidate`,
the public reservation entry and its `without_billing`/`with_address` helpers,
refund/dispute processors, tracking-update recording, and payment-details
recording. The tenant-specific authorization helper is removed after its callers
are replaced; the other capabilities retain tenant-free routines.

Rewrite six trigger functions and their dependent triggers where necessary:
taxonomy-reference validation, variant-size validation, state-sales aggregation,
paid confirmation, refund confirmation, and label-created notification. Trigger
update-column lists also need changes.

Preserve explicit administrator checks in SECURITY DEFINER routines, safe search
paths, effective ACLs and service-role-only entry points. Internal reservation
helpers are owner-only and must not gain public or service-role EXECUTE merely
because their signatures change. Verify effective permissions through the
catalog and denied-identity executions, not migration strings alone.

## Compatibility for purchases and security state

Tenancy is embedded in stored/transient contracts, not only query filters:

- Cart hashes use version 3 and include tenant identity.
- Single-use payment permits include tenant identity and expire after 120 seconds.
- Signed address confirmations use a v1 signing domain and expire after 10 minutes.
- Reservations are prepared for 15 minutes; delayed provider outcomes can outlive
  the nominal hold and must still converge to the correct paid/review result.
- Checkout counters use a tenant-prefixed Redis namespace with windows up to
  24 hours.

Add explicit new contract versions. A compatibility reader must accept and
validate previously issued contracts during the transition, preserving order,
amount, cart, device, email binding, single-use consumption and idempotency.
Keep legacy normalization in a private adapter rather than exposing tenant fields
in the new application interface. Persisted pending orders keep their original
hashes and provider identifiers until resolved; never issue a new charge to
repair a hash/version mismatch.

Roll out compatibility readers everywhere before enabling new producers. Existing
browsers and provider/background callbacks must remain supported. The oldest
compatible rollback application is the dual-reader release once new contracts
exist; the original application is no longer a safe rollback target then.

Use stable application/environment Redis namespaces, distinct from business
identity. Verify separation from staging and other applications before cutover.
Preserve current counters using atomic dual-check/dual-write behavior during the
transition; do not reset protection windows by changing prefixes. Retire legacy
counter use only after the last old writer is gone and a full 24-hour maximum
window has elapsed. Keep privacy-safe counts of old-contract activity as evidence.

Contract only when old application/database callers are gone, old transient
contracts are expired or resolved, and outstanding reservations, payments and jobs
have been reconciled. Elapsed time alone does not prove an ambiguous payment safe
to release. Remove the bounded compatibility adapter in the final contraction.

## Recommended execution and rollback

1. **Preflight and baseline:** record application/migration versions, aggregate
   ownership and collision counts, policy/routine/trigger/index dependencies,
   effective ACLs, storage configuration, provider mappings, pending purchases and
   outbox backlog separately for each environment. Verify restorable backups.
2. **Disposable verification:** replay the complete schema into an isolated
   database and test a populated copy aligned to the intended baseline. Honor
   existing retirement prerequisites. The ordinary local/staging/production
   database is not a destructive test target.
3. **Expand:** add tenant-free database contracts with compatible old signatures
   and columns. Preserve old caller behavior. Temporary database compatibility
   may derive the one preflight-verified existing owner; normal application
   interfaces do not receive it.
4. **Application cutover:** first deploy compatibility readers, then enable new
   producers and tenant-free application paths. Keep invariants, data ownership,
   payment authority, assets and rate limits under behavioral verification.
5. **Contract:** after observed compatibility exit criteria, remove the old
   columns/routines/keys/table, obsolete dependency plumbing and old settings
   name. Regenerate types from the correctly migrated disposable schema.
6. **Revalidate and release:** replay again, prove populated-copy preservation,
   review resulting application/schema changes, and complete staging evidence
   before a separately authorized production cutover.

Both checked deployment workflows run migrations before application deployment
(`.github/workflows/staging.yml:41–66`, `production.yml:56–81`). Expand and contract
therefore require separate releases. Do not put both into one pending migration
batch that automatically runs before compatibility code is deployed.

After contraction, the oldest compatible application rollback is the tenant-free
release. Restoring removed ownership metadata, columns or merged data requires
the verified backup and a matching application/schema restoration; a code revert
alone is insufficient.

The owner has not approved a code freeze. Keep Black Friday safety work moving
independently; completing the whole tenant retirement is not a new prerequisite
for every existing readiness ticket. Preserve issue #41 as the full capacity gate.

## Verification and acceptance

- Anonymous, customer A, customer B, admin, super_admin, dev, and service-role
  identities exercise the real SQL authorization matrix. Staff still requires
  the normal application/MFA guards.
- Real competing transactions prove last-stock allocation, complete rollback on
  partial allocation, repeat/release idempotency, late-payment review and the
  existing notification/payment/refund invariants.
- Old/new contracts and mixed-version requests exercise migration compatibility,
  address review, cancellation, expired permits, ambiguous payment recovery and
  protection-counter continuity. New tests cross the module interface rather
  than only asserting helper wiring.
- Compare retained row IDs, counts and hashes of non-tenant data, stock, financial
  sums, taxonomy references, URLs, audit facts and durable jobs before/after.
- Exercise collisions and unexpected owners as rejected migrations, preserving
  all original data. Verify singleton settings with zero, one and conflicting
  legacy configurations.
- Update the seed, RLS harness, five operational database scripts, current-schema
  assertions and affected application tests. Historical migration tests may keep
  historical terminology when clearly identified.
- Run TypeScript, lint, formatting, application suites, relevant browser journeys,
  full migration replay and populated-copy checks. Real provider/browser proof
  and deployed catalog proof remain separately labeled evidence.
- Final application/schema inventory has no tenant bootstrap, selector, public
  tenant argument, tenant-based authorization helper or seller role. Bounded
  compatibility plumbing is deleted. Permitted SDK/legal terminology and
  historical migration references are documented exceptions.
- Measure the removal of repeated tenant/settings lookups and dependency fan-out.
  No latency or monetary savings are claimed without runtime measurements.

## Builder discretion and unresolved external evidence

The builder chooses private helper decomposition, generated migration timestamps,
the concrete singleton key representation, and the minimal test fixtures. The
intended singleton, authorization, collision-abort, preservation and compatibility
behaviors above are fixed requirements of the approved design.

Actual staging/production state, unknown external consumers, counter namespaces,
backup restoration, old-server lifetime and provider recovery evidence are
preflight gates to discover. They are not assumed facts and must not be invented
or bypassed to unblock a deployment.

## Design review status

An independent builder review found no important unanswered planning questions.
The user approved the tenant implementation and staged migration mechanics.
The seller application cleanup has passed TypeScript, targeted lint/formatting,
the existing transaction browser check, and 110 unit / 3 integration suites
(475 / 21 tests). No tenant migration has been applied.
