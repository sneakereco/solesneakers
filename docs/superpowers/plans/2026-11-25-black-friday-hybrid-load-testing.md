# Black Friday Hybrid Load Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a hands-off staging test suite that seeds its own shoppers and inventory, measures 10,000 active shopping sessions plus a limited-stock opening rush, verifies durable outcomes, reports evidence, and cleans up safely.

**Architecture:** Use k6 for protocol traffic and the repository's existing Playwright runtime for the small real-browser cohort. A Node orchestrator owns preflight, fixture/session leases, profile coordination, telemetry, assertions, reporting, and cleanup. Narrow server-only staging adapters simulate external providers while retaining real application handlers, Supabase transactions/auth, Redis permits/limits, and background processing.

**Tech Stack:** Node 24.14.1, JavaScript ES modules with JSDoc contracts for portable harness code, TypeScript for application adapters, Next.js 16.3.3, Supabase JS 2.81.1/Postgres, Upstash Redis, k6 2.4.0, Playwright 1.56.1/its bundled Chromium, existing Jest, Node's test runner, and dev-only web-vitals 5.1.0.

**Spec:** [Approved hybrid load design](../specs/2026-11-25-black-friday-hybrid-load-design.md), approved by the user on November 25, 2026, including automated seeding and minimal operator involvement.

## Global Constraints

- "Hybrid testing: large-scale HTTP traffic and a small real-browser cohort."
- "Staging as the execution environment."
- "10,000 active shoppers doing ordinary shopping activities."
- "A separate opening rush against the same limited-stock items."
- "At the target plateau, run 9,980 HTTP shopper sessions and 20 browser shopper sessions: 10,000 active sessions in total."
- "Keep an explicit 12,000 total-session ceiling across workers."
- "Use 5-10 minute session targets, 5-15 second browsing pauses, 2-5 second cart pauses, and 3-8 second checkout form pauses."
- "Deployment remains the user's responsibility as requested."
- "Do not silently deploy/promote an application or apply unrelated migrations."
- "Use an isolated load-testing deployment within staging, with verified staging Supabase and Redis separation from production and from unrelated shared data."
- "No Grafana Cloud subscription is required by the design."
- "The hands-off orchestrator, automated account/session/catalog seeding, secure configuration template, runtime checks/bootstrap, and interrupted-run cleanup are required deliverables, not optional operator documentation."
- Preserve PR/main staging and production tag gates; prepare changes and instructions without running deployment or stress tests as part of writing this plan.
- Read installed Next.js docs before framework edits; use CodeGraph before locating/reading application code. New application code/tests follow `src/Modules/<Module>/Source/Features/<Feature>` and `Tests/Features/<Feature>`.

## Review Focus

1. A staging Vercel project can have `VERCEL_ENV=production`; require positive project/deployment/resource identity, and never infer safety from the environment label (Tasks 1-2).
2. Killing the orchestrator after creating an auth user or reserving stock must leave an adoptable journal and safe, repeatable cleanup, not orphaned fixtures or deleted unrelated records (Tasks 4, 9-10).
3. Browser and HTTP workers must not reuse identities, exceed the aggregate session ceiling, or claim a target plateau when one worker fails to start (Tasks 4-5, 7, 10-11).
4. A lost payment response, retried webhook, or request without a browser must resolve through real order/event/recovery logic; simulation must not directly mark an order paid (Tasks 3, 6, 9).
5. Missing browser metrics, absent claim functionality, stale deployment attestation, unavailable telemetry, or raw credential-bearing URLs must produce explicit missing/failed evidence with redacted output (Tasks 2, 7-8, 12).

## Execution boundaries and source grounding

Planning baseline is `75a94adba7d1bf47f5d846c2a980dbb8288ce764`. Its application source remains the `d8ce1019` baseline inspected in the spec. Preserve unrelated assessment files and concurrent work. At execution time create an isolated workspace using the worktree skill, inspect current changes, and rebase file choices onto any intervening checkout work before editing.

This is one connected harness, not a plan to implement the business fixes listed in issue #41. Preparation and diagnostic runs can proceed; incomplete inventory/cart/receipt/recovery/campaign requirements remain acceptance gaps. No readiness claim follows simply from implementing the harness.

The approved [specialty claims design](../specs/2026-11-25-specialty-giveaway-claims-design.md) supersedes historical checkout-giveaway requirements for prizes. Its standalone atomic claims consume no cart, payment, ordinary-order, shipping/pickup, or email state. The load spec's campaign paragraph is aligned with that recorded approval. Implement a capability-driven extension: detect the actual deployed claim contract, test its 1,000-submission baseline and progressive rushes when available, and mark absent required coverage unmet. Reconcile historical #37-#39 cases as superseded with an evidence link, not as hidden skips or reasons to implement free checkout. Ordinary paid limited-stock rushes remain independently runnable; this plan does not build the giveaway feature or invent its routes.

Also coordinate with the [checkout/cart hardening design](../specs/2026-11-25-checkout-cart-release-hardening-design.md) and [customer/admin UX design](../specs/2026-11-25-customer-admin-ux-remediation-design.md). Their current approval/implementation state must be checked at execution. Rebase narrow test seams onto the resulting checkout/receipt/cart/recovery contracts instead of creating competing pollers, cart consumption, or financial authority.

Important current seams:

