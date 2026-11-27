# Checkout recovery, preparation errors and analytics release plan

> Execute inline using `superpowers:executing-plans`; the user explicitly prohibits subagents.

**Goal:** restore convergent checkout recovery, identify and fix checkout preparation failures, and deploy consistent enabled analytics to staging and production.

**Design and authorization:** the November 27 investigation report and the user's request to fix all three issues, test on staging, and release to production. Preserve business rules, payment identity, terminal-state safety, consent and the existing PR/main/tag release gates.

**Architecture:** add a forward migration allowing strictly verified FAILED evidence to bind an unknown payment ID on the same declined attempt. Preserve all conflicting identity/state rejection. Restore allowlisted error codes and preparation phases without logging customer/provider payloads. Rebuild analytics with matching public/runtime configuration and verify real delivery. Fix any additional verified defect preventing these three flows from converging.

**Tech stack:** PostgreSQL/Supabase, Next.js 16.3.3, Square, Shippo, PostHog, Vercel, GitHub Actions.

## Constraints and review focus

- No subagents. Existing isolated worktree; branch `codex/checkout-recovery-and-analytics`.
- Never modify applied migrations or manually clear financial jobs/holds.
- Real PostgreSQL regression for no-ID decline followed by FAILED payment binding and replay; reject state reversal, amount/order/payment mismatches and conflicting IDs.
- Verify complete recovery/expiry, including Square order cancellation evidence and shared dependency limits.
- Emit only bounded allowlisted error categories/codes and stages; exclude raw messages, stacks, bodies, tokens and contact information.
- Verify analytics build/runtime pairing, consent and provider acceptance separately from a green build.
- CI, staging and production are separate gates. Production uses a new immutable tag after staging verification.

## Task 1: checkout recovery

- [ ] Add and observe a failing PostgreSQL regression in `attempt-ledger.postgres.test.mjs`.
- [ ] Add a new migration after the current inventory tip; retain strict fact validation and terminal state.
- [ ] Test late evidence/replay/conflicts and complete recovery/expiry, addressing only reproduced blockers.
- [ ] Run the affected database and recovery suites; review the full diff and commit.

## Task 2: checkout preparation

- [ ] Add failing tests for safe error-code/phase emission in `log.ts`, lifecycle sanitizer and preparation handler.
- [ ] Implement bounded diagnostics, reproduce the failed phase on staging/provider boundaries, and fix the actual cause.
- [ ] Verify success, provider refusal/unavailability and scrubbed failures; commit.

## Task 3: analytics and deployment

- [ ] Verify desired profiles and Vercel runtime settings without printing secrets; prevent silent public/runtime mismatch.
- [ ] Add focused regressions if a code or deployment-check change is needed.
- [ ] Run required checks, open PR, pass full CI and merge through repository rules.
- [ ] Verify staging source/migration inventory, complete checkout recovery and preparation with owned fixtures, and analytics consent/delivery.
- [ ] Publish the next production tag/release and verify workflow, effective configuration, cron progress, checkout health and public routes.

Record evidence, deviations and outstanding work in `.superpowers/checkout-recovery-release-progress.md`.
