# Dead Code and Database Retirement Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Use `superpowers:subagent-driven-development` only if the user selects delegated execution. Steps use checkboxes for tracking.

**Goal:** Remove the audited dead application code and retired database objects while preserving current storefront, authentication, checkout, fulfillment, notifications, and tenant isolation.

**Architecture:** Use two releases: A removes application dependencies while remaining compatible with the pre-retirement database; B applies explicit forward-only schema cleanup after A is verified in each environment. Both workflows currently run migrations before deploying code, so destructive cleanup must not be included in release A. Keep active RPC signatures and public behavior stable where they are not being retired.

**Tech Stack:** Next.js 16.3.3, React 19, TypeScript, Supabase/PostgreSQL 17, Square, Shippo, Jest, existing Node/browser/SQL checks. Node version follows package.json `^24.14.1`; current mise.toml selects 24.14.1. No new package is needed.

**Spec:** The two audits from this conversation, the user's confirmation that all five conditional feature groups can retire, and the manifests in this document. Source evidence is in the [code audit](C:/Users/dsrus/.codex/visualizations/2026/09/18/01a0b5ab-fd1e-78e1-998e-4d86b0e945c7/dead-code-audit.md) and [database audit](C:/Users/dsrus/.codex/visualizations/2026/09/18/01a0b5ab-fd1e-78e1-998e-4d86b0e945c7/database-retirement-audit.md). The manifests below make execution independent of those machine-local reports.

**Status:** Inline execution in progress. Release A source changes and Release B schema changes are implemented and locally verified on separate branches; remote rollout and provider retirement gates remain pending. Release B was prepared ahead of rollout in its isolated branch so the complete change is reviewable, and must remain off main until A is deployed to both environments. See `docs/operations/dead-code-retirement.md` for evidence. Baseline audit commit: `25c53b3fc5661eec2d3f260603c948473c98e92f`. Recheck references at execution time.

## Execution checkpoints

| Tasks                                  | State                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1: isolate and refresh baseline        | Done; production backlog identified, baseline rollout pending                            |
| 2–5: remove application dependencies   | Code complete and locally verified; remaining provider link retirement is a release gate |
| 6: release A rollout                   | Local verification done; staging/production deployment pending                           |
| 7–8: schema migration and verification | Prepared on separate release B branch; clone and full replay checks passed               |
| 9: release B rollout/configuration     | Pending release A deployments, recoverable backups and reviewed rollout                  |

## Global constraints

- Preserve unrelated work, including the existing `mist.toml` deletion and untracked `mise.toml`; isolate implementation using a `codex/` worktree and commit only scoped changes.
- Read relevant installed Next.js guides under `node_modules/next/dist/docs/` before modifying routes/components. Use CodeGraph first where `.codegraph/` exists, then targeted reference searches.
- Do not rewrite applied migrations, reset any existing database, edit generated types by hand, or use blanket `CASCADE`. Drop only enumerated objects with explicit dependencies handled first.
- Do not remove security validation, current Square card/Apple Pay/Cash App Pay/Afterpay behavior, required billing/pickup information, notification retries, or authorization helpers. Keep existing dependencies unless a new reachability scan proves a dependency becomes unused.
- Local checks, remote CI, deployed app behavior, and provider verification are separate evidence. A local pass does not satisfy a remote release gate. Remote migrations/releases require a concrete reviewed change set; prior retirement confirmation need not be requested again.

## Scope decisions

| Include                                                                                                                                                         | Keep outside this cleanup                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 22 unreachable files; 2 test-only implementations; 33 uncalled methods; smaller helpers/types/CSS and CI fixtures                                               | Active internal helpers merely flagged as unused exports; all currently used dependencies                                                                     |
| Cart snapshot/restore endpoints; Google OAuth button/client/callback; old Square hosted-link adapter and fields; saved billing-address store; checkout API logs | Cart validation/local cart persistence; email/password/OTP/MFA/recovery; Supabase auth infrastructure; order_billing                                          |
| Eight additional disconnected tables; payment_events and shipping_tracking_events after removing their readers                                                  | state_sales_tracking and its active order trigger, as confirmed by the user; profiles.is_primary_admin and its security guard; broad RLS policy consolidation |
| Nine smaller column candidates; three hosted-link columns; legacy RPCs; redundant timestamp triggers/indexes; empty images bucket                               | products storage; audit/notification/webhook tables still used; live reservation wrapper chain and both consume overloads                                     |
| Existing marketing-retirement migration applied where pending                                                                                                   | New duplicate marketing-removal migration; deletion of historical migrations/tests merely because they document an old schema                                 |

The user confirmed that state sales tracking and its active order trigger must stay.

## Release map and estimates

| Phase | Deliverable                                                          | Working estimate                     | Gate                                                                  |
| ----- | -------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| 1     | Updated baseline and exact removal manifests                         | 20–40 minutes                        | Environment/checkout identity verified                                |
| 2     | Release A: source and feature retirement, compatible with old schema | 120–180 minutes                      | Targeted checks and full local checks pass                            |
| 3     | Release A verified in staging and production                         | 30–60 minutes plus deployment queues | Each environment demonstrably runs A before its destructive migration |
| 4     | Release B: schema cleanup and updated generated types                | 90–150 minutes                       | Migration plus behavior checks pass on local/disposable copies        |
| 5     | Release B rollout, catalog verification, storage/config retirement   | 30–60 minutes plus deployment queues | Live retained flows and removed-object inventory verified             |

