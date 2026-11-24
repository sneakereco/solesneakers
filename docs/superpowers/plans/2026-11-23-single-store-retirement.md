# Single-store retirement implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task.

**Goal:** Retire the application tenant model without losing purchases, data, authorization, or protection state.
**Architecture:** Deliver compatibility, tenant-free application, and contraction as separate releases. Existing framework routes remain adapters; new feature code follows Modules/<Module>/Source/Features with module-owned Tests.
**Tech Stack:** Next.js 16, TypeScript, Supabase PostgreSQL, Upstash Redis, Jest, local Docker.
**Spec:** ../specs/2026-11-23-single-store-retirement-design.md (approved November 23, 2026).

## Global Constraints

- Preserve customer/guest ownership, admin/super_admin/dev checks, MFA, stock transactions, Square authority, payment idempotency, durable notifications, snapshots, and existing image URLs.
- Never use a permanent default tenant, broaden database permissions, discard conflicting records, modify historical migrations, or use DROP CASCADE.
- No writes to ordinary local, staging, or production databases. Disposable local test databases may be created and removed explicitly; refuse other targets.
- Keep compatibility and contraction out of the same automatically applied migration batch.
- Compatibility readers must precede new producers. Existing producers remain legacy in the first release.
- Contract only after deployed-version, transient expiry, ambiguous-payment reconciliation, counter continuity, backup, and external-caller evidence. Production cutover requires separate authorization.
- Preserve pre-existing icon deletion and unrelated Black Friday documents. Keep work in this existing ongoing branch; do not commit or move unrelated work.
- New tests must exercise behavior through interfaces. Label SQL-text, isolated browser, real local database, staging, and provider evidence accurately.

## Review Focus

Check fail-closed ownership/collision discovery across every retained table, not only profiles. Check effective PostgreSQL grants and overload resolution, SECURITY DEFINER identity and search_path, unchanged old callers, future contract version confusion, exact amount/cart/device/email/order bindings, single-use permits, and no new producers in the compatibility release. Check deployment separation and honest remaining gates.

---

### Task 1: Executable preflight and release ledger

**Files:** scripts/single-store/preflight.mjs; scripts/single-store/preflight.sql; tests for the preflight; docs/operations/single-store-retirement-runbook.md.
**Interfaces:** Consumes an explicit PostgreSQL connection URL. Produces aggregate JSON and a nonzero exit for unknown baseline, multiple owners, canonical collisions, or conflicting store settings. No credentials, row values, customer data, or provider payloads in output.

- [x] Write a behavioral test against a disposable database/transaction showing unexpected ownership and normalized collisions are blockers; run it and see the missing implementation fail.
- [x] Implement an explicit read-only repeatable-read transaction with a statement timeout. Verify the exact retained-table inventory and committed migration versions. Include all retained tenant references (including nullable/global records), normalized unique keys, singleton configuration count, routine/policy/trigger/ACL inventories, and pending order/outbox aggregate counts. Known missing historical retirement migrations block readiness.
- [x] Make the executable report-only: no migration application, baseline repair, or arbitrary owner selection.
- [x] Run focused tests and local read-only preflight; expected: the known two missing baseline migrations block the ordinary local database.
- [x] Document commands, evidence meaning, and environment gates. Record the result in the ledger; no commit required in this dirty shared branch.

### Task 2: Reader compatibility release

**Files:** src/lib/checkout/payment-permit.ts; shipping-address-confirmation.ts; checkout-cart-hash.ts; prepare-checkout.ts; create-direct-payment.ts; payment-api-dependencies.ts; affected unit tests; a private compatibility adapter if needed.
**Interfaces:** Preserve existing producers and legacy public interfaces in release 1. Add explicit tenant-free versioned payload readers with binding validation. Later tenant-free callers will use the new normal interfaces; transitional tenancy stays private.

- [x] Write failing behavioral tests for an explicit v2 tenant-free permit, strict unknown-version rejection, single-use consumption, all existing payment binding checks, v2 shipping confirmations and tamper/expiry checks, and comparison of stored v3/v4 cart hashes without changing pending order hashes.
- [x] Implement the minimum dual-reader contracts. Keep legacy permit/address/hash generation as the production default; do not issue tenant-free payloads until all readers are deployed. Preserve old Redis keys and TTLs.
- [x] Run focused suites followed by the complete unit/integration suite. Expected: legacy behavior unchanged and explicit new contract fixtures accepted only with all bindings intact.
- [x] Record exact compatibility format and oldest compatible rollback version. No commit required here.

### Task 3: Additive database expansion