- Checkout factories: `src/lib/checkout/checkout-quote-dependencies.ts`, `prepare-checkout-dependencies.ts`, `payment-api-dependencies.ts`.
- SDK-backed wrappers: `src/lib/square/client.ts`, `checkout-orders.ts`, `payments.ts`; event verification/shipping reads also instantiate clients directly.
- `src/app/api/orders/[orderId]/route.ts` owns request-triggered reconciliation and performs ownership checks first. Browser-independent recovery is a separate readiness requirement, not supplied by faster polling in the test.
- `src/lib/checkout/checkout-pricing-gateway.ts` reads configured category shipping costs locally; retain this real configuration/pricing path. Square calculates final order totals; Shippo validates addresses. Do not replace local business pricing with arbitrary fixture totals.
- `src/lib/email/mailer.ts` is the SMTP boundary; notification worker/outbox/audit handling stays real.
- `src/proxy/rate-limit.ts` uses actual Upstash policies. Do not change thresholds to admit the test. Controlled synthetic network partitions are authenticated harness identities, not forged forwarded IPs.
- Expiration currently lists 50 holds/run, notifications claim 3 jobs/run, and crons run every five minutes. Report those actual limits; the orchestrator cannot make acceptance pass by silently increasing worker frequency/batch size.
- Installed docs read for planning: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{route,proxy}.md`. Proxy state is not shared with handlers; handlers revalidate a signed credential rather than trust a forwarded boolean/global.

## File structure and responsibilities

All paths below are repository-relative. Grouped paths name exact files within the stated directory; tasks specify the files they own. Avoid introducing another broad technical-layer architecture.

| Location                                              | Files and responsibility                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/load/shared/`                                  | `contracts.mjs` versioned schemas/JSDoc types; `profiles.mjs` scenario mathematics; `thresholds.mjs` outcome/budget definitions; `redact.mjs` safe artifacts; `journeys.mjs` transport-injected shopping behavior; `campaign.mjs` actual deployed claim-contract binding |
| `tests/load/config/`                                  | `toolchain.json` exact versions/checksums/image digests; `staging.example.json` nonsecret target/resource manifest; `.env.example` secret variable names only                                                                                                            |
| `tests/load/operator/`                                | `cli.mjs`, `preflight.mjs`, `journal.mjs`, `seed.mjs`, `sessions.mjs`, `workers.mjs`, `telemetry.mjs`, `assertions.mjs`, `cleanup.mjs`, `orchestrate.mjs`, `report.mjs`; one lifecycle responsibility each                                                               |
| `tests/load/k6/`                                      | `shopping.js`, `rush.js`, `arrival.js`, `lib/http.js`, `lib/session.js`, `lib/catalog.js`, `lib/checkout.js`, `lib/metrics.js`; portable k6-only entry points/helpers                                                                                                    |
| `tests/load/browser/`                                 | `probe.mjs`, `journeys.mjs`, `provider-shims.mjs`, `vitals.mjs`, `capture.mjs`; real rendered pages with controlled external SDKs in bulk mode                                                                                                                           |
| `tests/load/runner/`                                  | `bootstrap.mjs`, `Dockerfile`, `compose.yml`; local/US Linux bootstrap and optional existing-host workers                                                                                                                                                                |
| `tests/load/unit/`                                    | One Node `.test.mjs` per harness responsibility named in the tasks below; fixtures in `fixtures.mjs` are local-only fake clients/servers                                                                                                                                 |
| `src/Modules/Checkout/Source/Features/LoadTesting/`   | `contracts.ts`, `settings.ts`, `context.ts`, `run-store.ts`, `control-handler.ts`, `square-adapter.ts`, `shipping-adapter.ts`, `mail-sink.ts`, `provider-selection.ts`; staging-only feature internals                                                                   |
| `src/Modules/Checkout/Tests/Features/LoadTesting/`    | `context.test.ts`, `control-handler.test.ts`, `provider-selection.test.ts`, `square-adapter.test.ts`, `side-effects.test.ts`; meaningful isolation and provider contract checks                                                                                          |
| `src/app/api/internal/load-test/[operation]/route.ts` | Thin, Node-runtime control route for attestation/enrollment/lease renewal/revocation/events/status; no arbitrary SQL, table names, target URLs, or fixture administration exposed publicly                                                                               |
| Existing application seams                            | Minimal optional context/provider selection in the checkout routes/factories, proxy, order status, webhook verification/reads, expiration, address validation, and mailer named in Tasks 2-3                                                                             |
| `tests/database/`                                     | `load-test-invariants.test.mjs`, `fixtures/load-test.mjs`; real independent Postgres connections with isolated synthetic fixture ownership                                                                                                                               |
| `docs/operations/`                                    | `hybrid-load-testing.md` runbook; `load-testing-evidence/` only deliberately committed scrubbed summaries                                                                                                                                                                |
| Repository configuration                              | Modify `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`, `.env.example` only for the owning tasks; preserve deployment workflows                                                                                                            |

## Shared contracts and operator commands

Task 1 defines these exported contracts in `shared/contracts.mjs` with runtime validation and JSDoc typedefs; `contracts.ts` validates the same versioned wire shapes on the server. Include golden cross-runtime contract fixtures so the two validators cannot drift silently.

- `ProfileName`: `smoke | calibration | peak | arrival | rush | rush-worst | claim-rush | stress | soak | faults | acceptance`.
- `TargetManifest`: version, immutable base URL, expected commit/deployment/project, staging Supabase/Redis resource identities, production denylist, migration heads, provider mode, required capabilities, telemetry availability/parity, region, and approved resource budget/ceiling. No credentials.
- `RunPlan`: run ID, profile, target digest, workload/threshold digests, timestamps/deadline, global slot ranges, phase schedule, identities, ordinary-stock budget, hot-stock cases, fault configuration, and toolchain identity. No credentials.
- `RunJournal`: run/target digest, phase (`preflight | seeded | running | draining | asserted | reported | cleaned | failed`), planned/created fixture ownership, child PIDs/worker leases, artifact paths, unresolved outcomes, cleanup cursor. Atomic replacement plus append-only progress records.
- `FixtureBundle`: run ID, fixture IDs and catalog matrix, leased account pool, guest/session ranges, hot products, image URLs, shipping defaults, capability fixtures. Its credential-bearing partition is private and never appears in `RunPlan` or the report.
- `WorkerResult`: run/profile/worker identity, timed active-session samples, completed/offered/dropped work, operation/outcome counts, histogram samples, skew/resource data, error causes, and scrubbed evidence references.
- `InvariantReport`: checked counts, durable wins/stock/holds, accepted/terminal payments, duplicates, cart preservation, eligibility checks, unresolved outcomes; explicit `pass | fail | unmet` per requirement.
- `RunReport`: exact deployment/toolchain/workload, stage results, achieved load, performance gates, invariants, coverage gaps, cleanup state, resource cost assumptions, and final exit classification.

Define supporting typedefs in their owning files and export them for consumers:
`GateResult = {status:'pass'|'fail'|'unmet', reasons:string[]}`;
`WorkerHandle = {id:string, ready:Promise<void>, done:Promise<WorkerResult>, stop():Promise<void>}`;
`Clients = {supabase:SupabaseClient, db:pg.Pool, redis:Redis}` (operator-only);
`JournalStore = {append(kind:string,data:JsonValue):Promise<void>, snapshot():RunJournal}`;
`SessionPool = {leases:ShopperLease[], release(slot:number,generation:number):Promise<void>}`;
`RunnerCapabilities = {id:string, region:string, toolchainDigest:string, httpSlots:number, browserSlots:number, resourceSamples:JsonValue[], proof:'measured'|'unproven'}`.
Task 6 owns `RushSchedule` and its timestamp/slot ranges; Task 8 owns
`TelemetryHandle = {stop():Promise<{samples:JsonValue[], coverage:GateResult[]}>}`;
Task 9 owns `DrainResult`/`CleanupResult` as described there; Task 10 owns
`PreflightReport = {gates:GateResult[], attestation:JsonValue, allowed:boolean}`;
Task 11 owns `WorkerShard` with the fields in its Interfaces block. Use a recursive
JSON-value typedef for serialized data and runtime schemas for every wire boundary.

Future supported commands (they do not exist yet):

```powershell
npm run load:staging -- --profile smoke
npm run load:staging -- --profile acceptance
npm run load:staging -- --stop RUN_ID
npm run load:staging -- --recover RUN_ID
npm run load:staging -- --cleanup RUN_ID
npm run load:staging -- --dry-run --profile acceptance
```