Estimated engineering time: 290–490 minutes, excluding user review, provider availability and deployment queues. These are estimates, not guarantees.

## Phase 1 — Establish the execution baseline

### Task 1: Isolate work and refresh environment evidence

**Files:** Inspect `AGENTS.md`, `package.json`, `.github/workflows/staging.yml`, `.github/workflows/production.yml`, `vercel.json`, and current migration filenames. No application edits in this task.

**Consumes:** This plan and current checkout. **Produces:** Recorded starting SHA, environment migration lists, deployment SHAs, scoped worktree, and refreshed inventories.

- [x] Create an isolated worktree following the using-git-worktrees skill; preserve the main checkout's unrelated edits. Record `git status --short`, `git rev-parse HEAD`, and runtime versions.
- [x] Re-run Knip 6.37.0 in normal and production modes and check callers of the manifest entries. Treat new callers as a reason to adjust that entry, not as authorization to remove the new behavior.
- [ ] Inspect current local/stg/prd catalogs in read-only transactions and match each endpoint to its environment without printing credentials. Recheck migration versions, legacy hosted-link rows, inbound dependencies and proposed-retirement row counts. Record backup/restore capability before any later destructive rollout.
- [ ] Verify deployed revisions. The prior audit found local at 20260918140000, staging at 20260918180000, production at 20260723090000 (16 behind staging). Treat those as previous observations. Reconcile production's existing migration backlog as a separate baseline release before cleanup; do not blindly apply it to an unknown older app. The existing marketing migration itself requires the marketing-free app to be deployed first; stage that historical cutover if needed.
- [x] Confirm the two-release gate: release A contains no new drop migration; release B cannot merge to auto-deploying main until A has been deployed to both environments. Record a reviewer checkpoint for each release; no new scheduling/automation system is needed.

Read-only discovery SQL:

```sql
begin read only;
select version from supabase_migrations.schema_migrations order by version;
select n.nspname, c.relname, c.relkind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p','v','m');
select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public';
rollback;
```

Commands:

```powershell
npx --yes knip@6.37.0 --no-progress --reporter json
npx --yes knip@6.37.0 --production --no-progress --reporter json
```

**Done when:** The audit baseline is refreshed; no databases or unrelated source files changed.

## Phase 2 — Release A: remove application dependencies

### Task 2: Remove isolated files, dead methods and small unused contracts

**Files:** Exact deletion and method manifests in Appendices A/B; modify `src/components/admin/AdminPage.tsx`, `src/lib/utils/crypto.ts`, `src/lib/checkout/idempotency.ts`, `src/lib/checkout/guest-shipping-address.ts`, `src/types/domain/checkout.ts`, `src/config/constants/roles.ts`, `src/styles/site.css`, `.github/workflows/ci.yml`.

**Consumes:** Verified manifest. **Produces:** Identical active behavior with smaller source surface; old database remains supported.

- [x] Delete the 22 files in Appendix A; remove the commented SocialButton import from RegisterForm. Do not delete shared ModalPortal, CartDrawer, CheckoutAddressReview or OrderItemDetailsModal.
- [x] Remove exactly the 33 methods in Appendix B and newly unused local types/imports. Retain whole repositories and all still-called methods. For example, ProfileRepository.setRole remains required by admin invitations.
- [x] Remove AdminSectionHeader, createCartHash/CartItemLike, unused idempotency and guest-address getters/setters, obsolete checkout request/response types and payment-method list. Keep generateIdempotencyKey, clear storage compatibility functions, OrderStatusResponse and its FulfillmentMethod type. Remove isSuperAdminRole/SUPER_ADMIN_ROLES only after AdminService is gone; retain live role/permission checks.
- [x] Remove `.rdk-toggle` CSS with ToggleSwitch and the two Lightspeed CI fixture variables. Keep `.rdk-checkbox`, used by StoreAccessSettingsPanel. Narrow export visibility only where obvious; do not delete active same-file helpers flagged by Knip.
- [x] Run typecheck/lint and targeted cart/orders/addresses tests. Make one scoped commit, `refactor: remove unreachable source and unused repository methods`, excluding unrelated files. No new deletion-only tests are necessary.

```powershell
npm run typecheck
npm run lint
npm run test:jest:unit -- --runInBand --runTestsByPath tests/unit/orders-repo.test.ts tests/unit/addresses-repo.test.ts tests/unit/cart-validate-route.test.ts tests/unit/cart-drawer.test.tsx
```

### Task 3: Retire test-only implementations without losing useful coverage

**Delete:** `src/components/shared/AddressInput.tsx`, `src/components/checkout/square-card-initialization.ts`.

**Modify/test:** `src/components/ui/hydration.test.tsx`, `tests/unit/square-payment-methods.test.tsx`, `tests/browser/payment-methods.mjs`.

