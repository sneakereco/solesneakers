# Black Friday hybrid load testing design

Status: proposed; the user selected the hybrid approach on November 25, 2026.
This document requires approval before implementation.

## Intent and size

Build a repeatable testing project that answers whether Sole Sneakers can serve
10,000 concurrent active shoppers browsing, searching, editing carts, and checking
out, including a synchronized opening rush for limited-stock products. Find the
first capacity limit and incorrect customer outcomes, then produce evidence for
the exact staging deployment tested.

This is a testing project, not just installing a command-line tool. It includes
workload scripts, safe data, controlled external integrations, browser probes,
monitoring, execution controls, and a capacity/correctness report.

## Confirmed decisions and proposed defaults

The user confirmed:

- Hybrid testing: large-scale HTTP traffic and a small real-browser cohort.
- Staging as the execution environment.
- 10,000 active shoppers doing ordinary shopping activities.
- A separate opening rush against the same limited-stock items.
- A hands-off operator experience: the user expects to deploy to staging and
  install k6, while the delivered tooling handles seeding and routine test setup,
  execution, reporting, and cleanup. Identify unavoidable account/access or
  resource decisions explicitly rather than leaving manual setup hidden.

All numerical mixes, durations, latency budgets, runner choices, and test-adapter
details below are the author's proposed defaults. They are not previously agreed
business requirements. Approval of this document accepts those defaults; any
changes must be recorded before the measured run.

