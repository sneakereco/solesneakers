# Dead-code retirement execution evidence

## Release A — application compatibility

Starting commit: `25c53b3fc5661eec2d3f260603c948473c98e92f`.
Branch: `codex/dead-code-retirement`, commit `22bc11c2`.

Removed the 22 unreachable files, both test-only implementations, 33 uncalled methods, approved cart snapshot/restore and Google OAuth routes, saved-billing helpers, hosted-link adapter, legacy admin readers, and smaller audited contracts. Kept current order billing, cart validation, authentication flows, Square lifecycle data, shipping state, and sales tracking. No package dependency was unused.

Expiration now refuses to release a Square order with missing version evidence. Card initialization failure coverage now executes the actual checkout component for creation and attachment failure; disabling the live error handler made that browser assertion fail.

| Verification        | Result                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Baseline unit tests | 106 suites, 442 assertions passed                                                                                              |
| Updated unit tests  | 105 suites, 438 assertions passed, plus the added admin route assertion passed separately                                      |
| Integration tests   | 3 suites, 20 assertions passed                                                                                                 |
| Browser suite       | All 11 scripts passed                                                                                                          |
| Lint                | No errors; 9 existing warnings                                                                                                 |
| Typecheck           | Passed, including generated Turbopack route types                                                                              |
| Formatting          | Passed                                                                                                                         |
| Knip                | No unreachable application files or unused packages; three documented operational scripts remain standalone                    |
| Production build    | Turbopack build passed with a temporary root setting for the worktree's linked node_modules; next.config.ts restored afterward |

The initial build could not resolve the dependency junction outside its default root. Automatic approval review rejected removing that junction. Webpack compiled but its generated route typing rejected existing synchronous searchParams alternatives; the documented Turbopack root option resolved the worktree build without changing application configuration.

## Live environment baseline (read-only refresh)

| Environment | Migration count | Latest migration | Latest successful deployment workflow SHA |
| ----------- | --------------- | ---------------- | ----------------------------------------- |
| Local       | 102             | 20260918140000   | Not deployed                              |
| Staging     | 103             | 20260918180000   | 25c53b3fc5661eec2d3f260603c948473c98e92f  |
| Production  | 87              | 20260723090000   | dd8ea098a48e9cc5f12463f5c6e699b5b99bc2a4  |

Workflow records establish the last reported successful deployment, not a new live checkout test. Production's 16-migration backlog needs its own reviewed cutover before retirement deployment; the existing marketing-removal migration requires compatible code first.

## Provider and rollout gates

One legacy staging hosted link still exists at Square and its order is in review. Another review order's link returns NOT_FOUND with prior deletion evidence recorded. Production has no hosted-link columns at its current baseline. Provider IDs were retained only in the local audit artifact, not committed.

Do not release stock or assume review orders are unpaid. Verify and retire the remaining hosted link, recording confirmed deletion through the existing RPC before Release A deployment. This execution has made no remote database, provider, auth, or bucket changes.

The user selected a staging-first rollout: Release B may proceed through a PR to main after staging runs A and staging-specific migration prerequisites are resolved. Production deployment is separate and tag-triggered; do not create a production tag for B until production has received the compatible application and its baseline cutover is verified. After B, A is the oldest compatible application rollback target. Deleted data requires a verified backup restore.

## Release B — locally verified, rollout pending

Branch: `codex/database-retirement`, based on Release A commit `22bc11c2`.
The new forward migration removes 12 tables, 12 columns, five legacy RPCs, two obsolete trigger functions, two duplicate triggers, and three redundant indexes on retained tables. The images bucket declaration is removed; actual buckets remain until deployment review. Sales tracking and its trigger are retained.

Two current reservation function bodies were carried forward unchanged except for the retired link fields/prerequisite. The migration refuses to begin cleanup if any legacy link lacks deletion evidence. No CASCADE is used. Existing marketing retirement is applied from its original migration, not duplicated.

Generated types now reflect the cleaned database. They also include the already-installed record_square_payment_details RPC that the previous generated file omitted. Existing SQL regression scripts now exercise current functions instead of reinstalling historical bodies. A newly orphaned FeaturedItemsRepository.count method was also removed after its only caller was retired.