**Consumes:** Current SquarePaymentMethods initialization path. **Produces:** A regression check that exercises production card initialization, rather than its unused old helper.

- [x] Remove the AddressInput import and its single obsolete rendering test. Keep the ModalPortal test in that file.
- [x] Replace the initializeSquareCard-only assertion with a failure case through the actual SquarePaymentMethods initialization path: stub `payments.card()` to reject or card.attach() to reject, render/drive the existing browser harness, and assert usable error/retry state and no payment submission. Reuse harness mocks; do not extract a new abstraction solely to keep the old test shape.
- [x] Establish that the replacement assertion fails when the production failure handling is deliberately disabled locally, then restore it. No provider request is sent; this is a controlled mocked browser check.
- [x] Delete the unused helper and its import, run the unit/browser checks below, and confirm successful card initialization and other method initialization remain covered.
- [x] Commit as `test: cover live card initialization and remove obsolete implementations`.

```powershell
npm run test:jest:unit -- --runInBand --runTestsByPath src/components/ui/hydration.test.tsx tests/unit/square-payment-methods.test.tsx
node tests/browser/payment-methods.mjs
```

### Task 4: Remove retired route and admin readers

**Delete:** `src/app/api/cart/snapshot/route.ts`, `src/app/api/cart/restore/route.ts`, `src/lib/cart/snapshot.ts`, `src/app/api/auth/callback/route.ts` (the approved Google callback).

**Modify:** `src/lib/validation/cart.ts`, `src/app/api/admin/transactions/[orderId]/route.ts`, `src/app/admin/transactions/[orderId]/page.tsx`, `tests/browser/admin-transaction-detail.mjs`, and test fixtures that still include retired response properties. The snapshot service, SocialButton and browser Supabase client were deleted in Task 2.

**Consumes:** Approved feature retirements. **Produces:** No runtime reads of checkout_api_logs, payment_events or shipping_tracking_events; retained admin payment/refund/dispute/email/fulfillment display.

- [x] Delete snapshot/restore routes and helper; remove cartSnapshotSchema while retaining cartValidateSchema and `/api/cart/validate`. Remove the Google-only callback; verify repository email signup, OTP and recovery use their existing code-verification routes rather than that callback.
- [x] Remove checkout-log and legacy shipping-event queries plus their response types/state/rendering. Remove the legacy payment_events query but keep the `paymentEvents` response populated from existing Square refund/dispute lifecycle records so the live timeline continues to work.
- [x] Adjust the existing admin browser fixture: no retired tables/properties; assert payment details, Square refund/dispute activity, email history and shipment fields remain visible. Verify no query to retired stores is made in route-level coverage; reuse existing unit harness where possible.
- [ ] Run the admin browser check and cart/checkout unit checks. In the built app, confirm retired routes are no longer registered and normal signup/login/OTP/MFA/password recovery/cart flows still work; a generic framework 404 is sufficient, with no new tombstone-route abstraction.
- [x] Commit as `refactor: retire disconnected cart auth and admin event paths`. Database tables still exist at this release stage.

```powershell
node tests/browser/admin-transaction-detail.mjs
npm run test:jest:unit -- --runInBand --runTestsByPath tests/unit/cart-validate-route.test.ts tests/unit/cart-checkout.test.tsx tests/unit/checkout-api-routes.test.ts
```

### Task 5: Retire hosted-link compatibility while preserving expiration safety

**Delete:** `src/lib/square/payment-links.ts`, `tests/unit/square-payment-links.test.ts`.

**Modify:** `src/lib/square/client.ts`, `src/repositories/checkout-reservation-repo.ts`, `src/lib/checkout/prepare-checkout.ts`, `src/lib/checkout/expire-checkout-reservations.ts`, `src/app/api/cron/expire-checkouts/route.ts`, associated checkout reservation/prepare/expiration/API fixtures.

**Consumes:** User-approved historical hosted-link retirement, verified legacy data/provider disposition. **Produces:** Direct-order-only expiration and no app selection of hosted-link columns.

- [ ] Before removing the adapter, inventory remaining provider link IDs and linked reservations, retire the confirmed obsolete hosted links through Square, and record successful deletion using the existing path. Resolve paid/reconciliation cases before releasing stock. Do not invent deletion timestamps or automatically release paid/ambiguous reservations. Preserve a restricted record of the retired IDs before dropping their columns.
- [x] Remove createSquarePaymentLinksGateway and markPaymentLinkDeleted, all link-only schemas/mappings/select columns, and the two legacy response properties from reserve/prepare. Release A must tolerate extra JSON fields still returned by the old reservation SQL without requiring them.
- [x] Simplify ExpiredCheckout and expiration dependencies as shown below. Keep getCancellationState, safe cancellation using the latest version, release-once semantics, and reporting failures. Existing direct-order cancellation/reconciliation tests must stay; replace only hosted-link tests.
- [x] Verify release A against the old schema after legacy links are retired: new unpaid direct order cancels then releases; paid, unrecognized, or provider-error cases do not release; never-attached reservations can release. If an order has a Square ID but lacks cancellation evidence/version, fail closed and reconcile rather than assuming it is safe to release.
- [x] Run relevant checks and commit as `refactor: retire hosted payment link compatibility`.

