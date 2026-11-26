# Specialty giveaway claims

Specialty products use a private claim flow. They have no cart, checkout, payment, shipping, or pickup step. Staff contact successful claimants on Instagram and track arrangements under **Commerce → Specialty Product Claims**.

## Runtime setup and release gates

Apply the five additive migrations in order:

1. `20261125120000_specialty_product_foundation.sql`
2. `20261125121000_specialty_claim_awards.sql`
3. `20261125122000_specialty_claim_admin.sql`
4. `20261125123000_specialty_claim_contention.sql`
5. `20261125124000_specialty_claim_observation.sql`

The seeded `black-friday-2026` campaign begins disabled. Configure these server runtime variables before enabling it:

| Variable                  | Requirement                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `SPECIALTY_CLAIMS_SECRET` | Dedicated random secret, at least 32 characters; stable for the entire campaign.    |
| `SPECIALTY_CAMPAIGN_SLUG` | Select the one campaign served by this deployment; defaults to `black-friday-2026`. |

Use the existing Doppler/GitHub environment and Vercel project configuration. The existing workflows fetch Doppler variables, then deploy the respective Vercel projects using Vercel's production environment. Workflow injection and Vercel runtime configuration are separate checks. Verify presence and the selected campaign without printing secret values. No deployment workflow or branch/tag gate is changed by this feature.

Staging still follows the existing merge-to-main gate; production still follows its existing release-tag gate. Hosted variable presence, hosted BotID/Shippo behavior, and staging burst qualification remain release checks. Keep the real giveaway disabled until those checks and release approval are complete.

Enabling first pins the identity-key fingerprint and normalization version. A different key cannot silently reopen the same campaign. Missing/mismatched identity configuration stops new claims. Credential-only result recovery does not depend on the eligibility signing key.

## Staff operation

Choose **Specialty giveaway** in product creation. Enter title, description, images, quantity, go-live time, and optional plain-text winning instructions. Empty instructions use the approved confirmation explaining that the reseller will contact the winner on Instagram.

Quantity changes are explicit and allowed only before the first successful claim. Metadata saves omit unchanged quantity, use a revision check, and cannot restore consumed stock. After a win, quantity is locked and the prize cannot be deleted or converted into an ordinary product. Existing winning snapshots retain their original product details and instructions.

Open/close claims manually from the claims tab. New, Contacted, and Fulfilled are staff follow-up statuses. Changes record the staff actor/time atomically; they never release eligibility or change stock, orders, taxes, or payments.

## Acceptance, discovery, and recovery

Opening or validating a form creates no reservation. Only a complete, valid submission committed by PostgreSQL wins. HTTP arrival order and click timestamps do not establish priority. Different products use separate stock locks; campaign-wide address and Instagram uniqueness still apply across products.

Instagram normalization includes case, whitespace, Unicode compatibility characters, and a leading `@`. Provider-standardized US address identities normalize equivalent street/unit/ZIP forms while preserving meaningful apartment and number distinctions. Matching either a campaign address or Instagram key prevents another win. This is an address/handle rule; it cannot establish a unique human independently of those identifiers.

The public discovery pool has five-second CDN freshness with no stale extension. It supplies one extra random card on unfiltered Shop All and the first homepage product section. Ordinary ordering, counts, pagination, and filters remain separate. A cached card or product page cannot authorize an award.

The browser stores only product/attempt IDs and a random recovery credential in session storage. Submitted contact data, validation tokens, and full receipts are not stored there. A conditional control in existing footer Customer Resources makes saved attempts accessible after a claimed prize disappears. Blocked browser storage uses memory and asks the winner to keep the confirmation open.

Timeouts, connection failures, and unknown results never become a confirmed loss. Automatic recovery retries the same attempt for up to 30 seconds; Check result again retains the credentials afterward. After a refresh with no committed result, the original details can be re-entered with the same attempt.

A confirmed closed attempt offers **Try claiming again**. That explicit action creates new credentials while the original closed result remains immutable; unresolved attempts and winners cannot use this action. If session storage is readable but writes fail, the current tab retains its credentials in memory and continues to show the storage warning.

