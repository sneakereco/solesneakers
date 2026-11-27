# November 27 release reconciliation

The release candidate combines the opening/access fix, analytics reporting and schema bootstrap, and checkout/cart hardening. Staging deploys from a reviewed main merge; production promotes that same validated source using a new version tag.

## Verified starting state

Provider evidence collected November 27, 2026, approximately 10:40–11:00 AM ET. These are observations, not the intended final deployment state.

| Component                   | Staging                                                 | Production                                    |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| Canonical site              | `soles-stg.vercel.app`                                  | `www.solesneakersnc.com`                      |
| Vercel project              | `soles-stg`                                             | `soles-pro`                                   |
| Active source SHA           | `b893a31d6983c0fa1e442a908e6a2794f5811ff4`              | `b893a31d6983c0fa1e442a908e6a2794f5811ff4`    |
| Supabase project            | `byskzklzdgquamwzrljt`                                  | `jxwulwjbtjtcqmyrzqiv`                        |
| Recorded migrations         | 123                                                     | 123                                           |
| History shape               | 122 through `20261127034000`, plus `20261127134000`     | Same                                          |
| Missing checkout migrations | `20261127040000` through `20261127047000` (eight files) | Same                                          |
| Measurement environment     | `staging`                                               | `production`                                  |
| Capture enabled             | `false`                                                 | `false`                                       |
| Site lock                   | Open                                                    | Locked until `2026-11-27T19:00:00Z` (2 PM ET) |

The CI profiles point to separate, correctly paired app/database projects. The observed mismatch is between committed release source, deployed source, and migration history. Different direct/pooler connection strings for production were verified against the same project/history.

## Source inventory

- Main at `65a982dc` contains analytics PRs #53/#55, checkout hardening PR #54, and opening/access PR #57.
- Analytics bootstrap PR #56 is commit `201f045d3d998fc8d1ab4623eb50df9d17cec26e`. Its SQL was already applied to both hosted databases. Its branch was merged into the combined candidate, preserving ancestry.
- `codex/release-reconciliation` began from current main and merged that bootstrap, producing `b204912455f4a6562a1ee0925e6cc57aed912d58` before reconciliation tooling changes.
- The inspected opening, checkout and analytics worktrees were clean. Opening commits in the older checkout are already patch-equivalent to main; checkout work is already an ancestor. Reapplying those changes would duplicate work.
- `v1.0.0-beta.9` remains immutable at `e6508cab9ff416373d7631f338c376aaf614cd28`. Its production workflow [46025029896](https://github.com/sneakereco/solesneakers/actions/runs/46025029896) failed at the migration gate; deploy and verify were skipped. It did not become the live deployment.

## Migration procedure

The original gate correctly rejected an unknown manually applied bootstrap, then a prefix gap once the bootstrap was present in source. Adding the missing SQL file alone cannot resolve the history ordering.

The reviewed exception permits only the eight pinned checkout migrations below the already-recorded, SQL-verified bootstrap. Removing that bootstrap from consideration must leave the exact 122-entry baseline plus a sequential prefix of those eight checkout migrations. Unknown versions, duplicates, historical omissions, changed approved blobs, an internal checkout gap, or any unrelated gap remain blockers. Successful completion restores the ordinary complete 131-entry prefix.

Before preview, all SQL files on disk must match the committed inventory, including the absence of extra untracked or ignored SQL. The checked plan records the source SHA, inventory and registry digests, a password-free database identity fingerprint, and exact pending files. The locked Supabase CLI 2.117.0 must produce that exact JSON migration list. Apply obtains a fresh gate report, compares it with the saved plan, repeats the preview, and verifies a complete ledger afterward. The CLI skips vault changes and includes neither seeds nor roles. `--include-all` is selected only by the reviewed backfill plan.

An interrupted sequential backfill can be previewed again from its new recorded prefix. A stale saved plan is rejected. Do not repair/delete migration-history rows or move/renumber migration files to force a deployment.

## Analytics provider state

The synchronized PostHog tables use `postgres_analytics_financial_export` and `postgres_analytics_purchase_link_export`; PostgreSQL export views keep their canonical unprefixed names. Initial metadata probes found no saved report Endpoints in either project. Compiled provider queries must use the actual PostHog table bindings before endpoint provisioning.

Capture remains disabled. Shipping the analytics code and schema does not by itself prove that report endpoints, query permissions, warehouse freshness, or customer event delivery are ready. Record provider verification separately from app/schema deployment evidence.

The read-only provider audit also found zero insight variables in both projects, no activated staging dataset, and no saved staging pairing fingerprint. The compiled initial plan contains 22 Endpoints and 31 String variables. No activation instant, owner attestation, definition provisioning, capture change, or observer opt-in was created during consolidation.

## Release gates and evidence

- [x] All 32 combined reconciliation, deployment-plan and warehouse-binding checks passed. Both SQL orders passed on fresh/populated isolated PostgreSQL databases (four scenarios), with complete ledger, commerce preservation, export reader isolation and owned cleanup verified. Eleven fixture/relay guard checks also passed.
- [x] Local full formatting, lint and typecheck passed. Lint retained four existing warnings. The relevant analytics Jest sweep passed 189/190 initially; its sandbox-blocked bundle test file passed 2/2 with normal dependency access, qualifying all 190 unique cases across the runs.
- [ ] Combined source passes formatting, lint, typecheck and required PR CI.
- [ ] Required maintainer review is present and the reconciliation PR merges into current main.
- [ ] Staging workflow migration, deployment and readiness jobs succeed.
- [ ] Staging canonical alias serves the merge SHA; its database has the complete committed ledger with no pending migrations.
- [ ] Staging opening/access and checkout/reporting checks pass; provider gaps are explicitly recorded.
- [ ] Any production release uses a new immutable tag from the same validated main source, with migration/deploy/readiness evidence recorded separately.

Application rollback does not reverse database migrations. Keep the prior immutable deployment available, and assess schema compatibility before any rollback. Preserve unrelated branches/worktrees during release cleanup.