Resolve secrets through existing authorized Doppler/environment access; resolve the target from a local ignored config generated by preflight. Never make the user manually sign requests, seed SQL, create shoppers, run multiple workers, or reset fixtures between profiles. Output one report path and the exact unmet setup action, if any. Exit codes: 0 pass, 1 test/invariant failure, 2 preflight/harness/incomplete required coverage, 3 incomplete cleanup/operator stop. Preserve all underlying reasons when several apply.

## Profiles and acceptance budgets

Implement the spec's exact shopping mix (55/25/15/5), 70/30 guest/account, 80/20 shipping/pickup, 14/6 mobile/desktop browser viewports, pauses, and session lifetimes. Store the values once in `profiles.mjs`; generate k6 options and browser worker plans from the same immutable `RunPlan`.

- Smoke: 1-10 total sessions, 2 minutes. Calibration: 100-500, 5 minutes.
- Peak: 100, 500, 1k, 2k, 5k intermediate steps with 2-minute holds and explicit transitions, then 10k with a 30-minute measurement plateau.
- Arrival: fixed **full-session starts/second**, 10-minute measured hold after a declared warmup long enough to reach steady concurrency. Derive the rate from completed sessions and their durations in a successful 10k peak plateau, including think times and the weighted request distribution, not action RPS. The 5-minute calibration alone may have no completed 5-10 minute sessions and is not sufficient rate evidence. Freeze this rate before the arrival run. Each started session executes the same journey mix; preallocate measured concurrency plus headroom, enforce the aggregate 12k ceiling, and record/fail dropped starts rather than silently reducing demand.
- Rush: 8,000 contenders, 1,980 background HTTP shoppers, 20 browser observers; worst case: 9,980 contenders plus 20 observers. Dispatch contention writes in one measured second. Stock cases 1/10/100 run separately; follow each with 10 minutes of recovery observation.
- Claim rush: start with the approved specialty feature's 1,000 contenders alongside 8,980 background HTTP shoppers and 20 browsers, then progressively test 2k/5k/8k and the 9,980-contender worst case only after lower gates pass. Use the deployed claim decision as the contention operation, including cross-product address/handle races and receipt recovery. Do not use checkout preparation or payment for prizes.
- Stress: at most 12k aggregate sessions, at most 5 minutes. Soak: 10k for 2 hours.
- Faults: bounded 100-500-session runs, one scoped failure at a time, followed by recovery. Acceptance runs smoke, calibration, cold/warm peak, calibrated arrival, rush cases/worst case, stress, soak, and fault profiles in order; fail-fast stops escalation but still asserts/reports/cleans.

Each profile distinguishes warmup, measurement, planned ramp-down and bounded
drain. Reserve up to 10 minutes for an already-started ordinary session to finish;
do not start new actions after its deadline. Report this time and its cost, do
not fold it into the claimed plateau, and distinguish planned shutdown from
unexpected measurement-window interruptions. No next profile starts while the
previous profile still owns active slots or unresolved resets.

Use these frozen per-operation budgets, never an overall average:

| Gate                                          | Value                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Catalog/cart validation/order polling         | p95 < 1,000ms; p99 < 2,000ms                                                                                               |
| Quote/prepare/permit/pay, simulated providers | p95 < 3,000ms; p99 < 5,000ms, excluding user time                                                                          |
| Page TTFB by cache state                      | p95 < 1,500ms; p99 < 3,000ms                                                                                               |
| Unexpected technical failures                 | < 1% per operation and journey                                                                                             |
| Eligible normal checkout terminal outcome     | >= 99% within 30,000ms of payment submission                                                                               |
| Sampled browser metrics by route/viewport     | p75 LCP <= 2,500ms; CLS <= 0.1; INP <= 200ms where measurable                                                              |
| Correctness                                   | Zero oversells, duplicate captures/orders/claims, lost accepted payments, eligibility violations, unrelated cart-edit loss |
| Offered work                                  | Zero dropped scheduled work; no unexplained measurement-window interruption; verified target sessions maintained           |
| Recovery                                      | Hold expiry + at most 2 real worker intervals; payment outcomes within 2 recovery intervals after restoration              |
| Notifications                                 | Oldest deliverable <= 5 minutes at target; post-fault backlog at baseline within 10 minutes                                |
| Generator headroom                            | CPU < 80%, memory < 85%, no saturated network; otherwise classify generator-limited and rerun                              |
| Emergency stop                                | Any invariant/cross-environment violation, or > 5% unexpected errors sustained for 60 seconds                              |

### Task 1: Validated manifests, workload mathematics, and pinned tooling

**Files:** Create `tests/load/shared/{contracts,profiles,thresholds,redact}.mjs`, `tests/load/config/{toolchain.json,staging.example.json,.env.example}`, `tests/load/unit/{contracts,profiles,redact}.test.mjs`, `tests/load/unit/fixtures.mjs`. Modify `.gitignore` to ignore `.load-test/` and all raw test results. No application changes.

**Interfaces:** Produce `parseTarget(value): TargetManifest`, `createRunPlan(target, profile, overrides): RunPlan`, `validateResults(value): WorkerResult`, `redactArtifact(value): JsonValue`, and `buildThresholds(plan): Record<string,string[]>`. Produce all shared contracts above. Later tasks consume these exports rather than duplicate constants.

- [ ] **Step 1:** Add Node tests named `aggregate slots include browsers`, `arrival uses full sessions`, `reject target redirect and changed commit`, and `redact tokens nested in URLs/errors`. Pin assertions:

  ```js
  assert.equal(peak.httpSlots + peak.browserSlots, 10000);
  assert.deepEqual(
    [rush.contenders, rush.background, rush.browserSlots],
    [8000, 1980, 20],
  );
  assert.throws(() => createRunPlan(target, "stress", { totalSlots: 12001 }));
  assert.equal(
    JSON.stringify(redactArtifact({ url: "/orders/a?token=secret" })).includes("secret"),
    false,
  );
  ```

- [ ] **Step 2:** Run `node --test tests/load/unit/contracts.test.mjs tests/load/unit/profiles.test.mjs tests/load/unit/redact.test.mjs`; expect missing-export/module failures before implementation.
- [ ] **Step 3:** Implement the interfaces with exact profile/budget values; reject unsupported overrides, non-HTTPS remote targets, redirects, absent resource identities/budgets, overlapping shard ranges, unbounded durations, and secret-bearing public artifacts. Keep shared profile/journey code imported by k6 free of Node globals and npm-only dependencies; validate rich operator configuration before emitting a portable JSON run plan. Lock k6 2.4.0 release checksums for supported Windows/Linux architectures and Playwright 1.56.1 Chromium/image digests in `toolchain.json`; obtain digests from the actual verified release/image during implementation, never insert invented digests or floating tags. Use the installed Node runtime and existing package dependencies.
- [ ] **Step 4:** Rerun the command; expect all tests pass, including a deliberately failing synthetic threshold returning failure. Check public fixtures contain no credentials and raw artifacts are ignored with `git check-ignore .load-test/example/run.json`.
- [ ] **Step 5:** Commit only Task 1 files: `test: define safe load profiles and run contracts`.