The current [BF-13 issue #41](https://github.com/sneakereco/solesneakers/issues/41)
still says 2,000 shoppers. This design raises the target to 10,000 while retaining
its correctness, recovery, and reporting requirements. Reconcile that issue's
target during implementation; do not create a competing readiness definition.

## Existing project and constraints

Inspected source baseline: `d8ce10191a294a0974be759bb2cb43b0bd980c53` on
`codex/customer-admin-ux-audit`. This is a source-inspection reference, not a tested
release candidate or a verified deployed commit.

- The checkout has separate quote, preparation/reservation, payment-permit,
  payment, order-polling, and receipt operations. Exercise the complete sequence.
- The store page directly invokes catalog/filter/taxonomy services. API traffic
  alone does not cover server rendering or Next.js client navigation requests.
- `src/proxy.ts` refreshes sessions and applies site-lock, bot, CSRF, rate-limit,
  and administrator gates. Checkout dependency factories also enforce browser
  verification, ownership, attempt limits, and guest Turnstile verification.
- `createCheckoutQuoteDependencies`, `createPrepareCheckoutDependencies`, and
  `createDirectPaymentDependencies` expose useful integration boundaries, but no
  production-safe load-testing mode is assumed to exist today. Quote and prepare
  call Square too; controlling only the final payment request is insufficient.
- Vercel staging deploys from `main`; production has a separate release workflow.
  Keep those gates. A load-test deployment must not promote to production or
  silently replace shared staging. Expiration and notification crons must be
  accounted for in the test environment.
- Existing browser harnesses include mocked provider responses. They are useful
  regressions, not evidence of hosted capacity or real payment completion.
- No committed k6 suite was found in the inspected checkout. Select and pin k6,
  its browser runtime, and any runner image during implementation.

Read the installed Next.js documentation before any application code changes.
Keep new application feature code and tests together under the repository's
module conventions; keep the cross-cutting load suite under `tests/load/`.

## Approaches considered

| Approach                | Benefit                                                                    | Limitation                                                            | Decision                         |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| HTTP only               | Efficient high-load page/API and concurrency testing                       | Does not execute frontend JavaScript or verify interaction/rendering  | Rejected as insufficient alone   |
| Hybrid HTTP and browser | High-load capacity plus sampled real customer journeys under the same load | Requires fixture, runner, and browser coordination                    | Selected by the user             |
| Browser only            | Every simulated shopper uses a browser                                     | Much higher generator resources and operating cost at 10,000 sessions | Rejected for the initial project |

## Goals, non-goals, and unacceptable outcomes

Goals are repeatable achieved-load evidence, useful customer-facing latency,
correct inventory/orders/cart state, clear unsuccessful outcomes, and recovery
after bursts or dependency failures. Include guest/account, shipping/pickup,
accepted/rejected analytics consent, warm/cold cache, and shared-network cases.

This work does not authorize production stress tests, live card charges, bulk
external email, shipping-label purchases, unrestricted infrastructure spending,
or a replacement of the payment integration. It does not expand into a site
redesign or an architecture rebuild. Findings that need product fixes become
bounded follow-up work; repairs and reruns are necessary before claiming the
affected acceptance criteria pass.

A fast HTTP 200 is not success if stock is oversold, an order is lost, a payment
is duplicated, a cart edit disappears, or the customer remains stuck. Likewise,
10,000 configured VUs, one cached URL, blocked checkout traffic, or a saturated
generator do not establish 10,000-shopper capacity.

## Environment and external-service boundaries

Use an isolated load-testing deployment within staging, with verified staging
Supabase and Redis separation from production and from unrelated shared data.
Use a production build. Record deployment URL/ID, application commit, migration
versions, regions, service tiers, relevant limits, and differences from
production. The documented staging alias is only a discovery lead; verify the
actual Vercel project and backing resources before allowlisting a target.

Keep real application handlers, PostgreSQL reservation/order transactions,
authorization, Redis payment permits, and recovery workers in the bulk exercise.
At server dependency boundaries, substitute only external Square order/pricing/
payment/reconciliation calls, Shippo validation/rates, SMTP delivery, and
external bot attestations where necessary. Suppress optional third-party
analytics egress for bulk traffic; verify consent behavior in bounded browser
checks. Never send the 10,000-user workload to those third parties accidentally.

Use deterministic, stateful test adapters: consistent quote/order amounts,
idempotent payment identities, asynchronous completion events, configurable
delays/declines/timeouts, duplicate/out-of-order events, and a capture ledger.
Feed completion through the application's normal event-processing boundary;
never update orders to paid directly as a shortcut. Keep notification jobs real
while routing delivery to a sink. Implement an adapter contract check against
bounded Sandbox behavior. This proves application behavior with simulated
providers, not Square/Shippo/SMTP capacity or native-wallet compatibility.

Enable adapters and controlled harness admission only on a positively verified
load-test deployment, with server-only configuration, an expiring run credential,
an allowlisted target/resource manifest, and no production credentials. A caller
header alone must never enable a test mode. Reject invalid/expired credentials
and fixture identities outside the active run. Secrets stay in the operator's
secret store and out of browser bundles, logs, reports, and committed fixtures.

Maintain two explicitly labeled admission modes:

1. Controlled capacity mode: authenticated harness access may substitute external
   bot attestations and partition synthetic network identities to avoid every VU
   sharing one IP limit. Preserve CSRF, customer ownership, real limiter code,
   payment protection, and reservation semantics. Never trust a client-supplied
   forwarded IP as a real customer identity. Record all perimeter differences.
2. Real customer mode: bounded browser/manual journeys through the normal
   BotID/WAF/Turnstile/rate-limit path, including shared-NAT cases, without harness
   admission. A blocked automation run is an admission failure to investigate;
   bypassed traffic cannot prove the actual perimeter admits 10,000 customers.

If normal-browser admission cannot be verified, report that coverage as unmet.
Do not disable production protections or advertise full live readiness from a
controlled-capacity result.

## Ordinary-shopping workload

At the target plateau, run 9,980 HTTP shopper sessions and 20 browser shopper
sessions: 10,000 active sessions in total. Browser workers can run separately but
must overlap the plateau and use the same run identity/timing manifest. Start
with fewer browser sessions during smoke tests; never count unstarted browsers.

Proposed session cohorts total 100%:

| Cohort        | Weight | Behavior                                                        |
| ------------- | ------ | --------------------------------------------------------------- |
| Browse/detail | 55%    | Landing, collections, pagination, several product details       |
| Search/filter | 25%    | Search terms, sizes/brands/categories, sorting, product details |
| Cart          | 15%    | Browse, add/change/remove items, validate stock, revisit cart   |
| Checkout      | 5%     | Browse/cart, quote, prepare, permit, pay, poll, receipt         |

These are session cohorts, not weights of individual requests; checkout sessions
also browse and edit carts. Start with 70% guest / 30% account and 80% shipping /
20% pickup for checkout. Split browser probes between consent choices and use
14 mobile-sized / 6 desktop-sized viewports. Viewport emulation is not evidence
of low-end phone CPU/network performance or native mobile wallets.

Use 5-10 minute session targets, 5-15 second browsing pauses, 2-5 second cart
pauses, and 3-8 second checkout form pauses. Give every active shopper separate
cookies, cart/device/idempotency identifiers, and appropriate account or guest
credentials. Allocate a new logical session identity when a session ends; keep
10,000 slots active until the plateau finishes. Include bounded sign-in and
session refresh traffic; do not make every request log in again or send bulk OTP
emails. Seed authenticated sessions before the synchronized rush.

Exercise a varied synthetic catalog, realistic search/filter cardinalities,
popular versus long-tail products, empty results, and different baskets. Treat
warm and cold-cache tests as separate runs; do not randomly bypass all caches or
repeatedly hit only one cached URL. Observe rendered HTML and client navigation
traffic before building scripts so server rendering, Next.js navigation data,
prefetch, assets, and API calls are neither omitted nor double-counted. Browser
probes load real first-party JS/CSS/images, including image optimization paths.

Record actions/session, requests/session, pauses, actual active sessions,
checkout attempts/completions, and offered/completed RPS. Derive throughput from
the calibrated sessions; 10,000 sessions is not an assumption of 10,000 RPS.

## Limited-stock opening rush

Run a separate scenario capped at the same 10,000 active shoppers: 8,000 HTTP
contenders, 1,980 ordinary HTTP shoppers, and 20 browser shoppers. All contenders
arrive at the real contention operation, normally preparation/reservation, over
a measured one-second release window after synchronized setup. Record planned
and actual dispatch times/skew and the number reaching the handler; do not call
it a synchronized 8,000-attempt rush if the generator serializes or drops work.
Provide a separately reported worst-case profile with all 9,980 HTTP shoppers
contending and 20 browser observers.

Use resettable hot products with stock 1, 10, and 100. Run an all-eligible,
all-successful-payment profile first: exactly the starting stock must become
durable successful orders; every other contender gets a clear stock conflict.
Assert inventory never becomes negative and active holds plus committed sold
units never exceed initial stock. A reservation is not yet a completed winner.

Then run separate abandonment/expiry and retry/failure profiles. A released hold
may permit a later winner, but total durable sales cannot exceed initial stock.
Verify duplicate submissions, lost responses, changed carts, and payment-versus-
expiry races without duplicate captures or lost accepted outcomes. Browser
observers verify stock feedback, progress, and the eventual receipt.

Preserve the existing campaign cases from #41: fully free and mixed paid/free
baskets, one giveaway per normalized delivery address across identities, and
pickup's separate eligibility address. Use the actual implemented claim contract
when available; do not invent a new claim API. Missing campaign functionality is
an explicit failed/unmet gate, not a successful simulated claim.

## Execution profiles

| Profile                | Proposed extent                                                                                 | Purpose                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Smoke                  | 1-10 shoppers, 2 minutes                                                                        | Requests, fixtures, adapters, security rejection checks, telemetry, cleanup; intentionally fail one threshold to prove reporting |
| Calibration            | 100-500 shoppers, 5 minutes                                                                     | Establish request mix, RPS, browser overhead, fixture demand, runner sizing                                                      |
| Ramp and peak          | Steps through 100, 500, 1k, 2k, 5k, 10k with 2-minute intermediate holds; 30-minute target hold | Establish achieved 10k capacity and per-operation budgets                                                                        |
| Arrival-rate companion | Same calibrated action mix, fixed offered action arrivals for 10 minutes                        | Prevent slow responses from hiding demand; record required VUs and dropped work                                                  |
| Opening rush           | Synchronized profiles above, followed by 10-minute recovery observation                         | Contention correctness and customer outcomes                                                                                     |
| Bounded stress         | Up to 12k active sessions for at most 5 minutes                                                 | Find the failure knee and protective/recovery behavior                                                                           |
| Soak                   | 10k active sessions for 2 hours                                                                 | Latency drift, connection growth, stale holds, queue growth                                                                      |
| Fault/recovery         | Selected small/medium runs with scoped delays, 429s, timeouts, replay and outages               | Correct pending/failure behavior and backlog drain                                                                               |

The arrival-rate companion schedules calibrated actions/journey starts, not an
invented RPS-to-user conversion. Define its unit, rates, full journey request
distribution, VU allocation, and ceilings in the run manifest before execution.
It is separate evidence from the 10,000-active-session plateau. Keep an explicit
12,000 total-session ceiling across workers; insufficient capacity to sustain
the chosen arrival rate fails that profile rather than silently reducing demand.

Shorter runs can provide useful early findings but do not satisfy the omitted
30-minute peak or 2-hour soak coverage. Stop escalation after a failed lower
stage, fix or identify the cause, and rerun the affected stages.

## Journey and route coverage

| Area         | Current routes or boundaries                                                                                          | Important checks                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Storefront   | `/`, `/store`, `/store/[productId]`                                                                                   | HTML, navigation data, resources, search/filter/pagination, unavailable item     |
| Catalog data | `/api/store/products`, `/api/store/products/[id]`, `/api/store/filters`, `/api/store/taxonomy`, `/api/featured-items` | Relevant traffic observed in real journeys, response/body correctness            |
| Cart         | `/cart`, `/api/cart/validate`                                                                                         | Quantities, stale stock, concurrent edits, login merge, cross-tab behavior       |
| Identity     | `/auth/login`, `/api/auth/login`, `/api/auth/session`, actual refresh flow                                            | Separate identities, expiry/refresh, return path, ownership                      |
| Checkout     | `/checkout`, `/api/checkout/quote`, `/api/checkout/prepare`, `/api/checkout/payment-permit`, `/api/checkout/pay`      | Shipping/pickup, authoritative totals, holds, permits, retries, declines/pending |
| Completion   | `/checkout/processing`, `/api/orders/[orderId]`, `/checkout/success`, `/order-status/[orderId]`                       | Authorized polling, receipt accuracy, cart preservation, eventual outcome        |
| Background   | Square/Shippo event handlers, expiration/recovery work, notification cron                                             | Replay safety, lost browser, stale hold cleanup, event/queue lag                 |
| Health       | `/api/healthz`, `/api/readyz`                                                                                         | Low-rate supporting signals, not substitutes for purchase checks                 |

Browser-only state cases use actual UI actions. HTTP scripts model the server
requests triggered by those actions; the client cart is not assumed to have an
add-to-cart API. Do not load administrator/export/label-purchase routes as if they
were shopper traffic. Test staff access only as bounded operational smoke work.

## Proposed pass/fail budgets

Freeze these in the versioned run manifest before measurement. Calibration may
justify a documented revision before the acceptance run, never retroactively to
turn a failure into a pass. Measure each operation separately and report both
success and expected-conflict latency; fast stock losers cannot hide slow wins.

| Measure                                                          | Proposed gate                                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog API, cart validation, order polling                      | p95 < 1s; p99 < 2s                                                                                                                                                               |
| Quote, prepare, payment permit, payment with simulated providers | p95 < 3s; p99 < 5s, excluding user/wallet interaction time                                                                                                                       |
| Server-rendered page TTFB                                        | p95 < 1.5s; p99 < 3s, reported by cache state                                                                                                                                    |
| Unexpected technical failures/timeouts                           | < 1% per critical operation and per journey, with denominators and counts                                                                                                        |
| Normal-peak checkout completion                                  | >= 99% of eligible seeded checkout attempts reach the expected durable outcome within 30s after payment submission                                                               |
| Browser navigation                                               | Sampled p75 LCP <= 2.5s and CLS <= 0.1, reported by route/viewport with sample counts                                                                                            |
| Browser interactions                                             | No unexpected blocked/blank/stuck critical journey; measure interaction latency/INP where supported, proposed p75 <= 200ms                                                       |
| Business correctness                                             | Zero oversells, duplicate successful captures/orders/claims, lost accepted payments, address-rule violations, or lost unrelated cart edits                                       |
| Generator                                                        | Target active sessions maintained; zero dropped scheduled work and no unexplained interrupted iterations during the measurement window                                           |
| Recovery                                                         | No run-owned hold remains beyond its configured expiry plus two worker intervals; paid/failed outcomes resolve within two recovery-worker intervals after dependency restoration |
| Notification sink                                                | Oldest deliverable job <= 5 minutes at target; backlog returns to its pre-fault baseline within 10 minutes after recovery                                                        |

Report missing browser metrics or insufficient sample sizes as missing evidence,
not zero values or a pass. Browser probes sample UX; their percentiles are not
population-wide field Core Web Vitals. Explicit stock/eligibility conflicts and
deliberate declines are expected only in designated scenarios. Unexpected
403/429 responses, invalid 200 bodies, access failures, and unresolved states
remain failures; never globally whitelist an HTTP status as success.

Use k6 thresholds and a nonzero process exit status as well as request checks.
Combine their result with post-run durable database/adapter-ledger assertions.
Publish one final status that fails if either performance or correctness fails.

## Data, generator, telemetry, and operating controls

Seed only synthetic fixtures tagged in a run-owned manifest. Use unique accounts,
guest emails, carts, addresses, hot SKUs, ordinary inventory, and event/payment
identities. Include address-normalization duplicates and genuine apartment
differences as separate fixtures. Size ordinary stock and fixture pools from the
longest profile's maximum checkout attempts/basket units with headroom; exhaustion
is a harness failure. A stock-1 fixture is reset only between isolated profiles.

Cleanup uses the manifest to remove only run-owned data, after durable assertions
and a scrubbed report. Drain or reconcile outstanding jobs/holds first. Preserve
failed-run evidence; never truncate shared tables, reset a whole remote database,
or delete unrelated objects. Allow reproducible reruns with a new run ID.

Default to open-source k6 on measured, US-based Linux generator capacity, with
browser workers separately sized when necessary. Use the developer machine for
smoke work only until it demonstrates capacity. No Grafana Cloud subscription is
required by the design. Reuse accessible capacity first; if paid capacity is
necessary, present the concrete host/run cost and obtain a resource budget before
provisioning. The user has not specified a spending cap or existing runner host.
Sharding, exact host sizes, and metric storage are builder choices, provided the
global session/arrival limits and unique fixture allocation remain enforced.

Record generator CPU, memory, network, VUs, clock skew, scheduled/completed/dropped
work, and browser resource usage. Calibrate headroom (proposed CPU < 80%, memory
< 85%, no network saturation at target); otherwise split workers and rerun rather
than attribute generator failures to the site. Record geographic distribution;
one US location does not establish nationwide or mobile-network latency.

Correlate k6 with existing application/request IDs and telemetry for Vercel
functions/cache/429s, database CPU/connections/locks/query latency, Redis limits,
webhook/recovery lag, oldest unresolved payment/hold, and notification backlog
age. Use bounded route/scenario/outcome tags; never put order IDs, addresses,
credentials, or access tokens in metric labels. Store a scrubbed run manifest,
machine-readable summaries, invariant counts, selected browser evidence, and a
concise report. Pin tool versions/image digests and record adapter fault/latency
settings. Required telemetry that cannot be obtained is an explicit coverage gap.

Every command validates the target and linked resource identities before writes
or traffic, has explicit load/duration ceilings, and supports an operator stop.
Auto-stop on an invariant violation, cross-environment detection, or sustained
severe failure (proposed > 5% unexpected errors for 60 seconds). Keep fixture and
adapter control APIs inaccessible without the run credential. A normal PR can
run static/small isolated harness validation; full staging runs are explicit
operator actions, not automatic on every push.

## Hands-off setup and operator experience

Deliver an orchestration entry point suitable for the user's Windows development
environment, plus an equivalent runner entry point. A selected test profile must
perform preflight, fixture seeding, session preparation, a smoke gate, coordinated
HTTP/browser execution, durable outcome assertions, report generation, and scoped
cleanup without the user manually executing SQL or creating accounts/products.
Selecting the full acceptance profile runs its required profiles in order and
stops escalation after a failed gate. Expose an explicit stop command and a
repeatable recovery/cleanup command for an interrupted process.

Seeding includes verified synthetic customer accounts through the staging admin
interface, application profiles, guest identities, addresses, ordinary products
and stock, limited-stock products, and any campaign-specific fixture records.
Create authenticated sessions programmatically and preserve real ownership
checks. Do not create one registered account for every guest VU, send thousands
of verification emails, or ask the user to log in as each test shopper. Allocate
enough distinct identities for session rotation during the longest profile.
Store temporary credentials/cookies in ignored, access-restricted local/runner
artifacts; provide only scrubbed identifiers in reports.

Prepare the staging configuration contract, a secret-manager/environment
template, and exact validation messages as implementation deliverables. Reuse
authorized existing secret-manager access when available. Never ask the user to
paste secrets into chat or assume that deploying application code provisions
database/Redis isolation, sets environment variables, or installs runner tools.
Generate scoped run credentials automatically after the staging prerequisites
are verified; do not make the operator manually assemble signed requests.

The user's routine steps should be deployment, initial tool installation, and
starting the selected profile (or asking the agent to start it), then reading
the report. Deployment remains the user's responsibility as requested. The
orchestrator verifies the deployed commit and compatible schema/configuration
before any seeding and fails with a concrete remediation if they do not match.
Do not silently deploy/promote an application or apply unrelated migrations.

Potential one-time user involvement is limited to account authorization or
entering unavailable credentials into the secure configuration system, enabling
isolated staging resources when existing access cannot do it, and accepting a
specific paid-runner or service-tier cost if required. A Chromium-compatible
browser/runtime is required for browser probes; detect an existing supported
runtime or prepare a pinned runner image/bootstrap. Report an unavailable runtime
clearly rather than silently omit browser coverage. Do not promise that local k6
installation alone makes a laptop suitable for the 10,000-session exercise.

Package runner setup, test adapters, notification sinks, browser startup, telemetry
collection, seed/reset, and report aggregation so they require no recurring
dashboard changes. Where privileged external access is unavailable, identify the
exact remaining step and prepare everything else first. Bounded native-wallet
verification may still need the user's compatible device/provider approval;
that manual check is separate from the automated bulk-capacity profiles.

Normal completion runs assertions and captures the report before automatic
cleanup. On failure, retain scrubbed diagnostic evidence and a manifest of
unresolved holds/jobs; reconcile them before deleting their fixtures. A forced
shutdown must remain recoverable through the idempotent cleanup command. The
report distinguishes test failure, harness/setup failure, and incomplete cleanup.

## Readiness dependencies and execution gates

On November 25, #25 (real Postgres races), #26 (cart identity), #33 (receipt cart
consumption), #34 (browser-independent recovery), #29 (operational health), #30
(notification recovery), and campaign issues #37-#39 were still open in GitHub.
Issue state is not proof of current implementation failure or completion.
Inspect acceptance evidence for all dependencies listed in #41 before the final
readiness report. Test preparation, smoke runs, and diagnostic load work can
proceed independently; unresolved requirements prevent a complete acceptance
claim and must be reported individually.

