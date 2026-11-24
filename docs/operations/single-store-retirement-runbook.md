# Single-store retirement release ledger

Approved scope: [single-store retirement design](../superpowers/specs/2026-11-23-single-store-retirement-design.md).
This ledger separates local evidence from the environment-specific evidence required before release.

## Report-only database preflight

Inject the deliberately selected PostgreSQL URL into `SINGLE_STORE_DATABASE_URL`
using the environment's secret manager. The executable does not load `.env` or
fall back to application database variables. Keep credentials out of shell
arguments, logs, reports and Git.

```powershell
node scripts/single-store/preflight.mjs --baseline-through 20260922120000
$LASTEXITCODE
```

The URL must name the host and database explicitly. Prefer the direct PostgreSQL
endpoint and a trusted inspection identity with full table visibility. The
transaction uses `REPEATABLE READ READ ONLY`, a 15-second statement timeout,
3-second lock timeout, `row_security = off`, and `search_path = pg_catalog`.
Setting row security off makes an RLS-filtered read fail rather than silently
count a restricted subset; it does not grant bypass privileges. Every completed
run rolls back. It never applies SQL migrations, creates settings, selects a
default tenant, changes ownership, claims jobs, or reconciles payments.

`--baseline-through` must be a migration version in the Git `HEAD` tree. The
default compares every committed migration in `HEAD`. A cutoff compares the exact
committed version set through that release boundary; recorded versions outside
that set still block. Uncommitted migrations do not become an assumed baseline.
Run from a reviewed commit with the intended release boundary. Migration versions
are checked, not historical file-content checksums or proof that each recorded
statement was executed correctly.

The JSON contains only counts, fixed check identifiers, expected schema names,
and committed missing versions. It omits URLs, owner/row IDs, canonical labels,
customer data, raw errors, routine bodies, policy expressions and provider data.
Missing or denied checks are `null` with a blocker, never a reassuring zero.
Safe checks continue when the baseline or an individual object is missing.

| Exit | Meaning                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `0`  | The requested baseline, retained inventory and data checks have no blockers. This alone does not authorize a release.  |
| `1`  | A complete or partial diagnostic report has blockers requiring review.                                                 |
| `2`  | Invalid input or a connection/transaction failure prevented the report. Only a fixed, sanitized error code is emitted. |

### Checks and their limits

- Verify all 20 expected tenant-bearing tables plus the tenant identity table,
  required query columns and types. Extra tenant-bearing public relations,
  missing objects and incompatible columns block. Platform schemas remain untouched.
- Count every retained tenant reference, including nullable/global rows, distinct
  owners and unregistered owner rows. Require exactly one tenant identity and no
  independent or unregistered business owner. No arbitrary first-owner selection occurs.
- Count collision groups and participating rows for the store-wide keys below.
  No identity, SKU, amount or taxonomy reference is rewritten.
- Count store settings and distinct business configurations. Zero rows remain
  observable for the later explicit-default initialization. More than one row
  blocks; differing configurations add an independent conflict blocker.
- Inventory public/storage policies, tenant-dependent ordinary/trigger routines,
  triggers and tenant-column update lists, RLS and effective routine/table ACLs
  for `anon`, `authenticated` and `service_role`. Dependency detection uses
  conservative catalog text matching. Counts neither prove authorization behavior
  nor discover every possible dynamic/external dependency.
- Count pending/review orders, expired pending orders, active/expired reservations,
  pending/failed/processing/sent notification jobs and due/stale work, pending
  refunds and nonfinal disputes. These are rollout evidence, not automatic
  blockers or permission to cancel, release stock, retry a charge or delete a job.

| Collision check        | Key semantics after removing tenancy                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `variant_sku`          | Exact non-null SKU                                                                                                                     |
| `variant_product_size` | Product ID and non-null size ID; protects existing product/size uniqueness                                                             |
| `featured_product`     | Product ID                                                                                                                             |
| `shipping_category`    | Exact category                                                                                                                         |
| `brand_name`           | `lower(canonical_label)`                                                                                                               |
| `model_within_brand`   | Parent brand's `lower(canonical_label)` and model's `lower(canonical_label)`; detects separate brand IDs with the same canonical brand |
| `alias_value`          | Entity type and exact stored `alias_normalized`                                                                                        |
| `size_name`            | Size type and `lower(canonical_label)`                                                                                                 |
| `sales_period`         | Exact state code, year and month                                                                                                       |

Whitespace trimming or further case normalization is not added to stored keys.
Any broader renormalization or mapping needs a separate reviewed data-preserving
decision. Collision reports stop the rollout; they do not merge or discard rows.

## Isolated SQL regression tests

Select an unused disposable database URL in
`SINGLE_STORE_TEST_DATABASE_URL`, then run:

```powershell
node --test tests/database/single-store-preflight.test.mjs
```