### Task 2: Fail-closed staging enrollment and authenticated harness admission

**Files:** Create application `LoadTesting/{contracts,settings,context,run-store,control-handler}.ts`, tests `LoadTesting/{context,control-handler}.test.ts`, and `src/app/api/internal/load-test/[operation]/route.ts`. Modify `src/proxy.ts`, `src/proxy/rate-limit.ts`, `src/lib/security/checkout-bot.ts`, and `.env.example`. Do not add the internal prefix to global security bypass lists.

**Interfaces:** Produce branded `LoadTestContext` (run, phase, deployment/target digest, mode, fixture/slot scope, expiry); `readLoadTestSettings(env): Settings | null`; `verifyHarnessRequest(request, settings, store): Promise<LoadTestContext | null>`; `resolveFixtureContext(kind, id, store): Promise<LoadTestContext | null>` for durable background work; and `handleLoadTestControl(request, operation): Promise<Response>`. `RunStore` stores signed phase registration, slot leases, owned fixture references, and durable simulated-provider state in an isolated Redis run namespace.

- [ ] **Step 1:** Add Jest tests for default disabled/404 control routes; a staging project with `VERCEL_ENV=production` and matching identities is permitted; production project/DB/Redis identities, wrong host/deployment/commit, expired/revoked credentials, unregistered fixtures, and forged forwarded headers are rejected. Assert disabled mode retains the existing normal security result, not an adapter result.
- [ ] **Step 2:** Run `node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --testPathPatterns=LoadTesting`; expect missing module/export failures.
- [ ] **Step 3:** Implement explicit disabled-by-default settings: `LOAD_TEST_ENABLED`, `LOAD_TEST_ALLOWED_PROJECT_ID`, `LOAD_TEST_SIGNING_KEY`, `LOAD_TEST_RESOURCE_MANIFEST`, and its expected digest. Compare Vercel project/deployment/commit identity and verified Supabase/Redis identities; do not rely on `NODE_ENV` or `VERCEL_ENV` alone. Authenticate nonce-bound attestation/enrollment/renewal/revocation with a server-only signing key; give workers scoped phase credentials expiring at phase deadline + 30 minutes, never longer than 4 hours. The orchestrator renews before phases. No root key reaches VUs or browser pages.
- [ ] **Step 4:** Wire verified harness context to bot-attestation substitution and synthetic network limiter keys only for allowed shopper routes. Strip untrusted internal headers, reverify at route/handler boundaries, preserve CSRF/session/ownership/permit/limiter logic, and keep normal customer mode unchanged. Serve internal control responses `no-store`; no resource secrets or arbitrary data/control operations. Rerun Task 2 tests plus `checkout-api-routes.test.ts`, `checkout-rate-limit.test.ts`, and `site-lock-proxy.test.ts`; expect success and rejected invalid-context cases before any external call.
- [ ] **Step 5:** Commit: `test: isolate authenticated staging load execution`.

### Task 3: Stateful external-provider adapters through real checkout/event paths

**Files:** Create application `LoadTesting/{square-adapter,shipping-adapter,mail-sink,provider-selection}.ts` and tests `{square-adapter,provider-selection,side-effects}.test.ts`. Modify `src/lib/checkout/{checkout-quote-dependencies,prepare-checkout-dependencies,payment-api-dependencies}.ts`, their routes under `src/app/api/checkout/{quote,prepare,payment-permit,pay}/route.ts`, `src/lib/square/{client,payment-order-verification,shipping-address-sync}.ts`, `src/app/api/orders/[orderId]/route.ts`, `src/app/api/webhooks/square/route.ts`, `src/app/api/cron/expire-checkouts/route.ts`, and `src/lib/email/mailer.ts`. Reuse existing shipping validation interfaces instead of changing their business rules.

**Interfaces:** Produce `selectLoadTestProviders(context, store): LoadTestProviders | null`. `squareOrders` exposes `Pick<SquareCheckoutOrdersGateway,'calculate'|'create'|'cancel'|'getCancellationState'>`; `payments` exposes the existing `create` port; `getSquareOrder` and `getSquarePayment` use SDK response types consumed by verification/reconciliation/shipping. `validateShippingAddress` uses the existing validator's input/result types. `captureEmail(input)` preserves `sendEmail`'s `{messageId?}` result. `dispatchDueEvents(context): Promise<EventDispatchResult>` delivers signed events through the real webhook/processor contract.

- [ ] **Step 1:** Write tests for consistent calculated/created/read totals; SDK bigint-money round trips through persistent adapter state; duplicate payment idempotency across two adapter instances; changed-payload idempotency conflict; decline versus ambiguous timeout; duplicate/out-of-order signed events; a paid order refusing cancellation; and notification retry/audit deduplication. Assert a fake ledger event without a successful real reservation cannot create a durable paid order.
- [ ] **Step 2:** Run the LoadTesting Jest command plus `tests/unit/checkout-api-routes.test.ts` and `tests/unit/square-payment-event.test.ts`; expect new adapter tests fail initially.
- [ ] **Step 3:** Implement atomic persistent adapter transitions in the run-scoped Redis store, including configurable latency/fault schedules, fake order/payment IDs bound to registered fixtures, a capture ledger, and signed completion events. Add optional verified-context arguments to checkout dependency factories; preserve their existing no-context behavior. Use narrow structural ports where concrete gateway classes have private members. Keep local shipping/pricing configuration, authoritative cart totals, real DB holds/orders, real permits, and event processing. Unknown fake IDs fail closed instead of falling through to real Square.
- [ ] **Step 4:** Resolve background provider selection from persisted ownership after ordinary order authorization, not a browser header. Wire Square order verification, shipping reads, status reconciliation, expiration, and mail delivery; keep real notification worker/audit and cron schedules. The bulk run must make zero Square/Shippo/SMTP egress calls, including quote/prepare and after browser closure. A separate explicit Sandbox mode uses real integrations for bounded tests, with native-wallet completion recorded separately. Rerun the tests plus existing shipping validation, payment verification, reconciliation, and notification suites; require normal mode unchanged, adapter contract checks passing, and no direct SQL shortcut to paid state.
- [ ] **Step 5:** Commit: `test: simulate external providers behind real checkout contracts`.

### Task 4: Automatic fixture seeding, shopper leases, and real sessions

**Files:** Create `tests/load/operator/{journal,seed,sessions}.mjs` and `tests/load/unit/{journal,seed,sessions}.test.mjs`. Extend Task 2 run-store fixture/lease operations, with their existing tests, rather than adding a second registry.

