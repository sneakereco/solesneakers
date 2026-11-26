# Hybrid staging load testing

This suite prepares synthetic customers, sessions and inventory, runs k6 alongside real Chromium shoppers, observes durable outcomes, and attempts scoped cleanup. The target is **10,000 active shoppers: 9,980 HTTP actors plus 20 browsers**, including a synchronized limited-stock opening rush. Configured VUs alone are never capacity evidence.

The implementation was prepared locally on November 25, 2026. No hosted staging, 10k, production or live-payment capacity result is recorded here. This target supersedes the earlier 2,000-shopper exploration in the [#41 readiness program](https://github.com/sneakereco/solesneakers/issues/41). Harness tests do not close #25, #26, #29, #30, #33, #34 or campaign #37–#39.

## Operator commands

Run from the checkout with Node **24.14.1**. Initial dependency setup is `npm ci`. The bootstrap verifies k6 **2.4.0** against the official archive checksum and installs the locked Playwright Chromium runtime when missing. An optional `K6_BINARY` must match the official executable exactly; otherwise the verified executable is cached under `.load-test/tools`. This changes no global installation.

```powershell
npm run load:staging -- --dry-run --profile acceptance
npm run load:staging -- --profile smoke
npm run load:staging -- --profile acceptance
npm run load:staging -- --stop RUN_ID
npm run load:staging -- --recover RUN_ID
npm run load:staging -- --cleanup RUN_ID
```

Dry run has no credential lookup, writes, subprocess load or staging access. Other directly selectable profiles are `calibration`, `peak`, `arrival`, `rush`, `rush-worst`, `claim-rush`, `stress`, `soak` and `faults`. Arrival needs completed successful peak evidence and is coordinated through acceptance. Fault cases are selected by the acceptance matrix; unsupported cases remain unmet.

A selected diagnostic profile performs a functional smoke first; failed functional smoke gates stop escalation. Readiness coverage gaps remain explicit in diagnostic results. Each ordinary run verifies the deployment before seeding and again before traffic, leases customers and disjoint actor slots, performs bounded browser discovery, starts workers behind a common barrier, and gathers telemetry. It then revokes shopper admission, observes recovery, saves durable assertions and a report, and cleans up owned records. It writes the final report again with cleanup status. Read the reported file path, not the k6 console alone.

Exit codes are **0** pass, **1** failed test/invariant, **2** preflight, harness or required-coverage gap, and **3** stopped/incomplete cleanup. Reports preserve underlying failures even when cleanup changes the exit code.

## One-time deployment and authorization

The user deploys the reviewed implementation to a **dedicated staging load deployment**. Its Supabase and Redis must be separate from production and unrelated shared fixtures. Production deployment labels are not an isolation proof; Vercel can report `VERCEL_ENV=production` for a staging project.

The agent prepares and verifies the actual project/resource IDs and production denylist using authorized account access. Do not copy example IDs into a real enrollment. The nonsecret template is `tests/load/config/staging.example.json`; secret names are in `tests/load/config/.env.example`. No manual SQL, customer creation, phase signing or between-profile inventory reset is required.

Set the deployment's `LOAD_TEST_ENABLED=true`, `LOAD_TEST_ALLOWED_PROJECT_ID`, a new private `LOAD_TEST_SIGNING_KEY` of at least 32 characters, `LOAD_TEST_RESOURCE_MANIFEST`, and its canonical SHA-256 in `LOAD_TEST_RESOURCE_MANIFEST_SHA256`. The manifest may use exactly `$VERCEL_URL`, `$VERCEL_GIT_COMMIT_SHA` and `$VERCEL_DEPLOYMENT_ID` in their corresponding identity fields. `SQUARE_ENVIRONMENT` must be `sandbox`, including in simulated mode. Other application secrets remain the normal staging configuration.

The enrollment digest can be generated without printing a key:

```powershell
node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { manifestDigest } from './tests/load/shared/contracts.mjs'; console.log(manifestDigest(JSON.parse(await readFile('.load-test/enrollment.json', 'utf8'))));"
```

Authorize the runner through its environment, or set `LOAD_TEST_DOPPLER_CONFIG` to the explicitly selected staging configuration. The operator reads that configuration in memory; the repository's default Doppler `dev` configuration is not selected automatically. Required runner credentials are:

- `LOAD_TEST_SIGNING_KEY` matching that deployment.
- `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable-key name is also accepted).
- `UPSTASH_REDIS_REST_TOKEN` for the enrolled Redis.

For first enrollment, supply `LOAD_TEST_RESOURCE_MANIFEST` and `LOAD_TEST_BASE_URL` with the **immutable** deployment URL. The runner verifies the production denylist before making a request, learns the deployment ID through signed attestation, checks the commit against the current checkout or `LOAD_TEST_EXPECTED_COMMIT`, and writes ignored `.load-test/staging.json`. `LOAD_TEST_CONFIG` can select an already verified target file. A deployment/commit/resource change requires fresh enrollment; a stale or redirected alias is rejected.

The normal storefront lock, customer authorization, CSRF and shopper rate policies remain active. Open the dedicated staging storefront through its normal configuration before testing. Control requests use the real same-origin CSRF header and are paced below the ordinary 30-write/minute policy. Auth accounts are confirmed through the staging admin API without signup-email/OTP traffic.

If platform access is absent, preparation stops with a coverage/setup report. Initial account authorization or creating isolated resources may need the user; recurring seed/session/fixture work does not. No cloud host or service-tier upgrade is provisioned by these commands.

## Traffic and route coverage

Protocol sessions exercise actual application contracts:

| Journey       | Routes / behavior                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse/search | `/store`, `/store?q=...`, `/store/[productId]`, `/api/store/products`; actual captured safe public Next Flight requests and first-party assets |
| Cart          | `/api/cart/validate`; unavailable items are removed using the real response                                                                    |
| Checkout      | `/api/checkout/quote` → `/api/checkout/prepare` → `/api/checkout/payment-permit` → `/api/checkout/pay`                                         |
| Completion    | Authorized `/api/orders/[orderId]` polling; real signed `/api/webhooks/square`, transactions, reservation and outbox processing                |
| Sessions      | Actual Supabase customer sign-in/refresh and `/api/auth/session`                                                                               |

The workload mix is 55% browsing, 25% searching, 15% cart and 5% checkout; 70/30 guest/customer; 80/20 shipping/pickup. Sessions last 5–10 minutes, with browse pauses 5–15s, cart pauses 2–5s and checkout pauses 3–8s. Browser probes deliberately oversample checkout and difficult UI cases, with 14 mobile and 6 desktop viewports at the target cohort.

Chromium exercises rendered product/cart/checkout/receipt screens, editing during in-flight cart validation, guest-to-customer merge, two-tab visibility, pending payment feedback, and preserving later additions when a receipt consumes the purchased cart. Issued SSR cookie flags are preserved so the real browser auth client can use them. A blocked or stopped browser reduces observed cohort evidence; it is not silently replaced with HTTP actors.

The fixture matrix currently contains 20 ordinary accessories products and one hot product, with one local logo image and a non-sized variant each. It is deliberately synthetic and does **not** establish production catalog/image/size-variant parity. Existing valid shipping defaults are read; a missing accessories default is journaled and created, then removed only if owned. Ordinary stock includes headroom and at least three units per SKU for quantity-edit cases. Each run gets new fixture IDs; unrelated inventory and settings are not reset.

## Profiles and interpretation

Smoke holds 10 shoppers for 2 minutes; calibration uses 500 for 5 minutes. An already-started 5–10 minute session can require a further bounded drain, which is reported separately.

Peak ramps through 100/500/1k/2k/5k with two-minute intermediate holds, includes the final 30-second ramp in its **780-second warmup**, then measures 10k for 30 minutes. Soak measures 10k for two hours. Arrival derives full-session starts from completed peak sessions, includes a ten-minute warmup and ten-minute hold, and reserves headroom within the 12k global ceiling. It does not infer a session rate from action RPS.

The normal rush has 8,000 contenders, 1,980 background HTTP shoppers and 20 browsers; worst rush has 9,980 contenders and 20 browsers. Stock 1, 10 and 100 are separate runs. Every contender must become ready, and observed contention dispatch must fit one second. Configured release timestamps do not prove that dispatch happened on time.

Acceptance lists smoke, calibration, cold/warm peaks, arrival, stock cases/worst rush, specialty baseline/progressive cases, stress, soak, individual fault cases, and bounded perimeter/Sandbox checks. Failed or unmet required lower gates stop escalation, retain the unrun stages as unmet, and still attempt reporting/cleanup. Missing specialty capability is listed at all 1k/2k/5k/8k/9,980 levels; checkout is never substituted for a prize claim.

Cold-cache and complete production-parity evidence require an independently verified cache/resource setup; a new synthetic product URL is not proof that the whole site was cold. Diagnostic profiles can still produce useful timings and bottlenecks with an overall unmet result. Do not relabel missing evidence as pass.

## Gates, telemetry and recovery

Successful operation histograms are merged by sample count with conservative 1ms upper buckets. Fast expected stock conflicts cannot conceal slow winners. Each catalog/cart/status operation needs p95 <1s and p99 <2s; quote/prepare/permit/pay need <3s/<5s; page TTFB needs <1.5s/<3s. Each operation's unexpected technical failure rate must be <1%. At least 99% of eligible ordinary checkouts must reach a durable terminal success within 30 seconds. Failed quotes/preparations remain in that denominator.

Browser LCP p75 ≤2.5s, CLS p75 ≤0.1, and measured interaction INP p75 ≤200ms need real samples. Missing samples are unmet. Full-load profiles require at least 20 navigations per required route/viewport; smoke uses one for diagnostic instrumentation. No screenshots, traces, private router state or credential-bearing URLs are exported.

Inventory conservation, exact all-eligible stock winners, order/line totals and snapshots, one capture per order, and accepted durable outcomes are separate checks. The adapters retain state, idempotency and asynchronous events; they do not mark an order paid directly. Events are delivered through the actual signed webhook boundary, including during drain. SMTP delivery is sunk while outbox/retry code stays real.

The operator samples actual generator CPU/memory/event-loop/network evidence, native request/error/status/cache counters, Postgres connections/locks/probe latency, Supabase's minute-resolution metrics endpoint, Redis availability and owned queues. A probe's elapsed time is labeled probe latency, not database query p95. Missing database CPU, query statistics, Redis limit/ledger overhead, application-platform metrics, tier parity or cost evidence remains an explicit gap. Some platform evidence currently needs additional authorized provider integration; complete acceptance is not represented as available solely by installing k6.

The current source workers expire at most 50 holds/run and send three notification jobs/run, every five minutes. The harness does not increase that cadence or silently reconcile payments itself. Its payment simulator continues incoming provider event delivery; real app workers own reservation/notification progress. At the proposed checkout rate, queue capacity is a material concern to measure, not an already demonstrated production failure.

Unexpected errors above 5% for 60 seconds, control/identity/lease loss, or the configured request/duration stop reserve trigger a stop. All actors share server-minted disjoint ranges; the root credential cannot bypass partitions once leases exist. Heartbeats expire after 45 seconds if the operator disappears. Private child configs contain customer/phase credentials, never admin/root secrets. Public image/static requests omit shopper credentials.

After actors stop, recovery observes the actual worker interval for up to ten minutes and retains unresolved holds, accepted payments and notification jobs. Do not delete a dirty run manually. Cleanup deletes only verified owned dependencies in FK order, then catalog, confirmed customer accounts, owned shipping defaults and bounded adapter batches. It preserves the dirty deployment lock until cleanup finishes. Revoked/expired shopper admission does not prevent owned background work or operator recovery. Run `--recover RUN_ID`, then `--cleanup RUN_ID` with the same target and private journal after resolving a reported dependency/access problem.

`.load-test/runs/RUN_ID/` holds a current-user-only journal, private worker configs/raw gzip metrics, durable assertions, and `report.json` / `report.md`. Keep this folder until cleanup is confirmed. Reports and journals must not be committed wholesale; selected scrubbed summaries can go under `docs/operations/load-testing-evidence/` after review.

## Existing capacity and an optional paid runner

Local rehearsal verified the locked tools and two real k6 processes sharing eight observed HTTP slots against a fixture server. Real isolated GoTrue creation/refresh and Postgres stock 1/10/100/payment/expiry races also run locally. These are harness/database checks, not hosted application capacity evidence.

One local tooling sample observed CPU 65.99%, host memory 87.38%, and incomplete NIC-headroom proof. Memory exceeded the 85% generator gate. Freeing local resources or using an existing dedicated US Linux host is the first option. Rerun calibration; no 10k runner capacity is assumed.

If existing capacity cannot qualify, a concrete **candidate**, not provisioned or approved, is one Linux `c7i.8xlarge` in `us-east-1` (32 vCPU, 64 GiB), initially four hours. AWS's [primary US East Linux price map](<https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/US%20East%20(N.%20Virginia)/Linux/index.json>) returned $1.428/hour on November 25, 2026: **$5.712 compute for four hours**. EBS, public IPv4, transfer, tax and staging-service usage are extra; obtain a total budget before creating anything. A four-hour pilot does not cover the entire acceptance matrix with drains. Recheck the price and measure real CPU <80%, memory <85% and unsaturated network before accepting full-load evidence. One US region does not prove nationwide/mobile-network performance.

The optional `tests/load/runner/compose.yml` runs the same entry point on an existing host. It uses a pinned Playwright image, the exact Node version, runtime-only environment credentials and an ignored artifact mount. It does not create a remote host or copy secrets into image layers. It coordinates multiple local generator processes on that host; cross-host enrollment is not implemented.

## Remaining acceptance coverage

User deployment, actual target/resource access and measured runner capacity are still pending. Complete acceptance also requires the actual specialty feature/contract, platform telemetry/parity/cost evidence, verified cold/warm cache setup, bounded real provider payment/webhook and browser SDK coverage, normal perimeter/consent evidence, and an exclusive mechanism for database/Redis outage profiles. Existing deterministic provider faults and independent DB race tests do not prove unavailable hosted failure modes. Native-wallet checks may require a compatible user device and provider approval.

The bounded provider helper verifies normal navigation without synthetic admission. With authorized Sandbox credentials it can calculate/create one USD 1 Sandbox order, capture using the official test token, replay the same idempotency key, verify an authoritative read, and refund. It journals keys before requests, uses at most 12 SDK requests per attempt, and resumes through --recover RUN_ID if a response is lost or a refund is pending. Only test money is involved; no production provider endpoint is selected. Actual application webhook/real browser SDK/native-wallet coverage remains unmet. See the [Square Sandbox test-token contract](https://developer.squareup.com/docs/devtools/sandbox/payments). No real Sandbox call was made during local preparation.

Run local checks with `npm run test:load`, `npm run test:load:database` on the disposable local baseline, the existing Jest/integration/browser suites, typecheck/lint, and production builds with load mode disabled and positively isolated. PR CI runs bounded local harness checks and dry run with dummy credentials; it has no full staging/stress step. Keep existing staging PR and production release-tag gates.

The dirty-run lock covers the enrolled Supabase/Redis resource pair across deployment IDs. Root control signatures include the immutable origin. Recover through the original deployment with the matching runner protocol; a sibling deployment cannot take ownership of retained fixtures.

The operator prints its run ID before preparation; `--stop` is checked between account, catalog, registry and session operations as well as during traffic. Inventory conservation is sampled every 30 seconds during traffic; missing inventory or a violation stops generators and retains evidence. Cleanup also waits for queued simulated provider events, even when SQL orders look settled.

The bounded Sandbox SDK check first verifies all enabled Square webhook subscriptions point to the enrolled staging webhook URL (or none exist). Unreadable or paginated subscriptions prevent provider writes. It journals keys before its one USD 1 test capture, reuses them on recovery and refunds that capture; a pending refund retains incomplete cleanup. This check does not establish application webhook, real browser SDK or native wallet compatibility.

Functional stage advancement is distinct from the final readiness result. Outstanding provider/perimeter, cost, tier and Redis limit-coverage gaps retain an overall unmet result while allowing diagnostic progression. Smoke can advance to calibration with instrumentation gaps; calibration must have generator evidence and nonzero browser vital samples (its short cohort can be below the final 20-sample requirement). Missing metrics at full load, functional failures or incomplete cleanup stop escalation.

Recovery saves drain and durable payment/inventory evidence before deleting owned records. Cleanup locks candidate orders and requires both exclusively owned fixture lines and a verified synthetic purchaser; an ordinary staging shopper using a public fixture SKU blocks cleanup and preserves both orders and audit history. Customer cookies retain server rotation across k6 generations; non-authentication cookies and logical cart/device state reset between sessions.

Sandbox --stop only writes the stop marker; active probes check it before every further SDK call. Explicit --recover resumes the same idempotency keys. Sandbox --cleanup can refund a known owned capture but never initiates an order or capture; an uncertain request without a confirmed payment ID stays incomplete for explicit recovery.