Target contract:

```typescript
export type ExpiredCheckout = {
  orderId: string;
  squareOrderId: string | null;
  squareOrderVersion: number | null;
};
// Remove only deleteSquareLink and markSquareLinkDeleted from ExpireCheckoutDependencies.
// Retain getSquareOrder, cancelSquareOrder, releaseReservation and reportError.
```

Retained behavior assertions in `tests/unit/expire-checkout-reservations.test.ts`:

```typescript
expect(cancelSquareOrder.mock.invocationCallOrder[0]).toBeLessThan(
  releaseReservation.mock.invocationCallOrder[0],
);
// In the paid/provider-failure test:
expect(releaseReservation).not.toHaveBeenCalled();
```

```powershell
npm run test:jest:unit -- --runInBand --runTestsByPath tests/unit/expire-checkout-reservations.test.ts tests/unit/checkout-reservation-repo.test.ts tests/unit/prepare-checkout.test.ts tests/unit/checkout-api-routes.test.ts
```

## Phase 3 — Verify and deploy release A before database contraction

### Task 6: Establish the compatibility release gate

**Files:** Release A commits and `docs/operations/checkout-validation.md` for release evidence. No new destructive migration in this release.

**Consumes:** Tasks 2–5 passing. **Produces:** Recorded release A commit/deployment evidence for staging and production.

- [x] Run formatting check, lint, typecheck, both Jest suites, browser suite, and production build. Use existing scripts; do not add a new test framework or broad snapshot suite.
- [x] Review the full diff, confirming deleted modules were not replaced with new abstractions and no package was removed without evidence. Re-run normal/production Knip and account for remaining framework/scripts/generated-types and same-file export findings.
- [ ] Deploy A to staging through the existing PR/main process. Verify `/api/readyz`, normal authentication, cart, direct checkout/expiration, admin transaction view and retained notification/fulfillment flows. Record provider sandbox evidence separately from local mocks.
- [ ] Deploy A to production only after the baseline work in Task 1 and staging verification. Record deployed commit, database migration baseline and smoke-test outcome. Do not create a production tag implicitly during planning or local implementation.
- [ ] Mark the contraction gate satisfied only when BOTH environments run A. Until then, keep B's drop migration off main. After B, the oldest rollback-compatible app is A; an older app would require schema/data restoration.

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:jest:unit -- --runInBand
npm run test:jest:integration -- --runInBand
npm run test:e2e
npm run build
npx --yes knip@6.37.0 --no-progress
```

## Phase 4 — Release B: explicit database contraction

### Task 7: Write and verify the forward cleanup migration

**Create:** `supabase/migrations/20260919090000_retire_unused_application_schema.sql` and `scripts/test-schema-retirement.mjs`. If execution occurs after a later migration is added, choose a new chronological filename before writing; do not move applied files.

**Modify:** `src/types/db/database.types.ts` through generation only, `supabase/config.toml` (remove images bucket declaration), existing SQL-check scripts only where they replay historical function bodies over the current schema, and `docs/operations/checkout-validation.md`.

**Consumes:** Appendices C/D and release A's no-legacy-reference contract. **Produces:** Enumerated retired schema removed; active function signatures/ACLs preserved; no current code relies on removed columns.

- [x] Implement the local-only `pg`/`node:assert` catalog check below. Run against the old schema first to establish the missing cleanup, then apply the migration to a disposable local database and verify. Extend/reuse existing transactional checkout scripts for reserve/reuse/release/consume and notification checks, and the RLS harness for tenant isolation. Do not run mutation tests on remote databases.
- [x] In the new migration, use complete current definitions to replace ONLY `reserve_square_checkout_inventory_with_address` (remove hosted-link keys from its reused response) and `release_square_checkout_reservation` (remove the retired hosted-link deletion prerequisite). Preserve every other guard, signature, SECURITY DEFINER/search_path setting and grant. Keep both wrapper functions and both consume overloads. Do not use blind text replacement against all migration history.
- [x] Drop the five named legacy RPCs, the sellers FK, 12 retired tables, 12 columns, redundant timestamp triggers and now-unreferenced trigger functions in dependency order. Drop three redundant indexes on kept tables; other redundant indexes disappear with their retired tables. Use the exact DDL inventory in Appendices C/D with transaction/lock timeout and no CASCADE. Existing marketing removal stays in its original migration.
- [x] Validate on local/disposable copies from both the current staging baseline and the recorded production baseline with its required prior migrations applied in order. Exercise first-time reserve and idempotent reuse after hosted-link fields are absent; PL/pgSQL can retain broken body references even when DROP succeeds. Compare retained tables' data counts/identities and successful schema replay. Do not reset the user's existing database.
- [x] Generate types from the migrated local test schema, update SQL harnesses to test current definitions rather than replay obsolete ones, run local checks, and commit as `refactor(db): retire unused application schema`.

The standalone rollback script must pin the project. The following runnable catalog check is its starting implementation; existing transactional checkout/RLS scripts provide the behavior checks listed in Task 8. Run this once before migration (expected assertion failure) and again on the migrated local test database (expected success). It does not install or replay migrations:

```javascript
import assert from "node:assert/strict";
import pg from "pg";
const connectionString = process.env.SUPABASE_DB_URL;
assert(connectionString, "Provide the local test database explicitly");
const target = new URL(connectionString);
assert(["127.0.0.1", "localhost"].includes(target.hostname));
assert.equal(target.port, "64332", "Sole Sneakers local database only");
const db = new pg.Client({ connectionString });
await db.connect();
try {
  await db.query("begin read only");
  await db.query("set local statement_timeout = '10s'");
  const retired = [
    "admin_audit_log",
    "chargeback_evidence",
    "nexus_registrations",
    "sellers",
    "tax_rate_cache",
    "tenant_checkout_settings",
    "tenant_tax_settings",
    "transaction_audit_log",
    "checkout_api_logs",
    "user_billing_addresses",
    "payment_events",
    "shipping_tracking_events",
  ];
  for (const table of retired) {
    const { rows } = await db.query("select to_regclass($1) as object", [
      `public.${table}`,
    ]);
    assert.equal(rows[0].object, null, `${table} must be retired`);
  }
  for (const table of [
    "orders",
    "order_billing",
    "payment_transactions",
    "state_sales_tracking",
  ]) {
    const { rows } = await db.query("select to_regclass($1) as object", [
      `public.${table}`,
    ]);
    assert.notEqual(rows[0].object, null, `${table} must remain`);
  }
  const columns = {
    orders: [
      "fee",
      "tax_transaction_id",
      "seller_id",
      "public_token",
      "square_payment_link_id",
      "square_payment_link_url",
      "square_payment_link_deleted_at",
    ],
    payment_transactions: ["card_bin", "three_ds_eci", "amount_refunded"],
    user_addresses: ["is_default"],
    square_webhook_events: ["processing_error"],
  };
  for (const [table, names] of Object.entries(columns)) {
    const { rows } = await db.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])`,
      [table, names],
    );
    assert.deepEqual(rows, [], `${table} still has retired columns`);
  }
  for (const signature of [
    "decrement_variant_stock(uuid,integer)",
    "increment_variant_stock(uuid,integer)",
    "mark_order_paid_and_decrement(uuid,text,jsonb)",
    "attach_square_payment_link(uuid,text,text,text,integer,integer,integer,text)",
    "mark_square_payment_link_deleted(uuid,text)",
  ]) {
    const { rows } = await db.query("select to_regprocedure($1) as object", [
      `public.${signature}`,
    ]);
    assert.equal(rows[0].object, null, `${signature} must be retired`);
  }
  console.log("Retirement catalog assertions passed");
} finally {
  await db.query("rollback").finally(() => db.end());
}
```