**Interfaces:** Produce `openJournal(runPlan, artifactDir): Promise<JournalStore>`; `seedFixtures(target, plan, clients, journal): Promise<FixtureBundle>`; `prepareSessionPool(target, plan, fixtures, clients): Promise<SessionPool>`; and `leaseShopper(pool, slot, generation): Promise<ShopperLease>`. A lease contains unique logical session/device/cart/idempotency identities and its private cookie/token material, never administrator credentials.

- [ ] **Step 1:** Add tests `adopt account after crash between create and journal commit`, `guest slots create no auth accounts`, `never lease account to two active slots`, `refresh updates real cookie chunks`, and `ordinary stock covers longest profile`. Assert 10k peak leases are unique, repeated seed/recover creates no duplicates, and unrelated rows fail ownership checks.
- [ ] **Step 2:** Run `node --test tests/load/unit/journal.test.mjs tests/load/unit/seed.test.mjs tests/load/unit/sessions.test.mjs`; expect missing implementations.
- [ ] **Step 3:** Implement write-ahead ownership journaling with atomic files (POSIX private modes, Windows current-user ACLs; fail if shared-readable). Create confirmed synthetic accounts with `supabase.auth.admin.createUser({email_confirm:true,...})`, corresponding customer profiles, guest identities, addresses, catalog/taxonomy/images, shipping defaults, and hot stock. When the specialty capability exists, seed its campaign/prizes plus synthetic Instagram handles/address-equivalence cases through its actual schema contract; its shoppers need no email/account/fulfillment selection. Use unique `.test` emails/random passwords for ordinary checkout and existing schema/repository contracts, preserving compatibility fields until the actual schema changes. No shared-table reset, staff accounts, OTP blast, uploaded real photos, or production data.
- [ ] **Step 4:** Derive account pool from maximum concurrently leased account slots plus 10% headroom (12k _ 30% _ 1.1 = 3,960 with the default ceiling); inactive accounts may be reused only after previous sessions release, with fresh logical session/device/cart identifiers. Generate rotating guest/session identities for the whole duration without registering every guest. Prepare real Supabase sessions using bounded auth calls and the existing SSR cookie serialization, verify `/api/auth/session`, test refresh/revocation, and prime rush sessions before measurement. Use `SharedArray`/per-shard private fixture files rather than copying the whole credential pool into every VU. Ordinary inventory is at least twice the maximum configured checkout basket-unit demand; abort on exhaustion. Rerun unit tests and a local isolated fixture create/recover cycle; expect no leaked/duplicate identities or emails.
- [ ] **Step 5:** Commit: `test: automate isolated shopper and inventory fixtures`.

### Task 5: Realistic k6 shopping journeys and sustained arrivals

**Files:** Create `tests/load/shared/journeys.mjs`, `tests/load/k6/{shopping,arrival}.js`, `lib/{http,session,catalog,checkout,metrics}.js`, `tests/load/operator/workers.mjs`, and `tests/load/unit/{shopping,workers}.test.mjs`. Generated profile manifests are inputs, not committed per-run JS.

**Interfaces:** Produce k6 exports `shopperSession()` and `arrivalSession()`; portable shared helpers `runCatalogJourney(session, plan, transport): Promise<void>`, `runCartJourney(session, plan, transport): Promise<void>`, `runCheckoutJourney(session, plan, transport): Promise<CheckoutOutcome>`; operator `launchWorkers(plan, fixtures, options): Promise<WorkerHandle[]>`. Define `JourneyTransport` with `request(input): ResponseLike|Promise<ResponseLike>`, `nowMs():number`, `pause(seconds):void|Promise<void>`, and `emit(name,value,tags):void`. Its `ResponseLike` has status/headers/body/timing; `CheckoutOutcome` has accepted order/payment references, terminal status, timings, and expected/unexpected classification. Node tests exercise the portable core with an HTTP fixture transport; k6 wrappers supply native HTTP/clock/sleep/metric adapters. Every operation emits bounded tags and offered/completed counts.

- [ ] **Step 1:** With a deterministic local HTTP fixture server, write tests for the exact quote -> prepare -> permit -> pay -> status sequence, expected stock conflict versus unexpected 403/429, invalid HTTP-200 bodies, session refresh, absent stock, polling deadlines, and planned versus achieved session counts. Assert no fictional add-to-cart API request and no repeated login per operation.
- [ ] **Step 2:** Run `node --test tests/load/unit/shopping.test.mjs tests/load/unit/workers.test.mjs`; expect missing handlers initially. Keep the local server test limited to harness behavior, explicitly not purchase evidence.
- [ ] **Step 3:** Capture actual staging/local production-build navigation requests and bind first-party HTML/RSC/prefetch/API/assets to the existing routes. Implement separate cookie jars, real route bodies/quote fingerprints/guest tokens, realistic pauses, per-session rotation, repeated cart validation and bounded auth refresh. Preserve the client cart distinction: HTTP scripts submit the equivalent server requests; browser cases own actual local-storage/multi-tab state assertions. Avoid unbounded URL tags and never export raw order-access URLs.
- [ ] **Step 4:** Generate peak/soak/stress k6 scenarios and an open arrival model using full-session starts and measured duration; do not append an extra pacing sleep to the arrival executor. Preserve the ordinary journey's user think times inside the session. Require valid completed-session evidence from the target peak before setting the arrival rate; test that a zero-completion calibration is rejected. Configure per-operation thresholds and zero dropped work. Reserve slot ranges so protocol plus browser slots stay within limits, including across process boundaries. Validate with `k6 inspect tests/load/k6/shopping.js` and `k6 inspect tests/load/k6/arrival.js` using generated local fixture manifests, then a 1-10-session local smoke; expect k6 exit 0 only when offered work, response schemas, and thresholds pass. Intentionally invalid 403/429 and exhausted-VU fixtures must produce nonzero results.
- [ ] **Step 5:** Commit: `test: model real shopping sessions and arrival load`.

### Task 6: Synchronized rushes and durable inventory/payment assertions

**Files:** Create `tests/load/k6/rush.js`, `tests/load/shared/campaign.mjs`, `tests/load/operator/assertions.mjs`, `tests/load/unit/{rush,assertions}.test.mjs`, `tests/database/load-test-invariants.test.mjs`, and `tests/database/fixtures/load-test.mjs`. Reuse real reservation/order/event/claim contracts; do not modify stock rules in the harness.

**Interfaces:** Produce `createRushSchedule(plan, clockSamples): RushSchedule`; `collectDurableOutcomes(clients, plan, journal): Promise<InvariantReport>`; and `assertRunInvariants(report, plan): GateResult`. `RushSchedule` defines a common start instant, disjoint contender/background/browser leases, contention kind (`purchase | specialty`), and the measured one-second dispatch window. `bindCampaignContract(attestation): CampaignContract | null` validates a versioned first-party contract exposing actual validation/claim/recovery route paths and request/response schemas; no arbitrary URLs or invented feature implementation.