**Files:** supabase/migrations/<new timestamp>\_single_store_compatibility.sql; scripts/single-store/verify-expansion.mjs; scripts/single-store/check-migration-baseline.mjs; both deployment workflows; task-specific real-SQL fixtures/tests.
**Interfaces:** Add tenant-free reservation/taxonomy RPC overloads and temporary defaults/settings compatibility only when backed by a verified single existing owner. Retain old columns/signatures and effective grants for deployed callers. No contraction SQL in the migration directory.

- [x] Verify the actual latest committed routine signatures and privileges before choosing wrappers. Write real SQL tests that fail before expansion.
- [x] Gate both workflows before any migration application: always require the complete 105-migration historical baseline and a gap-free recorded prefix of the reviewed HEAD manifest. While compatibility expansion is unrecorded, run read-only schema/ownership/collision/settings preflight at that recorded boundary and retain the exact in-migration guard. After expansion is recorded, explicitly report those data checks skipped and assess only registry eligibility; do not claim current global data readiness or block unrelated app-only hotfixes/later known suffixes on legacy-valid collisions. A missing historical retirement migration must block in every state before db push could apply it. Contraction requires its own separately reviewed data/release gate.
- [x] Build expansion with explicit precondition assertions. Report/abort for unexpected independent owners/collisions, preserving data. Add temporary compatibility functions with restrictive grants and safe search paths; avoid granting internal reservation helpers to service_role.
- [x] Rehearse full committed baseline replay in a disposable database, respecting existing destructive-migration guards. Test expanded old/new RPCs, effective ACLs, settings defaults, and retained-data fingerprints.
- [x] Use populated-copy testing only on a disposable copy aligned to the complete baseline. Verify source database unchanged.
- [x] Record evidence, limitations, and release boundaries. If an existing historical baseline guard requires unavailable evidence, retain it and report the exact blocked rehearsal instead of fabricating prerequisites.

### Task 4: Tenant-free application release (after Task 3 deployed)

**Files:** identity, catalog/taxonomy, store access, checkout/pricing, notification/image adapters, seed, operational scripts, generated types, affected tests listed in the spec.
**Interfaces:** Remove normal tenant arguments and bootstrap. Use expanded database contracts. Explicitly enable new versioned producers only after compatibility release evidence.
**Gate:** All old-reader instances gone, confirmed environment counter namespace, atomic dual-check/dual-write counters verified for the mixed-writer window. This task cannot be enabled by a migration that runs before Task 2 deployment.

- [ ] Add behavioral tests for tenant-free identity/catalog/settings/checkout and preserved invariants; observe RED.
- [ ] Migrate callers and remove public tenant plumbing. Preserve pending order hashes/IDs, ownership and old image URLs; use new product-based paths only for new uploads.
- [ ] Add privacy-safe legacy/new contract activity counts and deployed-writer version evidence before enabling versioned producers. Enable stable application/environment counters with atomic old/new protection. Keep private bounded compatibility.
- [ ] Validate full tests, browsers, real SQL/RLS/stock contention, and staging/provider journeys. Regenerate types from the correct schema.

### Task 5: Contraction release (after observed compatibility exit)

**Files:** a separately released forward migration, final generated types, compatibility adapter removals, current-schema seed/RLS/scripts.
**Interfaces:** No application tenant selector/bootstrap/argument, 20 tenant columns removed, tenants removed, store_access_settings singleton, global canonical keys.
**Gate:** Deployment/external caller inventory, restorable backup, full 24h after last legacy counter writer, all old transient contracts/pending purchases/jobs resolved. Time alone does not clear ambiguous payments.

- [ ] Write preservation, collision-abort, zero/one/conflicting settings, authorization matrix, routine ACL and real concurrency tests.
- [ ] Author restrictive explicit migration and remove bounded compatibility. Keep contraction outside automatic migration batches until the gate is satisfied.
- [ ] Compare retained IDs/non-tenant fingerprints/financial sums/URLs/jobs before and after; replay schema and populated copy; validate application and provider evidence.
- [ ] Final inventory and fresh branch review. Update architecture capability record, distinguishing code completion from deployed verification.

### Task 6: Review and release checkpoint

- [x] Independent review of the executable compatibility change against the approved design and Review Focus.
- [x] Fix important findings with behavioral regression tests, run TypeScript/lint/format/tests, and record exact evidence.
- [x] Stop at the first real rollout gate with a concrete reviewable compatibility release, not a destructive simulation of a deployed cutover. No production deployment or broad migration application is authorized by design approval alone.