Catalog assertions are concrete, but not sufficient alone:

```sql
select to_regclass('public.checkout_api_logs') is null as retired;
select to_regclass('public.order_billing') is not null as retained;
select to_regprocedure('public.attach_square_payment_link(uuid,text,text,text,integer,integer,integer,text)') is null as retired_rpc;
select to_regprocedure('public.release_square_checkout_reservation(uuid,text)') is not null as retained_rpc;
```

Required local commands (set the environment explicitly because the existing RLS harness defaults to another project's port):

```powershell
$env:SUPABASE_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:64332/postgres'
$env:RLS_TEST_DB_URL = $env:SUPABASE_DB_URL
node scripts/test-schema-retirement.mjs
npm run test:rls
npm run gen:types
npm run typecheck
npm run test:jest:unit -- --runInBand
npm run test:jest:integration -- --runInBand
```

Existing local regression checks to preserve and run against the resulting schema: `scripts/test-checkout-pickup-contact.mjs`, `scripts/test-checkout-notification-delivery.mjs`, `scripts/test-square-payment-details.mjs`. If they install/redefine historical functions as part of setup, separate fixture setup from current-schema behavior; do not let the tests undo the cleanup inside their transaction and then claim they proved the final schema.

### Task 8: Verify migration behavior and the complete application

**Files:** `scripts/test-schema-retirement.mjs`, affected existing unit/browser checks, generated database types, and release evidence document.

**Consumes:** Migrated local schema and release A code. **Produces:** Reviewable release B diff plus local validation results.

- [x] Verify all retired objects are absent and retained RPC ACLs, RLS helpers/policies, billing/address tables, notification and webhook tables remain. Assert one updated_at trigger remains on each affected table and each retained unique index/constraint still exists.
- [x] In transactional fixtures, confirm stock changes once on reserve/retry/release; paid orders are not released; required billing/pickup data persists; tenant mismatch cannot access another tenant's data. Exercise both idempotent and first-time paths.
- [x] Run notification retry, Square payment-details replay, shipping-label and address checks. Confirm admin display still shows Square payments/refunds/disputes, email history, current tracking and order details.
- [x] Run the full commands from Task 6 again because the schema/types changed. Re-run Knip without forcing zero findings from legitimate framework/test entry points. Inspect generated-type differences to ensure they match only planned schema changes.
- [ ] Review the exact SQL and resulting data-impact counts, backup/restore procedure and release A compatibility gate before any remote apply. Record expected object absence and retained-flow checks as the rollout checklist.

## Phase 5 — Apply and verify release B

### Task 9: Staging, production, then external configuration cleanup

**Files:** Approved release B migration and `docs/operations/checkout-validation.md`. External changes limited to enumerated retired provider/storage configuration.

**Consumes:** Tasks 6–8 complete; reviewed migration and recoverability evidence. **Produces:** Matching intended live schemas with retained behavior verified.

- [ ] Recheck that each target runs A and migration history has not drifted. Take/verify recoverable backups and retain necessary historical rows before removal. A transaction rollback handles failed migration execution; after commit, rollback of deleted data requires a restore—not just a git revert.
- [ ] Merge/deploy B to staging through the existing workflow. Inspect the actual applied migration list, removed objects, retained constraints/RLS and `/api/readyz`; run staging checkout/admin/fulfillment/notification smoke tests. Do not continue to production on readiness alone.
- [ ] Release B to production only after staging evidence is accepted. Verify migration outcome and retained live behavior; record the deployed app SHA and database version. Keep production user data/provider operations separate from sandbox fixture tests.
- [ ] Delete the empty `images` bucket through Supabase Storage tooling after rechecking it is empty and the app uses `products`; never directly manipulate storage's internal tables. Remove Google-provider redirect/config entries only after verifying email/password/OTP recovery still works. Do not delete shared Supabase keys, auth users, or Square application credentials.
- [ ] Close the inventory: original dead-code candidates removed; approved feature routes removed; final catalogs agree with Appendices C/D; source still references no dropped objects; all remaining audit findings explicitly kept or explained. Commit only evidence/docs changes as `docs: record dead code and schema retirement verification`.

## Acceptance matrix

| Area                 | Required passing behavior                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storefront/cart/auth | Browse/product/cart operations, persistent cart and validation, signup/email verification/login/OTP/MFA/recovery work; retired snapshot and OAuth callback routes are absent |
| Checkout             | Current supported payment methods, ship/pickup, required billing, quote/prepare/pay, idempotency, cancellation and expiration preserve their contracts                       |
| Admin/fulfillment    | Product edits and stock, saved/default shipping address, transaction payment/refund/dispute details, label creation/tracking, email history still work                       |
| Database/security    | Enumerated objects gone; retained unique indexes, RPC grants, tenant RLS, anti-double-release/payment reconciliation and durable notifications still pass                    |
| Release evidence     | A preceded B in both environments; actual migration/deployment/provider outcomes recorded separately from local tests                                                        |

## Appendix A — Whole-file deletion manifest

All paths in appendices are repository-relative; the repository root is `C:/dev/projects/sneakereco/solesneakers`. Refresh references before deletion.

| File                                                              | Group                                          |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `src/config/ci-env.ts`                                            | Unreachable                                    |
| `src/services/admin-service.ts`                                   | Unreachable                                    |
| `src/services/cart-snapshot-service.ts`                           | Unreachable / approved cart retirement         |
| `src/services/tenant-context-service.ts`                          | Unreachable                                    |
| `src/lib/address/codes.ts`                                        | Unreachable                                    |
| `src/lib/checkout/log-checkout-event.ts`                          | Unreachable / approved logging retirement      |
| `src/lib/payments/card-brand.ts`                                  | Unreachable                                    |
| `src/lib/supabase/client.ts`                                      | Unreachable OAuth client                       |
| `src/components/cart/CartPeekDrawer.tsx`                          | Unreachable                                    |
| `src/components/checkout/ChevronPuller.tsx`                       | Unreachable                                    |
| `src/components/shared/AddressSuggestionModal.tsx`                | Unreachable                                    |
| `src/components/store/BackToStoreLink.tsx`                        | Unreachable                                    |
| `src/components/ui/Accordion.tsx`                                 | Unreachable                                    |
| `src/components/ui/Dialog.tsx`                                    | Unreachable                                    |
| `src/components/ui/Drawer.tsx`                                    | Unreachable                                    |
| `src/components/ui/ToggleSwitch.tsx`                              | Unreachable                                    |
| `src/components/ui/Tooltip.tsx`                                   | Unreachable                                    |
| `src/components/admin/inventory/InventoryProductDetailsModal.tsx` | Unreachable                                    |
| `src/components/auth/ui/AuthCard.tsx`                             | Unreachable                                    |
| `src/components/auth/ui/AuthLeftPanel.tsx`                        | Unreachable                                    |
| `src/components/auth/ui/Checkbox.tsx`                             | Unreachable                                    |
| `src/components/auth/ui/SocialButton.tsx`                         | Unreachable / approved Google login retirement |

The 22 above are distinct from these additional files removed with feature/test retirement:

| File                                                    | Gate                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/components/shared/AddressInput.tsx`                | Remove its obsolete hydration assertion; keep ModalPortal assertion |
| `src/components/checkout/square-card-initialization.ts` | Cover live SquarePaymentMethods failure handling first              |
| `src/app/api/cart/snapshot/route.ts`                    | Approved endpoint retirement                                        |
| `src/app/api/cart/restore/route.ts`                     | Approved endpoint retirement                                        |
| `src/lib/cart/snapshot.ts`                              | Both endpoints removed                                              |
| `src/app/api/auth/callback/route.ts`                    | Confirm existing email auth paths remain independent                |
| `src/lib/square/payment-links.ts`                       | Legacy provider links resolved                                      |
| `tests/unit/square-payment-links.test.ts`               | Hosted-link adapter removed                                         |

## Appendix B — Method and smaller-contract manifest

Remove only these 33 methods from retained files:

| File                                     | Methods                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/repositories/addresses-repo.ts`     | upsertOrderShippingSnapshot, insertOrderShippingSnapshot, insertOrderBillingSnapshot, getOrderBilling, upsertUserBillingAddress, listUserBillingAddresses, deleteUserBillingAddress                                                                                                                                       |
| `src/repositories/orders-repo.ts`        | getByIdempotencyKey, getByIdAndToken, createPendingOrder, updateGuestEmail, resetFailedOrderForRetry, updatePricingAndFulfillment, markPaidTransactionally, getOrderItems, getOrderItemsByIds, getOrderItemsDetailed, updateRefundSummary, markOrderItemsRefunded, restockVariants, updateFulfillment, getOrderWithTenant |
| `src/repositories/product-repo.ts`       | findByTitleAndCategory, countOrderItemsForProduct, deleteVariantsByProduct, getBrands, getModels                                                                                                                                                                                                                          |
| `src/repositories/storage-repo.ts`       | uploadBuffer                                                                                                                                                                                                                                                                                                              |
| `src/repositories/tag-taxonomy-repo.ts`  | createCandidate                                                                                                                                                                                                                                                                                                           |
| `src/services/cart-service.ts`           | getItemCount, getTotal                                                                                                                                                                                                                                                                                                    |
| `src/services/featured-items-service.ts` | isProductFeatured, getFeaturedItemsCount                                                                                                                                                                                                                                                                                  |

Smaller removals:

| Location                                     | Remove                                                                                                                                                                                                                                                                       | Preserve                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `src/components/admin/AdminPage.tsx`         | AdminSectionHeader                                                                                                                                                                                                                                                           | Other live exports                                     |
| `src/lib/utils/crypto.ts`                    | createCartHash, CartItemLike                                                                                                                                                                                                                                                 | Active crypto helpers                                  |
| `src/lib/checkout/idempotency.ts`            | getIdempotencyKeyFromStorage, setIdempotencyKeyInStorage                                                                                                                                                                                                                     | generateIdempotencyKey and storage clearing            |
| `src/lib/checkout/guest-shipping-address.ts` | getGuestShippingAddress, setGuestShippingAddress                                                                                                                                                                                                                             | clearGuestShippingAddress and its internal storage key |
| `src/types/domain/checkout.ts`               | SUPPORTED_PAYMENT_METHODS, SupportedPaymentMethod, CheckoutItem, CreatePaymentIntentRequest, CreatePaymentIntentResponse, ShippingAddressPayload, UpdateFulfillmentRequest, UpdateFulfillmentResponse, ConfirmPaymentRequest, ResolvedLineItem, CheckoutPricing, OrderStatus | OrderStatusResponse, FulfillmentMethod                 |
| `src/config/constants/roles.ts`              | isSuperAdminRole, SUPER_ADMIN_ROLES, SuperAdminRole after dead AdminService removal                                                                                                                                                                                          | Live profile/admin role helpers and permissions        |
| `src/lib/validation/cart.ts`                 | cartSnapshotSchema                                                                                                                                                                                                                                                           | cartValidateSchema                                     |
| `src/styles/site.css`                        | .rdk-toggle rules                                                                                                                                                                                                                                                            | .rdk-checkbox rules                                    |
| `.github/workflows/ci.yml`                   | LIGHTSPEED_ACCESS_TOKEN, LIGHTSPEED_DOMAIN_PREFIX fixtures                                                                                                                                                                                                                   | Current integration fixtures                           |

Keep the implementations of walletShippingDestination, getShippingEstimate, getOrderRefundDollars, normalizeCustomerEmail, buildTrackingPanelHtml, CARRIER_KEYS, PROFILE_ROLES, ADMIN_ROLES, ADMIN_PERMISSIONS, checkoutItemSchema and paymentMethodSchema. They are used internally even if their exports are unused. Keep documented operational scripts and generated database types. The audit found no removable package dependency.

## Appendix C — Table, column and storage manifest

New migration table removals (12):

| Table                             | Removal dependency/evidence                                               |
| --------------------------------- | ------------------------------------------------------------------------- |
| `public.admin_audit_log`          | No runtime producer/consumer; empty in audited environments               |
| `public.chargeback_evidence`      | No runtime producer/consumer; remove its table-bound trigger with table   |
| `public.nexus_registrations`      | No runtime producer/consumer                                              |
| `public.sellers`                  | Remove orders_seller_id_fkey and orders.seller_id                         |
| `public.tax_rate_cache`           | No runtime producer/consumer                                              |
| `public.tenant_checkout_settings` | No runtime reader; preserve historical staging row in backup              |
| `public.tenant_tax_settings`      | No runtime producer/consumer                                              |
| `public.transaction_audit_log`    | No runtime producer/consumer                                              |
| `public.checkout_api_logs`        | Release A removes logger and admin reader                                 |
| `public.user_billing_addresses`   | Release A removes unused saved-billing methods; keep order_billing        |
| `public.payment_events`           | Release A removes legacy admin reader; keep Square refund/dispute sources |
| `public.shipping_tracking_events` | Release A removes legacy reader; keep current tracking/notification paths |

New migration column removals (12):

| Table                          | Columns                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `public.orders`                | fee, tax_transaction_id, seller_id, public_token, square_payment_link_id, square_payment_link_url, square_payment_link_deleted_at |
| `public.payment_transactions`  | card_bin, three_ds_eci, amount_refunded                                                                                           |
| `public.user_addresses`        | is_default                                                                                                                        |
| `public.square_webhook_events` | processing_error                                                                                                                  |

Existing migration `20260918180000_remove_marketing_and_contact_attachments.sql` separately removes `email_subscription_tokens`, `email_subscribers`, `contact_messages.attachments` and obsolete auth metadata. Apply where pending only after its application prerequisite; do not duplicate these drops in the new migration.

Remove the empty `images` bucket declaration from `supabase/config.toml` and retire the actual bucket using Storage tooling after checking emptiness in each environment. Keep `products` and platform-managed schemas. No whole PostgreSQL schema is retired.

**Explicitly retained by user decision:** `state_sales_tracking` and its active order trigger. Also retain `profiles.is_primary_admin`, its security trigger/index, all active order billing, shipping/address, access-token, notification, refund/dispute and webhook state.

## Appendix D — Function, trigger and index manifest

Drop these five legacy RPC signatures:

```sql
drop function public.decrement_variant_stock(uuid, integer);
drop function public.increment_variant_stock(uuid, integer);
drop function public.mark_order_paid_and_decrement(uuid, text, jsonb);
drop function public.attach_square_payment_link(uuid, text, text, text, integer, integer, integer, text);
drop function public.mark_square_payment_link_deleted(uuid, text);
```

Before column drops, recreate the complete current `reserve_square_checkout_inventory_with_address` definition, preserving signature/attributes/ACLs and all behavior except the reused-response fragment. Its replacement fragment is:

```sql
return jsonb_build_object(
  'order_id', v_existing_order.id,
  'reused', true,
  'expires_at', v_existing_order.expires_at,
  'square_order_id', v_existing_order.square_order_id
);
```

Recreate the complete current `release_square_checkout_reservation` definition with only this obsolete prerequisite removed, after legacy links are verified retired:

```sql
if v_order.square_payment_link_id is not null
  and v_order.square_payment_link_deleted_at is null
then
  raise exception 'square_link_must_be_deleted_before_inventory_release';
end if;
```

Keep `reserve_square_checkout_inventory`, `reserve_square_checkout_inventory_without_billing`, `reserve_square_checkout_inventory_with_address`, both consume overloads, and RLS helpers `is_admin`, `is_admin_for_tenant`, `is_dev`, `is_super_admin`. Verify SQL body references as well as pg_depend before dropping fields.

Execute the remaining DDL below only **after** the current function replacements and legacy RPC drops above. This is a migration suffix inventory, not a standalone ready-to-run migration. Use one transaction with `lock_timeout = '5s'` and `statement_timeout = '60s'`; on lock timeout, investigate contention and retry the complete migration rather than continuing partially.

```sql
alter table public.orders drop constraint orders_seller_id_fkey;

drop table public.admin_audit_log;
drop table public.chargeback_evidence;
drop table public.nexus_registrations;
drop table public.sellers;
drop table public.tax_rate_cache;
drop table public.tenant_checkout_settings;
drop table public.tenant_tax_settings;
drop table public.transaction_audit_log;
drop table public.checkout_api_logs;
drop table public.user_billing_addresses;
drop table public.payment_events;
drop table public.shipping_tracking_events;

alter table public.orders
  drop column fee,
  drop column tax_transaction_id,
  drop column seller_id,
  drop column public_token,
  drop column square_payment_link_id,
  drop column square_payment_link_url,
  drop column square_payment_link_deleted_at;
alter table public.payment_transactions
  drop column card_bin,
  drop column three_ds_eci,
  drop column amount_refunded;
alter table public.user_addresses drop column is_default;
alter table public.square_webhook_events drop column processing_error;

drop trigger update_products_updated_at on public.products;
drop trigger update_shipping_profiles_updated_at on public.shipping_profiles;
drop function public.update_updated_at_column();
drop function public.update_chargeback_evidence_updated_at();

drop index public.order_billing_order_id_idx;
drop index public.idx_order_shipping_order_id;
drop index public.idx_product_variants_tenant_sku;
```

Retain `trg_products_set_updated_at` and `trg_shipping_profiles_set_updated_at` using `rdk_set_updated_at`. Retain unique counterparts `order_billing_order_id_unique`, `order_shipping_order_id_key`, `product_variants_tenant_sku_key`. Indexes `idx_chargeback_evidence_order_id`, `idx_tax_rate_cache_zip_code`, `idx_tenant_tax_settings_tenant` disappear with their tables and require no separate drops. Keep unique constraints on all retained tables and the nonidentical products RLS policies.