The harness refuses non-PostgreSQL URLs, nonloopback hosts, ports other than
`64332`, URL options and database names outside `single_store_test_[a-z0-9_]+`.
It connects to the local `postgres` maintenance database only to create/drop
that explicitly named database from `template0`. An existing database is never
overwritten or forcibly dropped. Tests use minimal independent fixture tables,
real queries and the actual CLI, then drop only their own database. These tests
prove preflight behavior and unchanged fixture data/registry, not full migration
replay, provider behavior or the application's authorization matrix.

## Evidence recorded November 23, 2026

Both inspections below targeted only the local `supabase_db_solesneakers`
container at loopback port `64332`, through baseline `20260922120000`.
The preflight made read-only queries on both databases.

| Evidence                                                                                               | Ordinary `postgres`                | Aligned disposable `single_store_test_populated_20261123` |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| Preflight exit/readiness                                                                               | `1` / blocked                      | `0` / no preflight blockers                               |
| Recorded / expected migrations                                                                         | 103 / 105                          | 105 / 105                                                 |
| Missing committed versions                                                                             | `20260918180000`, `20260919090000` | 0                                                         |
| Tenant-bearing tables / unexpected legacy tables                                                       | 29 / 9                             | 20 / 0                                                    |
| Missing or incompatible required columns                                                               | 0                                  | 0                                                         |
| Tenant identities / distinct business owners / unregistered owner rows                                 | 1 / 1 / 0                          | 1 / 1 / 0                                                 |
| Nullable/global business rows                                                                          | 428                                | 428                                                       |
| Collision groups across all nine checks                                                                | 0                                  | 0                                                         |
| Store settings rows                                                                                    | 0                                  | 0                                                         |
| Orders / pending / review-or-blocked-or-payment/refund-pending                                         | 3 / 0 / 0                          | 3 / 0 / 0                                                 |
| Reservations / active                                                                                  | 3 / 0                              | 3 / 0                                                     |
| Outbox rows / sent / pending-or-failed-or-processing                                                   | 4 / 4 / 0                          | 4 / 4 / 0                                                 |
| Tenant-dependent ordinary routines / trigger functions                                                 | 9 / 6                              | 9 / 6                                                     |
| Tenant-dependent policies                                                                              | 25                                 | 18                                                        |
| Public policies / storage policies                                                                     | 74 / 0                             | 58 / 0                                                    |
| Noninternal public triggers / tenant-dependent trigger functions attached / tenant-column update lists | 26 / 6 / 1                         | 23 / 6 / 1                                                |
| Public-executable routines                                                                             | 24                                 | 18                                                        |

The aligned copy was prepared by the controller's separately recorded rehearsal.
This preflight task did not apply either missing migration to the ordinary local
database. Do not automatically apply historical retirement migrations: preserve
their payment-link and data-retirement prerequisites. Do not regenerate current
types from the ordinary database while it retains the retired schema.

Focused validation: 13 real PostgreSQL tests passed, including unexpected owners,
global records, canonical collisions, original key semantics, settings cardinality,
unknown schema, baseline gaps, continued diagnostics, sanitized CLI exit behavior
and unchanged fixture rows/registry. Full application, RLS, migration replay and
provider evidence remain separate verification work.

The controller also completed a baseline rehearsal in separate local disposable
databases: all 105 committed application migrations replayed successfully over
empty application schemas after restoring only the Supabase platform schemas.
A full populated backup restored successfully with original owners and ACLs;
only the two missing committed migrations were then applied to that copy. Their
existing legacy Square-link guard remained active and passed with zero
outstanding links. The ordinary database was unchanged. This verifies the local
baseline replay and restoration, not staging/production backups, the forthcoming
expansion, or provider recovery. Neither historical destructive resets nor
retirement migrations were replayed over the ordinary populated database.

Nine actual routine-entry probes also ran inside a read-only transaction in the
aligned copy: `anon` and `authenticated` were denied all three reservation
functions; `service_role` reached the public entry point and was denied both
internal helpers. This confirms baseline entry permissions, not the full RLS
matrix, concurrent stock behavior, or the forthcoming overload's permissions.

During reader implementation, the existing isolated browser checks
`checkout-progress.mjs`, `shipping-validation.mjs`, and `checkout-success.mjs`
passed. They cover confirmation continuity, address review/edit/cancel, changed
totals, duplicate clicks, wallet continuation, express bypass, and guest-token
receipt recovery. They use fixtures and do not prove deployed or real-provider
behavior.

## Release gates

The staging and production migrate jobs now run
`scripts/single-store/check-migration-baseline.mjs` before either `supabase db push`
command. Each job installs the pinned Node runtime and dependencies with
`npm ci --ignore-scripts` before fetching deployment secrets. The gate receives
an explicit `SINGLE_STORE_DATABASE_URL` assigned from `SUPABASE_DB_URL`; it never
prints the URL, credentials, or raw connection errors.

The gate requires all 105 historical migrations through `20260922120000`, then
checks that recorded versions form a gap-free prefix of the current committed
HEAD manifest. Unknown versions, missing historical versions, and later prefix
gaps always stop deployment before any pending SQL runs. While compatibility
expansion `20261123120000` is unrecorded, the gate also runs the read-only
schema/ownership/canonical/settings preflight at the latest recorded known
version; those expansion blockers stop migration application. A guard inside the expansion alone
would run after earlier pending historical retirement SQL and cannot provide this
protection. Preserve those historical migrations' existing prerequisites;
resolve baseline alignment through its separately reviewed procedure.