- [ ] **Step 1:** Write tests asserting exact durable winners 1/10/100 for ordinary all-eligible, successful-payment cases; duplicate submissions/captures count once; released holds allow a later winner without overselling; paid-versus-expiry races preserve accepted outcomes; and arrival skew outside one second invalidates synchronized-rush evidence. For actual specialty claims, assert no hold on form open, zero payment/order creation, one durable winner per unit, and cross-product duplicate address or handle rejection with private receipt recovery after response loss. HTTP success without its corresponding durable result must fail.
- [ ] **Step 2:** Run `node --test tests/load/unit/rush.test.mjs tests/load/unit/assertions.test.mjs`; expect missing functions. Add a real DB test that accepts only a named disposable loopback database and uses independent connections/barriers; a remote/production-like URL must be rejected before writes.
- [ ] **Step 3:** Implement synchronized preparation/reservation release after sessions/quotes are ready, with clock calibration and request-dispatch timestamps. Add a separate unprimed validation/quote burst so prewarming does not hide provider/protection limits. Register created orders/payments into durable run ownership as they are observed; reconcile response-loss cases from the capture ledger and DB, not only client success counts. Measure winners and conflicts separately.
- [ ] **Step 4:** Implement read-only, run-scoped SQL/ledger assertions for stock conservation/holds, orders/items, captures, orphan accepted outcomes, receipt snapshots, and specialty claims/eligibility. Resolve campaign coverage through actual deployed capabilities: `none | specialty-claims`; absent required capability is unmet. Bind the real specialty module's validation/claim/recovery contract when implemented and include its 1,000-submission baseline before larger profiles; real on-demand address validation/provider throttling is separate evidence from prevalidated synthetic contention fixtures. Do not route prizes through payments or implement the feature itself. Run `node --test tests/database/load-test-invariants.test.mjs` against the disposable DB prepared by its fixture helper; require real contention results and repeatable rollback/cleanup. Missing Postgres is an explicit unrun check, never a mock substitute. Rerun unit tests and low-load rush against the local controlled application.
- [ ] **Step 5:** Commit: `test: prove limited-stock outcomes from durable state`.

### Task 7: Concurrent browser probes and automated browser runtime setup

**Files:** Create `tests/load/browser/{probe,journeys,provider-shims,vitals,capture}.mjs`, `tests/load/unit/browser.test.mjs`, and extend operator worker/browser-result handling. Add exact dev dependency `web-vitals: 5.1.0` in `package.json`/lockfile; retain Playwright 1.56.1 compatibility and production dependencies.

**Interfaces:** Produce `runBrowserCohort(plan, fixtures, options): Promise<WorkerResult>`; `installBulkProviderRoutes(context, fixture): Promise<void>`; `collectVitals(page, emit): Promise<void>`; and `captureJourneyRequests(page): Promise<NavigationCapture>`. These use Task 4 leases and the same run/phase schedule as HTTP workers.

- [ ] **Step 1:** Add tests for a missing Chromium executable, absent LCP/INP samples, a blocked real perimeter, leaked authorization in traces/screenshots, and failure to launch all browser slots. Assert missing evidence fails its coverage gate instead of becoming zero latency. Add browser acceptance cases for cart edits during validation, login/cart merge, two tabs, receipt preserving unrelated additions, and visible stock/pending/error feedback.
- [ ] **Step 2:** Run `node --test tests/load/unit/browser.test.mjs`; expect missing runner. Reuse patterns from the existing browser harnesses, without treating their mocked component pages as hosted load coverage.
- [ ] **Step 3:** Implement Playwright isolated contexts, 14 mobile-sized and 6 desktop-sized slots at target, half accepting/half rejecting optional analytics. Use 5-minute browser sessions cycling through the critical rendered journeys so both viewport groups collect enough observations during the peak; record deliberate high-risk browser sampling separately from the weighted HTTP mix. Inject dev-only web-vitals into browser probes, collect LCP/CLS/INP with lifecycle flush, count observations, and report insufficient samples (minimum 20 navigation samples per required route/viewport; interaction metrics require actual interactions). Do not add measurement code to the production customer bundle. All first-party app pages/assets remain real.
- [ ] **Step 4:** In controlled bulk mode, route only external Square/Turnstile SDK requests to the explicit fixture shims and block other bulk third-party egress; preserve first-party page/UI handlers, server permits, and real transaction outcomes. Normal-perimeter probes have no harness admission or provider shims and remain bounded. Detect/install the locked Playwright Chromium automatically or use the pinned runner image; absent runtime is a preflight error. Run local browser tests plus existing checkout-progress, shipping-validation, checkout-success and measurement suites, then a bounded hosted smoke after user deployment; require truthful spinner/error/receipt behavior, actual browser/HTTP overlap, and zero third-party bulk calls.
- [ ] **Step 5:** Commit: `test: sample storefront experience during protocol load`.

### Task 8: Correlated telemetry, meaningful thresholds, and final reports

**Files:** Create `tests/load/operator/{telemetry,report}.mjs` and `tests/load/unit/{telemetry,report}.test.mjs`; extend Task 1 redaction/thresholds and Task 5 metric emission. No required paid observability service.

**Interfaces:** Produce `startTelemetry(plan, sources): Promise<TelemetryHandle>`; `evaluateRun(plan, workerResults, invariants, telemetry): RunReport`; and `writeRunReport(report, artifactDir): Promise<{jsonPath, markdownPath, exitCode}>`. `TelemetryHandle.stop()` returns scrubbed timed samples plus source availability.

- [ ] **Step 1:** Add tests `one failing operation fails whole run`, `fast stock conflicts cannot hide slow winners`, `percentiles merge samples not worker percentiles`, `missing DB telemetry is unmet`, `stopped browser reduces achieved cohort`, and `redact raw URL/stack/auth material`. Assert the prescribed p95/p99/UX/invariant/load/recovery values at their exact boundaries.
- [ ] **Step 2:** Run `node --test tests/load/unit/telemetry.test.mjs tests/load/unit/report.test.mjs`; expect missing implementations.
- [ ] **Step 3:** Implement generator CPU/memory/network, clock skew, active slots, scheduled/completed/dropped work; application request/error/cache/429 signals; Postgres CPU/connections/locks/query latency; Redis limit/availability; unresolved holds/payments/event lag; and notification count/age. Reuse available platform integrations or exported snapshots; if an API/metric is unavailable, record its exact coverage gap rather than inventing a value. Poll at bounded intervals, record measurement overhead, and include simulated-ledger Redis overhead separately.
- [ ] **Step 4:** Aggregate raw observations or compatible histogram buckets for percentiles, with capped-cardinality tags, sample counts, immutable commit/deployment/workload/toolchain/fault settings, geography and tier parity. Maintain both HTTP timings and durable journey outcomes. Combine k6 exit/thresholds, browser assertions, invariant checks, and missing required evidence into one nonzero result. Run tests and generate a golden scrubbed local report that intentionally fails an operation, a missing-metric case, and a capture invariant; expect all failures visible without secrets.
- [ ] **Step 5:** Commit: `test: report achieved capacity and correctness gates`.

