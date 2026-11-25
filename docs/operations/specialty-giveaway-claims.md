# Specialty giveaway claims

Specialty products use a private claim flow. They have no cart, checkout, payment, shipping, or pickup step. Staff contact successful claimants on Instagram and track arrangements under **Commerce → Specialty Product Claims**.

## Runtime setup and release gates

Apply the three additive migrations in order:

1. `20261125120000_specialty_product_foundation.sql`
2. `20261125121000_specialty_claim_awards.sql`
3. `20261125122000_specialty_claim_admin.sql`

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

## Initial protection policy

Fresh validation/submission requires same-origin requests, trusted IP, store access, signed browser context, BotID, and fail-closed Redis quotas. Recovery retains origin/rate protection and needs only the opaque credentials. Private request bodies are capped at 16 KiB. Private responses, including proxy denials, use `private, no-store`.

| Operation | Browser requests/minute | IP requests/minute |
| --------- | ----------------------: | -----------------: |
| Validate  |                      10 |                300 |
| Submit    |                      10 |              2,000 |
| Recover   |                      60 |              5,000 |

These exact POST routes replace the proxy's generic 30/minute write bucket with the dedicated policy. Other CSRF/bot controls remain in place. Initial award lock/statement timeouts are two/five seconds. Throttling and unavailable protection return retryable outcomes.

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

Implementation qualification is in progress. The final evidence section will record exact source SHA, commands, 1,000-submission results, latency/concurrency measurements, reconciliation, and any hosted/provider checks still pending.