Decision metrics distinguish a fresh award from replayed results. They include safe product/campaign IDs, operation, elapsed request/provider/RPC time and allowlisted provider, protection, timeout or contention categories. Repeated receipt checks are replay events and cannot inflate the award count. Contact data, identity keys and credentials are excluded. The extra private recovery RPC adds observation context while preserving the original RPC contract for older application instances.

## Initial protection policy

Fresh validation/submission requires same-origin requests, trusted IP, store access, signed browser context, BotID, and fail-closed Redis quotas. Recovery retains origin/rate protection and needs only the opaque credentials. Private request bodies are capped at 16 KiB. Private responses, including proxy denials, use `private, no-store`.

| Operation | Browser requests/minute | IP requests/minute |
| --------- | ----------------------: | -----------------: |
| Validate  |                      10 |                300 |
| Submit    |                      10 |              2,000 |
| Recover   |                      60 |              5,000 |

These exact POST routes replace the proxy's generic 30/minute write bucket with the dedicated policy. Other CSRF/bot controls remain in place. Public claim actions do not depend on Supabase account refresh. Fresh award and validation handlers enforce store access themselves; concurrent metadata/settings lookups share only pending reads, with no retained result cache.

Busy attempts/prizes return retryable contention promptly. Committed identity caps, exhausted stock after a win, and immutable attempt replays avoid the exclusive award lock. Winning inventory changes retain the full transaction and validation checks. Defensive lock/statement timeouts remain two/five seconds. Throttling and unavailable protection remain retryable.

## Local browser/database prerequisites

Use the repository's installed Node dependencies and Docker Desktop. The local Supabase Postgres fixture source is `supabase_db_solesneakers` on loopback port 64332. Set `SPECIALTY_TEST_DATABASE_URL` privately to a loopback `specialty_test_*` database at that port. The helper creates a schema-only copy, applies missing compatibility/specialty migrations there, and verifies its disposable marker. It does not reset or migrate the shared source database.

The actual-app browser harness requires port 3000 to be free. It starts a Next development app, label-owned PostgREST/Redis containers, and a local provider gateway. Cleanup verifies run ownership, stops only its processes/containers, and removes its private files under ignored `test-results/specialty/.private`.

```powershell
node --test --test-concurrency=1 tests/database/specialty-claims-schema.test.mjs tests/database/specialty-claims-concurrency.test.mjs tests/database/specialty-claims-admin.test.mjs
node --test tests/database/specialty-browser-environment.test.mjs tests/database/specialty-local-redis.test.mjs
node tests/browser/specialty-claims.mjs --mode=mocked --base-url=http://localhost:3000
node tests/browser/specialty-claims.mjs --mode=database --base-url=http://localhost:3000
node tests/browser/specialty-claim-dialog.mjs
```

Mocked mode fabricates the award response and proves UI behavior only. Database mode calls the actual Next claim/admin routes and real PostgREST/PostgreSQL transactions. Its address validation and Auth provider are explicit fixtures; it uses real Redis scripts through a local REST bridge and BotID's supported development HUMAN verdict. These are not hosted provider, CDN, or production bot-capacity evidence.

Browser reports contain structural counts/outcomes only. Do not enable private-form screenshots, traces, or debug request-body logging. Prepared eligibility/credential artifacts must be removed after qualification.

## Qualification status

**Release decision: NO-GO.** Feature implementation and the final review fixes are locally verified, but capacity qualification is incomplete. The protected local Next development path failed the 1,000-submission gate: requests timed out before reaching award SQL. These failures are retained as failures, with inventory/winner reconciliation. Keep the real campaign disabled.

Run the protected path with `--mode=protected` (the default). The separate `--mode=award-rpc` sends 1,000 independent requests to the real private PostgREST award/recovery RPCs using only this run's synthetic credentials. It isolates transaction contention, stock, campaign identity caps and recovery. Its reports explicitly set `siteCapacityPassed: false`; it does not measure the application's origin, browser, bot, Redis or proxy path. No application bypass route or deployed bypass flag is introduced.