### Task 9: Recovery faults and idempotent run-owned cleanup

**Files:** Create `tests/load/operator/cleanup.mjs`, `tests/load/unit/{recovery,cleanup}.test.mjs`; extend adapter fault settings, assertion collection, and real database tests. Keep ordinary recovery/notification implementation changes outside the harness unless reviewed as a separately bounded fix.

**Interfaces:** Produce `drainRun(target, plan, clients, journal): Promise<DrainResult>` and `cleanupRun(target, journal, clients): Promise<CleanupResult>`. `DrainResult` lists unresolved owned holds/payments/jobs; `CleanupResult` is `cleaned | incomplete` with exact remaining owned IDs kept only in private artifacts.

- [ ] **Step 1:** Write tests for lost browser, lost response after capture, duplicate/reordered completion events, definite decline, expired hold versus in-flight payment, SMTP failure then recovery, Redis/DB timeout, and cleanup interrupted after each deletion group. Assert unrelated fixtures survive, cleanup refuses a changed target digest, and a pending accepted payment is not deleted.
- [ ] **Step 2:** Run `node --test tests/load/unit/recovery.test.mjs tests/load/unit/cleanup.test.mjs`; expect missing exports. Use an isolated disposable stack for actual DB/Redis faults; never toggle a shared resource or inject faults into another run.
- [ ] **Step 3:** Implement deterministic fault profiles and recovery observation using real configured worker intervals. Do not have the harness silently process pending payments or drive crons faster to conceal missing browser-independent recovery. If the deployed app cannot recover without a browser, its gate fails and links the finding. Exercise payment/expiry races on independent DB connections, after both dependency restoration and browser closure.
- [ ] **Step 4:** After assertions and evidence capture, drain safely; delete only registry/journal-verified run-owned dependent records in FK order, then catalog/auth objects and adapter state. Use allowlisted entity operations rather than arbitrary table names. Preserve unresolved financial/job records and report incomplete cleanup; recover with the same journal/run ID, including an account created before the last journal flush. Expiry/deadline/revocation must not prevent authenticated operator cleanup. Rerun unit and actual DB tests and a forced-termination smoke; expect a second cleanup to be a no-op and unrelated canary rows unchanged.
- [ ] **Step 5:** Commit: `test: recover interrupted load runs without losing evidence`.

### Task 10: One-command orchestration from preflight to cleanup

**Files:** Create `tests/load/operator/{cli,preflight,orchestrate}.mjs`, `tests/load/unit/{preflight,orchestrate}.test.mjs`; extend journal/workers/report integration. Add `load:staging` script using `node tests/load/operator/cli.mjs`, plus `test:load` and `test:load:database` commands. The CLI uses existing authorized Doppler/environment access; it never prints secrets or silently changes deployment settings.

**Interfaces:** Produce `preflightRun(target, profile, dependencies): Promise<PreflightReport>`; `executeRun(target, profile, dependencies): Promise<RunReport>`; and `main(argv, dependencies): Promise<number>`. Support the six operator command forms above. Dependency interfaces expose Task 4 seed/session, Task 5 workers, Task 8 telemetry/report, and Task 9 drain/cleanup functions.

- [ ] **Step 1:** Add end-to-end lifecycle tests with injected clients for correct phase order, Windows paths containing spaces, missing one secret, changed deployment after preflight, worker failure, signal/forced exit, expired phase credential during soak, another run holding a lease, and failure at every phase. Assert no seed/write/traffic happens before successful preflight; test failure still writes a report and attempts safe cleanup.
- [ ] **Step 2:** Run `node --test tests/load/unit/preflight.test.mjs tests/load/unit/orchestrate.test.mjs`; expect missing implementations.
- [ ] **Step 3:** Implement signed attestation of immutable target/deployment/commit/schema/resource identity and provider/perimeter mode. Recheck identity before seeding and every phase, prohibit redirects and concurrent target-changing operations, and stop if alias/deployment drifts. Validate tooling/browser availability, isolation/denylist, fixture budget, generator proof, telemetry, and a recorded resource/cost ceiling. Generate scoped credentials/config automatically; report missing account authorization with one concrete remediation instead of asking for manual SQL or many dashboard operations.
- [ ] **Step 4:** Implement the journaled lifecycle: preflight -> seed -> sessions -> smoke -> coordinated workers/telemetry -> drain -> invariants -> report -> scoped cleanup. `acceptance` iterates the required profiles automatically with isolated hot-stock resets and cold/warm cache handling; failed lower stages stop escalation. Globally lease active slots, start only after worker ready barriers, enforce the emergency stop, reap children on Windows/Linux, and provide `--stop`, `--recover`, `--cleanup`, and side-effect-free `--dry-run`. Rerun tests and a local fake-application lifecycle; expect exact exit classes 0/1/2/3 and no hidden manual fixture steps.
- [ ] **Step 5:** Commit: `test: orchestrate hands-off staging load profiles`.

### Task 11: Measured local/US runner bootstrap and global worker coordination

**Files:** Create `tests/load/runner/{bootstrap.mjs,Dockerfile,compose.yml}` and `tests/load/unit/runner.test.mjs`; extend operator worker leases and config/toolchain manifest. Reuse current Node/Playwright tooling and available compute before proposing any paid service.

**Interfaces:** Produce `bootstrapRunner(config): Promise<RunnerCapabilities>` and `planWorkerShards(runPlan, capabilities): WorkerShard[]`. A shard has disjoint slot/session generation ranges, common phase start, resource/deployment digests, deadline, and a private fixture partition. It cannot independently inflate the global target.

- [ ] **Step 1:** Write tests for mismatched k6/Chromium versions or checksums, overlapping shard IDs, unstarted shard, clock skew that invalidates the rush, CPU/memory saturation, and network loss while a lease is active. Assert a 9,980-HTTP + 20-browser target is never multiplied by worker count or replaced with configured-only counts.
- [ ] **Step 2:** Run `node --test tests/load/unit/runner.test.mjs`; expect missing bootstrap/sharding functions.
- [ ] **Step 3:** Implement version-checked local bootstrap and optional pinned Linux image; container secrets are runtime-only mounts/environment, never image layers. Pass subprocess arguments as arrays, not shell-built command strings. Automatically install the locked browser runtime when authorized/available, verify k6 provided by the user, and calibrate real headroom. Use k6 execution segments or explicit disjoint partitions with coordinated start/slot accounting; browser workers run separately if needed. Bounded credentials/fixtures transfer only to enrolled workers.
- [ ] **Step 4:** Run local smoke/calibration and a two-worker rehearsal on existing capacity. Confirm actual aggregate slots, valid rush dispatch window, zero dropped work, and measured CPU <80%/memory <85%/unsaturated network; otherwise produce an explicit generator-limited report. Prepare a concrete US host size/region/duration/cost option if needed, but do not provision or assume the budget. Re-run the profile on measured capacity before accepting full-load evidence.
- [ ] **Step 5:** Commit: `test: package measured load generators and browser workers`.

