# Release Reconciliation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Independent migration and provider checks use superpowers:dispatching-parallel-agents.

**Goal:** Deploy one staging revision containing opening/access fixes, analytics, and checkout hardening, then promote that same validated source through the production tag gate.

**Architecture:** Combine main and the analytics bootstrap without rewriting release history. Extend the migration gate for the exact recorded bootstrap/checkout ordering found in both environments, and bind the CLI preview and application to a checked source/database plan.

**Tech Stack:** Node 24.14.1, PostgreSQL, Supabase CLI 2.117.0, GitHub Actions, Vercel, Doppler, PostHog.

**Spec:** User request in this chat, 2026-11-27: unify the recent hotfix, analytics and checkout work on staging before the 2 PM ET opening.

## Global Constraints

- Preserve staging deployment on main merge and production deployment on immutable version tags.
- Preserve unknown-version, historical-baseline, duplicate and unrelated-gap blockers.
- Never repair, delete, renumber or fabricate hosted migration history.
- Keep analytics capture flags at their existing values; verify provider readiness separately.
- Keep unrelated worktrees and changes intact.

## Review Focus

- A partially completed checkout backfill must resume only from a valid sequential prefix.
- Disk SQL must match committed source, including extra ignored/untracked SQL.
- A preview from another commit, database or migration history must fail before mutation.
- Supabase CLI must apply exactly the previewed SQL without seeds, roles or vault changes.
- Bootstrap-before-checkout must preserve populated commerce and reporting data.

### Task 1: Consolidate release source and record actual environments

- [x] Verify main, release tags, deployed Vercel SHAs, database histories and environment identities.
- [x] Merge exact analytics bootstrap commit `201f045d` into latest main on `codex/release-reconciliation`.
- [x] Record the verified starting matrix and procedure in `docs/operations/release-reconciliation-2026-11-27.md`; append final deployment evidence after rollout.

### Task 2: Make the exact migration reconciliation reviewable

**Files:** `scripts/single-store/check-migration-baseline.mjs`, focused reconciliation helper/manifest, `tests/database/migration-reconciliation.test.mjs`.

**Interface:** Preserve `validatePrefix(known, recorded) -> {blockers, through}`. Add `migrationPlan: {head, inventoryDigest, recordedDigest, databaseFingerprint, includeAll, pendingFiles}` to successful gate reports.

- [x] Write and fail tests for baseline 122 plus bootstrap, all sequential checkout partial prefixes, rejected unrelated gaps/history, and disk drift.
- [x] Pin the bootstrap and eight checkout blobs; verify recorded bootstrap statements against canonical SQL.
- [x] Pass focused Node tests and read-only hosted checks.

### Task 3: Bind preview, application and verification

**Files:** `scripts/single-store/deploy-migrations.mjs`, `tests/operations/migration-deployment.test.mjs`, staging/production workflows, PR CI workflow.

**Interface:** `runMigrationDeployment({phase, planPath, connectionString, check, runCli})`, phases `preview` and `apply`. Preview saves a credential-free plan. Apply obtains a fresh gate report, rejects drift, repeats the exact CLI preview and verifies a complete ledger afterward.

- [x] Fail tests for unexpected CLI migrations, wrong CLI version, stale source/database/history plans and incomplete post-apply history, including drift during dry-run.
- [x] Use locked CLI 2.117.0, explicit JSON output and `--skip-vault`; enable `--include-all` only from the reviewed gate plan.
- [x] Wire the checked plan through preview/apply in both workflows and add focused tests to CI.

### Task 4: Rehearse actual SQL ordering and analytics readiness

**Files:** `tests/database/fixtures/checkout-hardening.mjs`, new checkout migration-order test; existing analytics provisioning/query source as evidence.

- [x] Fail then pass normal-order and bootstrap-before-checkout PostgreSQL rehearsals with fresh/populated fixtures.
- [x] Verify final 131-version ledger, bootstrap rows, commerce preservation, reporting exports and reader isolation.
- [x] Check actual PostHog warehouse/query readiness without enabling capture or changing provider data; correct materialized table bindings and record absent setup separately.

### Task 5: Deploy one staging candidate and prepare promotion

- [ ] Review integrated diff, run formatting/lint/typecheck and focused checks; commit and push one reconciliation PR from up-to-date main.
- [ ] Pass full required PR CI and obtain the repository-required maintainer review.
- [ ] Merge, follow staging migrate/deploy/readiness to completion, and verify canonical alias SHA and database ledger.
- [ ] Prepare production promotion from that same validated source. Report failed beta.9 as not deployed and use a new immutable tag for any later release.
