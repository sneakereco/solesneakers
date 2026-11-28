# Merge Queue and CI Shards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce CI elapsed time and repeated branch updates without dropping coverage or integration protection.

**Architecture:** Four isolated matrix runners for each checkout family, existing aggregate validate gate, and native GitHub merge-group validation. Preserve full local runner commands and every fixture guard.

**Tech Stack:** GitHub Actions, Node 24.14.1, Ubuntu 24.04, existing Supabase/Docker and Playwright fixtures.

**Spec:** docs/superpowers/specs/2026-11-27-ci-merge-queue-shards-design.md

## Global Constraints

- Preserve every existing suite, negative control, scope rule, fixture guard, and required check.
- Keep permissions read-only, dummy credentials, pinned actions, Node 24.14.1, and Ubuntu 24.04.
- Do not alter protection for unrelated repositories.
- Queue activation must not precede workflow support on main.

## Review Focus

- A failed or cancelled shard must block validate even if sibling shards pass.
- Bad shard flags and fault flags on a non-owning shard must fail before executing checks.
- Scope false still runs migration, measurement, and analytics suites.
- Merge groups always run full checkout coverage and cannot cancel unrelated PR checks.
- Inherited organization rules must not leave an up-to-date requirement in effect or weaken other repositories.

### Task 1: Shard runner boundaries without changing suites

**Files:** Modify scripts/test-checkout-hardening-db.mjs and tests/browser/checkout-hardening.mjs; create tests/fixtures/checkout-shards.mjs and tests/operations/checkout-database-runner.test.mjs; extend tests/operations/checkout-browser-runner.test.mjs.

**Interfaces:** Both exported runCheckoutDatabaseChecks(gate, flags = []) and runCheckoutBrowserChecks(gate, flags = []) execute their existing gate contracts. Shared selectCheckoutShard(checks, flags, faultFlag) validates optional --shard=N/4 and returns selected checks and broken flag.

- [ ] Add behavioral coverage tests for the literal baseline commands, union of four shards, repeated runtime controls, unchanged environments, negative controls, bad flags, and thrown gate errors.
- [ ] Run the runner tests; confirm new sharding tests fail before implementation.
- [ ] Implement shard selection and import-safe database runner; keep every child test command and fixture unchanged.
- [ ] Run node --test tests/operations/checkout-database-runner.test.mjs tests/operations/checkout-browser-runner.test.mjs tests/fixtures/checkout-gate.test.mjs and confirm all pass.
- [ ] Commit the runner change.

### Task 2: Queue-capable workflow and complete matrix result gate

**Files:** Modify .github/workflows/ci.yml, tests/operations/ci-parallel-validation.test.mjs and tests/operations/checkout-validation-scope.test.mjs; add docs/operations/ci-merge-queue.md.

**Interfaces:** Matrix shard values are 1, 2, 3, 4; runner flags are --shard=N/4. validate consumes scope/checks/database/browser aggregate results and accepts only success.

- [ ] Add failing tests that inspect the actual expanded matrix commands and execute the real validate script for all non-success results; pin full merge-group scope behavior with the actual scope CLI.
- [ ] Add merge_group trigger, event-separated concurrency, four-shard matrices with fail-fast false, and shard-specific unconditional suites. Include new orchestration tests in ordinary CI.
- [ ] Run all affected operation/runner/scope/privacy tests, formatting, lint, typecheck and unit/integration suites; confirm success.
- [ ] Commit, push, create a PR, and inspect every shard's hosted logs against the baseline gate coverage and test counts.

### Task 3: Activate and verify repository-specific merge queue

**Files:** docs/operations/ci-merge-queue.md contains the effective configuration and verification evidence.

**Interfaces:** Current organization ruleset 22704720 applies strict validate protection to default branches; preserve it for all other repositories. Repository-specific main protection must include validate, merge queue, and the same review/thread/non-fast-forward/deletion protections.

- [ ] Review the whole branch with a fresh reviewer and resolve important findings with regression tests.
- [ ] Land the passing CI PR using existing required checks and human review; never bypass protection.
- [ ] Configure queue only for solesneakers/main after workflow support exists on main; preserve all applicable unrelated rules and bypass lists.
- [ ] Read back effective rules and verify merge-group execution when an authorized eligible PR is available; report remaining gates precisely.