### Task 12: CI, operator handoff, and staged acceptance execution

**Files:** Modify `.github/workflows/ci.yml` only for safe harness validation. Create `docs/operations/hybrid-load-testing.md` and extend `tests/load/unit/orchestrate.test.mjs` for complete acceptance ordering. Update the approved design only to record intentional, reviewed implementation refinements. Scrubbed measured summaries may later be committed under `docs/operations/load-testing-evidence/`.

**Interfaces:** Produce a documented repeatable operator interface, a pre-deployment prerequisite report, and `acceptance` results in the Task 8 format. The runbook names the exact commands, secret names, target isolation checks, stop/recover/cleanup, provider/perimeter modes, evidence limits, and resource budget requirements. It distinguishes preparation, user deployment, diagnostic measurements, and complete acceptance.

- [ ] **Step 1:** Add a CLI integration test where `--dry-run --profile acceptance` reports every required phase (cold/warm peak, arrival, stock 1/10/100, worst rush, specialty baseline/progressive claim rushes, stress, 2-hour soak, faults, perimeter/Sandbox coverage) with no writes or subprocess load. Missing specialty capability is shown as an unmet branch, not an omitted success. Add a fake acceptance failure test proving later load stages do not run and reporting/cleanup still do.
- [ ] **Step 2:** Run `npm run test:load`; expect new ordering assertions fail until the complete profile/runbook contract is wired. CI may run Node/Jest tests and bounded local harness smoke only; no staging credentials or full stress run on PR/push. Use the existing `ubuntu-24.04` browser-compatible runner and pinned tooling.
- [ ] **Step 3:** Finish CI integration, exact setup templates, and runbook. Routine user actions remain deployment, initial k6 installation, and starting/asking the agent to start a profile. Prepare any one-time access/configuration or cost action before asking for it. Reconcile #41's target to 10k in the implementation delivery and retain issue-linked unmet requirements; never close readiness dependencies from harness tests alone. Complete relevant Jest/unit/integration/browser checks, `npm run typecheck`, scoped lint/formatting, and a production build with load mode both disabled and explicitly isolated. Keep all PR/staging/production release gates.
- [ ] **Step 4:** After the user deploys the reviewed implementation and the preflight has concrete isolation/resources, execute smoke -> calibration -> diagnostic increasing-load stages automatically. Fix demonstrated harness defects, link demonstrated application findings to bounded repairs, and rerun affected stages. Execute the full acceptance sequence only when lower gates permit, including real DB contention, normal perimeter checks and bounded real Sandbox contracts. Preserve actual worker cadence; do not shorten the 30-minute peak or 2-hour soak and call it complete. If resources/dependencies block a phase, report the precise remaining action and keep prior results labeled diagnostic.
- [ ] **Step 5:** Commit the runbook/CI and intentionally selected scrubbed evidence with `test: document and gate hybrid staging load acceptance`. Report exact tested commit/deployment, achieved session counts/RPS, operation latency/failures, stock/order/capture invariants, UX/perimeter/provider evidence, recovery and cleanup, costs/parity, bottlenecks, and coverage gaps. Claims of 10k application capacity, provider compatibility, perimeter admission, and production readiness remain separate conclusions.

## Verification and execution handoff

All steps remain unchecked: this document plans implementation; it does not install tooling, seed users, change staging, or run load. Test examples describe future assertions, not recorded passing tests. The user owns staging deployment. Execution should begin with the worktree skill and the selected execution workflow, then Task 1; do not launch high load before isolation/seed/cleanup tests pass.

Recommended execution method is **Native**, because fixture identity, server adapters, and orchestration share tightly coupled interfaces; one implementer can keep them aligned, with a fresh whole-branch reviewer before staging. Subagent-driven execution is also supported when per-task independent reviews are preferred. The user has not chosen an execution method yet.

## Self-review and coverage map

| Approved spec requirement                                                                                 | Owning tasks                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Approaches, intent, unchanged production behavior and release gates                                       | Header, constraints, Tasks 2-3, 12 |
| Safe deployment/resource identities, real auth/CSRF/ownership/Redis limits                                | 1-4, 10                            |
| Simulated Square/Shippo/SMTP/analytics, real event/transaction/background state                           | 3, 7, 9                            |
| Realistic 10k mix, pauses, identities, session refresh, pages/RSC/assets                                  | 1, 4-5, 7                          |
| Concurrent browser cohort, mobile/desktop, consent, cart/login/tab/receipt feedback                       | 5, 7-8                             |
| Opening rush 8k/1,980/20, worst rush, stock 1/10/100 and true dispatch skew                               | 1, 6, 11                           |
| Approved specialty claim eligibility/atomicity and separate ordinary checkout, without inventing features | 4, 6, 8, 12                        |
| Cold/warm, sustained arrival, spike/stress, 30-minute peak, 2-hour soak                                   | 1, 5-6, 10, 12                     |
| Independent DB correctness, replay, lost browser/response and dependency recovery                         | 3, 6, 9                            |
| Per-operation performance/UX/load/invariant/recovery thresholds and nonzero status                        | 1, 5-10                            |
| DB/Redis/application/generator/queue telemetry and missing-evidence handling                              | 8, 11-12                           |
| Synthetic seed/reset, secure secrets, no manual SQL/accounts, private artifacts                           | 1, 4, 9-10                         |
| Abort, forced-kill recovery, idempotent scoped cleanup and retained evidence                              | 4, 9-10                            |
| Runtime detection/bootstrap, global worker limits, existing capacity and explicit costs                   | 1, 7, 10-12                        |
| Exact deployment/results, unresolved issue evidence, repair/rerun and operator runbook                    | 8, 10, 12                          |

Self-review checks: each planned interface is defined before consumers; node/k6/browser/server contracts are separated; steps have concrete tests/commands/outcomes; all five Review Focus cases have owning tests; all approved requirements have task coverage. No product implementation code is embedded in this plan. Infrastructure/provider gaps are explicit execution gates, not unspecified implementation behavior.

## Primary references checked during planning

- [k6 2.4.0 release](https://github.com/grafana/k6/releases/tag/v2.4.0) and [execution segments/options](https://grafana.com/docs/k6/latest/using-k6/k6-options/reference/).
- [k6 open/closed workloads](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/), [SharedArray](https://grafana.com/docs/k6/latest/javascript-api/k6-data/sharedarray/), and [dropped iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/).
- [Supabase admin account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser); server-side only with confirmed synthetic email.
- [Vercel deployment/project/commit identity variables](https://vercel.com/docs/environment-variables/system-environment-variables).
- [web-vitals 5.1.0](https://github.com/GoogleChrome/web-vitals/tree/v5.1.0), injected into probes only.
- Installed Next.js docs and current application files identified in Source grounding; [existing checkout evidence](../../operations/checkout-validation.md) and [compatibility contracts](../../operations/single-store-checkout-contracts.md).