Nominal local HTTP actors use distinct synthetic forwarded IPs trusted only by the loopback app. The `shared-ip` scenario separately exercises the original shared IP pressure. All deployed quotas remain unchanged. Latency percentiles include recovery until a terminal result; initial HTTP latency is reported separately. The generator must deliver 1,000 in-flight submissions within one second, with terminal p95 ≤ 3 seconds, p99 ≤ 10 seconds and every attempt resolved within 30 seconds. The overload case separately checks bounded recovery and integrity.

Hosted staging and production provider qualification remains pending. The CLI currently refuses remote targets: this worktree has no selected Doppler project/config or explicitly permitted hosted synthetic campaign/bot-test binding. It must not infer a staging project, seed live prizes, change a deployment's selected campaign, or weaken deployed protection. Runtime variable presence, real Shippo cold validation/provider quotas, hosted BotID/WAF behavior, CDN freshness and hosted 1,000-submission capacity require the normal release path.

### Measured local load

The eight award-engine scenarios below ran against clean source `ef6adc3fa14936b532af8231a78688ed57682c7c`. Each dispatched 1,000 actual concurrent HTTP submissions within 12 ms. Every scenario reconciled correctly with no duplicate identity, negative stock, ordinary prize order, unexpected error or unresolved attempt. **All seven nominal latency gates failed.** The forced-lock overload case passed its separate bounded-recovery/integrity check; it does not pass website capacity.

| Scenario                | Winning responses | Persisted winners | Remaining stock | Terminal p95 / p99 (seconds) |
| ----------------------- | ----------------: | ----------------: | --------------: | ---------------------------: |
| Hot one                 |                 1 |                 1 |               0 |                21.55 / 22.05 |
| Hot many                |                10 |                10 |               0 |                24.15 / 24.55 |
| Multiple products       |               100 |               100 |               0 |                11.25 / 11.41 |
| Duplicate address       |                 1 |                 1 |             999 |                  6.36 / 6.44 |
| Duplicate Instagram     |                 1 |                 1 |             999 |                  7.88 / 8.03 |
| Same attempt replayed   |             1,000 |                 1 |               0 |                  8.16 / 8.27 |
| Lost committed response |                 1 |                 1 |               0 |                12.76 / 12.91 |
| Forced-lock overload    |                 1 |                 1 |               0 |                14.28 / 14.38 |

The latest protected hot-one run on the same source had 1,000 unresolved attempts at 30 seconds, zero winners and stock still one. All nine protected scenarios, including shared-IP pressure, failed qualification. Those outcomes are safe retryable uncertainty, not a claim that the giveaway remains available under that traffic. The standalone local Redis probe accepted 1,000 logical checks without timeout; that probe is not website evidence.

[Sanitized machine-readable reports](evidence/2026-11-25-specialty-load.json) preserve exact source SHAs, initial/terminal latency, dispatch/concurrency, retries, statuses, reconciliation and provider differences. [Implementation decisions and deferred review findings](evidence/2026-11-25-specialty-decisions.md) preserve the native execution record.

### Verification and remaining work

After the four Important review fixes, the full unit suite passed (137 suites, 695 tests), integration passed (3 suites, 21 tests), disposable-database/safety checks passed (35 tests), and load-runner safety/barrier checks passed (8 tests). Actual Next/Chromium checks passed real win/loss, immutable recovery after a lost committed response, campaign-wide identity caps, pause/reopen with a new attempt, audited staff follow-up and ordinary cart exclusion. The separate dialog harness passed keyboard/mobile, uncertain recovery and readable-storage/write-quota failures.

The production webpack build passed with synthetic fixture environment and complete TypeScript/static generation. The default local Turbopack build is blocked by the shared `node_modules` junction outside its filesystem root; it is not reported as passing. Real Auth, Shippo, hosted BotID/WAF, CDN and deployed runtime behavior remain unverified.

Standalone typecheck, changed-file formatting and whitespace checks passed. Whole-repository ESLint completed with zero errors and nine existing warnings; no lint rule was weakened.

Before release, identify a permitted staging project and synthetic campaign, supply its supported bot-test setup through existing secret management, qualify the protected deployment and provider behavior, and meet the latency/resolution gates. Local database correctness does not waive those gates. No merge, push, deployment or real campaign enablement was performed during implementation.
