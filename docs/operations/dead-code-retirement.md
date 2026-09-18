# Dead-code retirement execution evidence

## Release A — application compatibility

Starting commit: `25c53b3fc5661eec2d3f260603c948473c98e92f`.
Branch: `codex/dead-code-retirement`.

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

Release B must stay off auto-deploying main until A is confirmed in BOTH staging and production. After B, A is the oldest compatible application rollback target. Deleted data requires a verified backup restore.

## Release B — local verification pending

A disposable copy of the existing local database was restored into `codex_retirement_verified_20260918` on the Sole Sneakers local PostgreSQL instance. The ordinary `postgres` database and other local projects are unchanged. The first restore attempt stopped on an ownership permission error in a separate incomplete `codex_retirement_20260918` database; neither copy serves the application.