Before the full measured run, record the exact target/deployment/migrations,
production-parity differences, resource budget, generator proof, safe provider
and perimeter mode, fixture/reset validation, thresholds, and available
telemetry. Real Postgres contention and recovery assertions must be executable.
No published result may turn unavailable data, skipped journeys, or simulated
providers into a claim of successful live production purchase capacity.

## Deliverables and what remains to the builder

Deliver a pinned suite in `tests/load/`, workload/threshold configuration,
fixtures and scoped cleanup, the narrow staging-only integration/admission
adapters if needed, browser probes, a runbook, repeatable operator commands, and
machine-readable plus readable results. Keep result files/secrets out of commits;
commit only scrubbed evidence summaries deliberately selected for the report.
The hands-off orchestrator, automated account/session/catalog seeding, secure
configuration template, runtime checks/bootstrap, and interrupted-run cleanup
are required deliverables, not optional operator documentation.

The implementation plan should sequence the smallest safe smoke path first,
then complete shopping/stock correctness, telemetry and generator proof, and
finally increasing-load runs and evidence-linked repairs. It must identify
application code touched by test adapters, add meaningful fail-closed isolation
checks, and preserve normal production behavior. The full 10k exercise must not
be the first time those isolation checks run.

The builder chooses script organization, pinned versions, container/runner
commands, synchronization mechanism, fixture sizing, and existing observability
integration. New paid resources and unresolved target isolation are execution
gates, not reasons to guess credentials or use production. Every report identifies
the tested commit/deployment; subsequent relevant changes require reruns.

## Primary references and local evidence

- [BF-13 readiness scope and dependencies](https://github.com/sneakereco/solesneakers/issues/41)
- [Grafana hybrid HTTP/browser guidance](https://grafana.com/docs/k6/latest/using-k6-browser/recommended-practices/hybrid-approach-to-performance/)
- [Open and closed workload models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/)
- [Thresholds and failing runs](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [Dropped iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/)
- [Load-generator sizing](https://grafana.com/docs/k6/latest/testing-guides/running-large-tests/)
- [Existing checkout evidence and limits](../../operations/checkout-validation.md)
- [Checkout compatibility contracts](../../operations/single-store-checkout-contracts.md)
- Source boundaries: `src/proxy.ts`, `src/app/(store)/store/page.tsx`,
  `src/lib/checkout/checkout-quote-dependencies.ts`,
  `src/lib/checkout/prepare-checkout-dependencies.ts`, and
  `src/lib/checkout/payment-api-dependencies.ts`.
- Operational configuration: `.github/workflows/staging.yml`, `vercel.json`,
  and `mise.toml`.

No load test, environment change, provider purchase, or capacity result is claimed
by this design document.
