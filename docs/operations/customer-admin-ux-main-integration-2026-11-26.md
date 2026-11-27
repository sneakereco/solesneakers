# Customer/admin UX main integration verification

Date: 2026-11-26. PR: [#50](https://github.com/sneakereco/solesneakers/pull/50).

A normal merge combines UX parent `d1f126ee908f3fc405b6c1403de2cb4bc77b7d56` with main `19fd3f3d8e1a1ca943d63ff9fd362642dcc994fd`. All seven conflict files were resolved by preserving the behavior of both parents. Main was fetched again and remains at that revision. No service data, migrations, payments, refunds, labels or mail were changed by this integration.

## Resolution contracts

| Conflict                | Combined behavior                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store page              | Keep main Barlow heading/overflow handling and specialty discovery eligibility; retain UX results navigation, deadline and retry behavior.                                      |
| Inventory edit action   | Keep specialty draft data within the authorized bounded initial read and preserve unavailable versus confirmed missing.                                                         |
| Inventory create client | Keep specialty creation and ordinary unknown-save reconciliation.                                                                                                               |
| Featured items          | Keep giveaway insertion, image loading/fallback and action feedback; clothing cards and their skeletons use main full-width mobile geometry with centered snaps.                |
| Navbar                  | Keep saved-claim recovery and responsive header layout alongside session recovery, bounded sign-out, actual invoker restoration and cart readiness.                             |
| Product detail          | Keep specialty presentation and ordinary cart validation, duplicate-add guard, action feedback and image fallback; conditional product types do not conditionally invoke hooks. |
| Proxy                   | Keep the exact public claim POST session exemptions and UX logout exemption; preserve response finalization, cookies, site lock, CSRF, rate limits and staff checks.            |

Related automatic merges were reviewed. The product page now shares one request-local 15-second budget across ordinary cached lookup and live specialty lookup, keeping live claim inventory out of the ordinary cache. The category selector shares the ordinary form's persistent operation owner and is locked during save/upload/check, unconfirmed recovery and confirmed navigation. Specialty active operations also lock category changes. ClaimDialog now passes its accessible name and description to the native shared ModalPortal, which owns Escape, focus containment and focus restoration.

## Regression evidence

- Before: the combined clothing card was off-centre at 320px. After: the existing real-component clothing browser regression passes with matched loaded/skeleton widths.
- Before: three held or sequential live giveaway lookup cases remained pending after 15 seconds. After: metadata and detail fail as unavailable within one complete budget and recover on a new read; existing claimed-prize/live-stock cases still pass.
- Before: the category selector stayed enabled during a held ordinary POST. After: the real selector stays locked through the held request, ambiguous outcome and read-only inventory recovery; the draft remains and only one POST is issued.
- Before: the combined giveaway popup exposed two dialog roles. After: one named native dialog passes real keyboard, mobile, correction, duplicate-click, private-storage, refresh-recovery and uncertain-outcome checks with mocked HTTP.

## Verification

- Unit:155 suites /841 tests passed; the affected final dialog/form/deadline suites were repeated after review fixes:3 suites /21 tests passed.
- Integration:3 suites /21 schema/seed contract tests passed.
- Browser: **PASS: all22 controlled UX browser runners**, plus the real giveaway dialog browser suite with mocked HTTP.
- Typecheck and production build: **PASS: standalone TypeScript and production Next/Webpack build,94/94 generation entries**.
- Formatting: repository check passed with Git-ignored local artifacts excluded.
- Scoped ESLint:0 errors;2 existing advisories for native upload preview images and hard sign-out navigation.
- Git whitespace and conflict-marker checks passed; no unmerged index entries remain.
- Fresh independent integration review: the Important category-owner finding was fixed and re-reviewed. No blocking findings remain. A Minor optional native-dialog selector improvement was deferred: native modal inertness already prevents the attempted background focus.

Source pin: `src` Git tree `42f10345e4388f5b800ab89ca48dc6712884b07f`; `tests` tree `78511385a381ed062f84cc9d762f711a967ae12c`; package blob `f387567d8d5e2e5f6ec40f18a67c1233306a6fda`. Documentation changes after these pins do not change application or test source.

Reproduce with `node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand`, the corresponding integration config, `doppler run -- node tests/browser/ux-journeys.mjs`, `node tests/browser/specialty-claim-dialog.mjs`, `node node_modules/typescript/bin/tsc --noEmit` and `doppler run -- node node_modules/next/dist/bin/next build --webpack`. Browser/provider replies in these component harnesses are controlled fixtures. Production/staging, physical-device, assistive-technology and real-provider qualification remain the separate release gates documented in the original implementation report.

Local verification initially encountered a Jest scan during Next's generated-directory replacement and TypeScript reading review-only parent snapshots. The Jest run was repeated after the build stopped; snapshots were retained as text, and final checks were repeated. These were local harness artifacts, not application failures.