| Verification                                  | Result                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration on populated local copy             | Passed; hashes and counts of all 33 retained public tables unchanged                                                                                                      |
| Retained RPC ACLs/security attributes         | Identical before and after                                                                                                                                                |
| Complete ordered migration replay             | 87 migrations reproduce the recorded production baseline; all 104 apply through retirement                                                                                |
| Catalog checks, both disposable databases     | Removed objects absent; required tables, unique indexes, and timestamp triggers retained                                                                                  |
| Active-link guard                             | Synthetic undeleted review-order link blocks migration; fixture and DDL rolled back                                                                                       |
| Checkout SQL                                  | All four active methods; billing/pickup persistence; reserve/reuse; release exactly once; both consume overloads; paid-order protection; cross-tenant inventory rejection |
| Notification/payment-details SQL              | Queue retry/claim permissions and payment persistence/replay passed against current schema                                                                                |
| Taxonomy RLS, both copies                     | Passed, including denied cross-tenant writes                                                                                                                              |
| Unit and integration suites                   | 106 unit suites / 439 assertions; 3 integration suites / 20 assertions passed                                                                                             |
| Browser suite                                 | All 11 scripts passed                                                                                                                                                     |
| Typecheck, formatting, lint, production build | Passed; lint retains 9 existing warnings; build uses the documented temporary worktree root setting                                                                       |

Replay used the local Supabase platform schemas plus the repository's complete ordered application migration history. This validates the migration path through production's recorded version; it is not a copy or test of live production data. The populated local clone was independently used for preservation and runtime checks.

Repeat the catalog check with an explicitly selected disposable database:

```powershell
$env:SUPABASE_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:64332/codex_retirement_verified_20260918'
node scripts/test-schema-retirement.mjs
node scripts/test-checkout-pickup-contact.mjs
node scripts/test-checkout-notification-delivery.mjs
node scripts/test-square-payment-details.mjs
$env:RLS_TEST_DB_URL = $env:SUPABASE_DB_URL
npm run test:rls
```

These checks do not authorize or perform a remote migration. Public schema data checks used hashes/counts; customer records and secrets are not included in this report.

## Local test databases

A disposable copy of the existing local database was restored into `codex_retirement_verified_20260918` on the Sole Sneakers local PostgreSQL instance. The ordinary `postgres` database and other local projects are unchanged. The first restore attempt stopped on an ownership permission error in a separate incomplete `codex_retirement_20260918` database; neither copy serves the application.

## Remaining release work

Release A was merged through PR #11 at 23e66d8a2a2b2117cbe7e3213699aca4bf012bc7 and its staging workflow passed validation, migration, deployment, and readiness verification. Release B is being submitted as a staging PR at the user's request. The agent has not performed remote schema, provider, auth, or bucket changes. Production rollout is not a prerequisite for staging B; it remains a prerequisite before applying B to production. The production baseline backlog, remaining sandbox link, backup verification, live smoke tests, and actual bucket/auth configuration retirement remain explicit deployment tasks.

The current worktree is preserved at `C:/dev/projects/sneakereco/solesneakers/.worktrees/dead-code-retirement`. Main's existing mist.toml deletion, untracked mise.toml, and original untracked plan are unchanged.

## PR #11 deployment verification

Verified after the user reported deployment:

- PR #11 is merged; staging workflow [35387961777](https://github.com/sneakereco/solesneakers/actions/runs/35387961777) succeeded at merge commit `23e66d8a2a2b2117cbe7e3213699aca4bf012bc7`.
- The latest successful production workflow still reports July commit `dd8ea098a48e9cc5f12463f5c6e699b5b99bc2a4`. A fresh database read still finds 87 migrations through `20260723090000`.
- The remaining legacy staging hosted link still exists at Square, its order remains in review, and deletion evidence is absent. The other recorded legacy link returns NOT_FOUND and already has deletion evidence.

The staging readiness workflow does not replace payment/fulfillment smoke testing. Before staging contraction, resolve its legacy link, verify recoverable backups and complete staging smoke tests. Before any later production contraction, separately verify the production compatibility rollout and its own migration prerequisites.
