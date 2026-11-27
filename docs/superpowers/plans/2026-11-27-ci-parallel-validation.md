# Parallel PR Validation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved scope inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten PR feedback by removing duplicate browser executions and running database/browser validation concurrently without losing unique coverage.

**Architecture:** Preserve the existing scope classifier. Run checks, database, and browser lanes independently; retain a final required `validate` job that rejects every unsuccessful dependency. Make the browser runner callable with its existing gate boundary so its executed coverage can be checked without launching browsers.

**Tech Stack:** GitHub Actions, Node 24.14.1, existing Node test runner and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-ci-parallel-validation-design.md`

## Global Constraints

- Keep every unique test, fresh/populated database modes, and negative controls.
- Preserve changed-path scope, unconditional migration rehearsals, and unconditional measurement/analytics tests.
- Retain `validate` as the final required check and keep diagnostics private.
- Keep deployment workflows and product code unchanged.

## Review Focus

- A skipped or canceled lane must never produce a green required check.
- Browser-only or unrelated PR scope must not suppress unconditional suites.
- Both duplicate wrappers must remain covered by the full, unfiltered outcome suite.
- Parallel jobs must have their own dependencies and required runtimes.
- Fault-injection and ordinary test failures must still propagate.

### Task 1: Pin execution coverage and dependency failure behavior

**Files:** Create `tests/operations/ci-parallel-validation.test.mjs` and `tests/operations/checkout-browser-runner.test.mjs`.

- [ ] Add tests for independent lanes, retained command coverage/scope, and executing the actual final gate with unsuccessful/missing dependency results.
- [ ] Add tests that capture the browser runner's real gate calls, preserve all unique suites/negative controls, and reject duplicate filtered outcome invocations.
- [ ] Run both files and confirm the current implementation fails the new requirements.

### Task 2: Implement the approved scheduling changes

**Files:** Modify `.github/workflows/ci.yml`, `tests/browser/checkout-hardening.mjs`, and the fixture-environment reader in `tests/integration/deployment-seeding.test.ts`.

- [ ] Export `runCheckoutBrowserChecks(gate, flags = [])`; retain CLI behavior and remove only the two duplicate wrapper calls.
- [ ] Split the workflow into scope, checks, database, browser, and aggregate validate jobs; retain existing commands and gates.
- [ ] Update the integration test to read the shared workflow-level fixture environment.
- [ ] Run the new operation tests, existing scope/privacy tests, integration tests, formatting, and lint.

### Task 3: Verify the real workflow

- [ ] Review the complete diff and obtain a fresh-context code review.
- [ ] Commit, push a dedicated CI branch, and open a PR.
- [ ] Observe the real parallel jobs and report their results and measured timing. Do not merge or deploy.
