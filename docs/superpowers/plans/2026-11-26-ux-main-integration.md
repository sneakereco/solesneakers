# UX branch and main integration plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded merge; obtain one fresh-context review of the completed integration.

**Goal:** Resolve PR50 conflicts by merging current main into the existing UX branch and preserve both parents behavior.

**Architecture:** A normal merge commit retains both histories. Combine conflicting feature owners explicitly and inspect related automatic merges. No redesign, dependency installation, new migration or provider action is part of this repair.

**Tech stack:** Installed Next16.3.3, React19, TypeScript, Jest and Playwright.

**Spec:** User request to resolve the seven conflicts; the approved customer/admin UX design and main merged PR47/49 define the behavior to preserve.

## Constraints and review focus

- Keep the verified UX ownership, original cart binding, payment reconciliation, finite loading and recovery contracts.
- Keep main giveaway discovery, claimed-product recovery, header status entry, inventory specialty forms and public-claim proxy path.
- Keep Barlow headings and centered full-width mobile clothing cards.
- Specialty edit reads remain inside the authorized initial-read deadline. Confirmed missing differs from unavailable.
- Preserve existing role/MFA, CSRF, rate-limit and provider policies; main migrations are inherited files and will not be applied here.
- Use the existing isolated implementation worktree; do not alter the shared parent checkout or dependency junction.

## Tasks

- [x] Inspect both parents and all seven conflict groups; record the resolution contracts and relevant automatic merges.
- [x] Merge main without committing, resolve the seven files, and exercise existing regressions for both parents. Add a focused integration regression only for a concrete gap, observing a meaningful failure before fixing it.
- [x] Run typecheck, relevant lint/format, unit/integration/browser gates and a local Next build. Obtain a fresh integration review, fix material findings and record evidence.
- [ ] Commit the merge, push the existing PR branch, update PR50 using the organization format and verify GitHub reports no merge conflicts.

Parent UX head: d1f126ee908f3fc405b6c1403de2cb4bc77b7d56. Main to integrate:19fd3f3d8e1a1ca943d63ff9fd362642dcc994fd. Existing branch verification remains historical until combined-code checks pass.

## Verification checkpoint

All seven conflicts are resolved;155 unit suites (841 tests),21 integration tests,22 browser runners, the giveaway dialog suite, standalone TypeScript, formatting, scoped lint and a94-entry production build pass. Affected unit suites were repeated after review fixes. The integration review has no blocking findings. Source and test tree pins are recorded in the operations report. The final publication task runs after this checkpoint is committed; GitHub PR50 is the authority for remote publication and mergeability.
