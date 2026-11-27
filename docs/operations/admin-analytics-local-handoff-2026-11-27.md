# Local analytics handoff — November 27, 2026

The local analytics implementation is ready for staging deployment and setup. The branch is `codex/admin-analytics`, preserved in `C:\Users\dsrus\.codex\worktrees\admin-analytics\solesneakers`. Reviewed product HEAD is `3ff47f66dd640c34d3b89b8d11e97f3ea21a772b`, against the locally selected main baseline `68a12b183b882003c1aefdbe35472ed233444fe0`. Subsequent handoff changes contain documentation only.

This local phase finished before the five-hour cutoff. It performed no push, PR, hosted database or provider changes, capture, dataset activation, or deployment. The account settings in [the setup record](admin-analytics-setup-2026-11-27.md) were verified during the earlier browser session and were not rechecked here. Deployment and hosted acceptance remain separate.

## Completed locally

- Seven native admin report views, custom calendar ranges, comparisons, applicable filters, chart tables and matching protected CSV exports cover sales, customers, acquisition, products, payments and checkout health. The existing admin summary uses the same reporting service.
- Fresh-launch history follows actual verified retention and observations. There is no historical import, 24-month history minimum, blanket retention-capacity minimum or mandatory archive. Financial facts remain durable from activation.
- Launch corrections cover short actual retention, the exact active consented journey purchase link, and deferred inventory publication. The real two-connection stock regression and the protected reader audits pass.
- The offline provisioner previews 22 initial saved Endpoints at v1 and 31 String variables. Its explicit write path uses a separate provisioning credential and rejects conflicting existing definitions. The isolated observer workflow and bounded runner are prepared and disabled until their external setup and opt-ins are complete.
- One independent combined branch review found five Important defects. One combined fix wave and a scoped re-review closed all five with no new findings: unverified empty commerce results no longer certify zero; commerce buyer grouping works with capture off; browser and commerce HMAC identities are separated; validated declared truncation reaches observer partition recovery; and independent checkout completion is reported alongside the ordered funnel.

## Final local evidence

Checks ran against the reviewed product HEAD. The database suite ran against the same final SQL at `9fb178d4`; the fix wave changed no migration or database fixture. Targeted RED/GREEN evidence is retained in the local SDD reports.

| Check                      | Observed result                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent review         | Whole-branch review plus scoped exact-delta re-review; all five Important findings addressed, no new findings.                                                                                                                                                                                                                   |
| Focused fix regressions    | 255 tests in 23 suites passed, plus 14 operations cases. These are included in the applicable broader checks below.                                                                                                                                                                                                              |
| Full unit run              | 1,434 of 1,435 tests passed in the initial run. One cleanup test hit a Windows sandbox `EPERM` creating its temporary symlink. The unchanged two-case file passed outside that restriction. All 1,435 unique cases are qualified across these runs; the initial full command did not exit zero.                                  |
| Integration and operations | All 35 integration cases in four suites and all 14 operations cases passed. Provider HTTP and child-process behavior are controlled local fakes.                                                                                                                                                                                 |
| Owned PostgreSQL           | All 36 named checks passed, including two exhaustive sweeps of 2,025 same-instant facts, late revisions, stock and checkout concurrency, exact purchase linkage, retention and reader permissions. Before/after core routine, role, ACL and dataset snapshots were identical.                                                    |
| Chromium                   | Trigger sites, installed SDK boundary and ten lifecycle scenarios passed. All seven report scenarios passed, including calendar, URL history, exports, request races, partial outages and responsive tables. Updated Health desktop and mobile screenshots were visually checked. These use local fixtures, not hosted journeys. |
| Types, lint and whitespace | Full TypeScript and ESLint exited zero; ESLint reported the same five existing warnings. The complete branch diff passed `git diff --check`.                                                                                                                                                                                     |
| Formatting                 | All 272 nonignored changed files pass Prettier on their committed contents. Generated database types are explicitly ignored. The existing cron expiry route, Square webhook route and `vercel.json` working copies differ only by Windows line endings; their committed contents pass.                                           |
| Local build                | Next 16.3.3 capture-disabled build exited zero, producing 81 static pages. It used loopback catalog/Redis fixtures and synthetic CI settings. All 75 emitted static files passed the private-canary and server-marker scan. This is not the owner-configured deployment build.                                                   |

Initial browser startup needed access to the cached Chromium binary. Initial build attempts failed at a Turbopack child-process boundary. The successful clean build used Node 24.14.1 first in the child PATH and preserved the earlier generated output inside this task's ignored workspace. No source fix or test assertion change was needed for these environment issues.

Local transcripts, review packages and screenshots remain under `.superpowers/sdd/2026-11-25-admin-analytics`. No task-owned database or historical source core was deleted.

## Remaining after staging deployment

Follow the ordered commands and safeguards in [the operations guide](admin-analytics.md#prepare-the-source-definitions-and-launch).

1. Apply the reviewed migrations through the staging workflow. Audit the restricted reader and its actual connection before enabling its login and connecting the two reporting views to the staging PostHog project.
2. Choose the real launch instant. Verify source mappings and pairing, provision the 22 pinned saved Endpoints with a temporary separate provisioning credential, and prepare the protected operator attestation.
3. Prime the nonvisitor opening marker and perform one-time dataset activation/current-stock baseline using the operations guide. Keep deployed browser capture disabled throughout setup.
4. Build and deploy matched public/private configuration after verification. Exercise real consented and declined journeys, purchase after browser closure, completed refund, the exact active purchase link, all seven reports and CSV. Measure actual delivery and observation lag.
5. Configure the isolated observer GitHub environments, scoped Doppler Service Tokens and explicit repository opt-ins. Confirm successful scheduled runs and truthful gap/failure behavior. Follow the separate production release/tag gate after staging acceptance.

Enabling an environment flag alone does not complete these steps. Actual HogQL responses, connector replacement and cursor behavior, credential scopes, provider retention, authorization and scheduler execution need staging evidence. Five-minute freshness remains a measured target. The bounded raw/publication diagnostic reports incomplete above 2,000 same-instant revisions; the ongoing warehouse partition sweep is separate and has local evidence above that count.

The single deferred presentation Minor is retaining prior report content while an applied request loads. The current skeleton and obsolete-response protection remain in place. This does not certify hosted readiness or block the local staging handoff.