After compatibility expansion is recorded, the gate checks only the historical
baseline and known gap-free migration prefix. It explicitly reports
`expansionPreflight.status = "skipped"`, reason
`compatibility_expansion_already_recorded`, and `preflight = null`. A ready gate
in this state certifies migration-registry eligibility only; current global data
readiness is not assessed. Legacy-valid global/owned taxonomy collisions therefore
do not block unrelated app-only hotfixes or later known pending suffix migrations.
No permanent data gate is imposed after expansion. Use the standalone report-only
preflight when current data evidence is needed. The expansion's transactional
guard remains unchanged, and contraction needs its own separately reviewed data
checks and release gate; the skipped expansion check does not approve contraction.

The expansion migration is
`20261123120000_single_store_compatibility.sql`. Its new reservation overload
omits `p_tenant_id` and delegates to the unchanged 20-argument service-only entry.
The internal reservation helpers and `_single_store_compat_owner()` remain
owner-only. `get_store_access_settings()` and
`upsert_store_access_settings(boolean,timestamptz,boolean,text)` are service-only;
application staff/MFA checks remain necessary. Missing settings return the
current explicit application defaults without inserting a row. An existing
configuration retains every stored field. No anonymous settings view is added.
`accept_tag_candidate(uuid,text)` already has a tenant-free signature and retains
its existing internal authorization and effective permissions.

No existing table, column, routine, policy, trigger, row, configured value, or
NULL/global taxonomy record is removed or rewritten by expansion. A schema with
zero owners and no owned rows can replay the DDL; compatibility calls fail closed
until a real single owner exists. There is no synthetic owner. Direct-insert
compatibility bridges are deferred to the application cutover, where each actual
writer must receive its own tested bridge while preserving nullable/global
records. Current application callers keep the old RPC contract, so generated
types are deferred until cutover and must be generated from the verified
expanded disposable database.

For aggregate expansion/ACL verification, explicitly supply the environment's
database URL and run `node scripts/single-store/verify-expansion.mjs`. Capture its
JSON before expansion, then run it after expansion with `--compare <prior.json>`
to check retained row counts and non-tenant row fingerprints alongside the exact
old/new function permissions. A before-expansion report exits 1 because the new
contracts are absent, while still producing the preservation snapshot. The
fingerprints include all public-table data: stock, financial facts, snapshots,
taxonomy references, image URLs, audit evidence and durable jobs. Run the
comparison with writes quiesced; a changed fingerprint requires investigation.
This read-only catalog check complements real SQL behavior tests and does not
prove staging/provider behavior or authorize a deployment.

PostgREST requires a schema-cache refresh after function changes, and RPC
dispatch uses the supplied parameter names. See its official
[Functions as RPC guidance](https://docs.postgrest.org/en/stable/references/api/functions.html)
and [schema-cache guidance](https://docs.postgrest.org/en/stable/references/schema_cache.html).
Read-only local inspection found enabled `pgrst_ddl_watch` and `pgrst_drop_watch`
event triggers emitting `pgrst` NOTIFY. Staging acceptance still requires real
old/new reservation RPC calls through the Supabase/PostgREST API after verifying
cache refresh: the old named argument set includes required `p_tenant_id`; the
new set omits it. Direct PostgreSQL tests do not prove HTTP overload dispatch or
the running API's cache state. This API acceptance evidence is separate from
Square/Afterpay payment and webhook/provider evidence.

| Release                        | Status and gate                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight / baseline rehearsal | Local preflight implemented and tested. Ordinary local baseline remains blocked. Aligned populated-copy preflight has no blockers. Staging/production evidence is unknown.                                                                                          |
| Expand compatibility           | Additive migration and workflow preflight implemented and independently reviewed. Local replay, populated-copy preservation, old/new SQL permissions, stock contention and committed-version gate regressions passed. Environment-specific rollout remains pending. |
| Application cutover            | Dual readers implemented and locally verified; deploy them everywhere before new producers. Tenant-free application writers, insert bridges, privacy-safe contract activity counts, Redis counter migration and real provider evidence remain pending.              |
| Contract                       | Pending proof that old callers/writers are gone, old contracts expired or resolved, ambiguous payments reconciled, jobs preserved and the full 24-hour counter window observed after the last old writer. Zero pending counts alone are insufficient.               |
| Production                     | Requires separately authorized cutover, environment-specific preflight, verified backup/restore, migration-before-application workflow sequencing, the oldest compatible rollback release and operational/provider evidence.                                        |

Run and retain a new report for each environment and release boundary. The
preflight does not inspect Redis, server lifetimes, browser contracts, deployment
state, backups or providers. Preserve administrator/MFA guards, customer/guest
ownership, payment authority, inventory atomicity, financial snapshots/history,
durable notification evidence and existing image URLs through later releases.
