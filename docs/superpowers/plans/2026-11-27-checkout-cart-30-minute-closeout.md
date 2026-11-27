# Checkout and Cart 30-Minute Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reviewable local integration checkpoint and an exact remaining-work handoff within the user's 30-minute limit; do not claim the original release-hardening program is complete.

**Architecture:** Preserve the reviewed hardening and shipping main in the existing isolated feature branch. Finish only the current integration's essential migration-order and source checks, then perform a targeted independent review and record unresolved work. Acceptance tooling, exhaustive qualification and promotion remain deferred.

**Tech Stack:** Existing Next.js/React, Supabase/PostgreSQL, Square, Redis, Jest and installed Playwright; pinned Node 24.14.1. No new dependencies or resources.

**Spec:** `docs/superpowers/specs/2026-11-25-checkout-cart-release-hardening-design.md`. This narrows execution of the approved `2026-11-25-checkout-cart-release-hardening.md` plan at the user's explicit request; its financial, ownership and release safeguards remain binding.

**Timebox:** Started 2026-11-27 06:31:01 UTC. Handoff due 07:01:01 UTC. Aim for the implementation/report checkpoint by 06:48 UTC and the targeted review report by 06:56 UTC. Finish active owned cleanup before stopping a test; start no new broad task that cannot fit.

## Global Constraints

- Keep the existing 15-minute hold duration and guest sessionStorage/account-specific localStorage keys and separation.
- Keep unavailable rows, requested quantities and reasons; no silent shortage trimming or automatic partial checkout.
- No provider call while database locks are held. Persist no card details, raw source tokens or Turnstile tokens.
- Preserve published migrations, PR staging and production tag gates. Only the six unpublished hardening migrations may move after pinned shipping main; do not bypass the existing migration-prefix gate.
- No paid upgrade, provisioning, deployment, shared merge/push, real charges, external messages or hosted load is authorized.
- Shared production Redis remains disallowed for staging qualification or an unsafe named `stg_ci` build. Record failed/unrun gates honestly.
- Retain all source, review and test provenance. A targeted review does not replace the deferred full task or whole-branch review.

## Review Focus

- Migration versions on installed pinned main must be a prefix of candidate versions under the actual release validator.
- Refused additions and lower stock caps must preserve requested units until an explicit shopper adjustment.
- Current owner and original purchase proof must fence payment and Cart cleanup, including copied tabs and unavailable sessions.
- Reseller/customer notifications must retain owned lease/handoff/sent-audit authority after migration integration.
- Production optional analytics must remain denied without qualified consent, retaining security scripts and operational logs.

## Task A: Stabilize the local checkpoint

**Files:** Current integration paths, six unpublished migrations, existing tests/fixtures, generated DB types and port manifest. Pin main `6161af042c8d976b39c403ac1bf61f92e8f6098c`; integration BASE `5a1eeb53b3183caf4ae9fa627d3832bf448576af`.

- [ ] Finish active owned cleanup and stop new broad suite launches.
- [ ] Finish the coordinated migration ordering after shipping main, with actual prefix RED/GREEN and highest-risk affected local checks that fit.
- [ ] Resolve only bounded blocking source/compile issues in current changes; preserve unresolved checks explicitly.
- [ ] Commit a reviewable local checkpoint and write exact source/schema identity, commands, results and open cases. Do not label unfinished integration deployable.

## Task B: Targeted independent review

**Files:** Complete integration diff package and report; reviewer focuses the five risks above and lists unreviewed scope.

- [ ] Review the committed checkpoint read-only without repeating passing broad suites.
- [ ] Address only clearly bounded critical findings within the remaining time; otherwise record them as blockers.
- [ ] Record findings and limitations. Full Task 15 and whole-branch review remain deferred.

## Task C: Deadline handoff

**Files:** Port manifest/status handoff and this plan's completion record; preserve the existing SDD workspace because the original plan is unfinished.

- [ ] Record branch/commit, clean or remaining worktree state, reviewed scope, passed/failed/unrun checks and any owned cleanup issue.
- [ ] List unresolved same-owner checkout, receipt/storage and copied-tab cases individually if still open.
- [ ] List the remaining exhaustive local matrix, Tasks 16–17 acceptance/invariant/release tools and runbook, full independent review, isolated staging setup, named build, provider/device/scheduler/load and rollout qualification.
- [ ] Deliver the scoped result by 07:01:01 UTC. No production readiness or original-plan completion claim.
