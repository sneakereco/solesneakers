# Specialty Giveaway Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let shoppers discover and directly claim free specialty products with an Instagram handle and eligibility address, with correct inventory and campaign limits under 1,000 simultaneous submissions.

**Architecture:** A separate claim feature uses a short Supabase/Postgres award transaction; no claim enters checkout, orders, or payment processing. Server validation produces canonical identity keys, while database uniqueness, idempotent attempts, and private result recovery enforce stock and eligibility. Existing storefront and inventory surfaces receive small adapters; the architecture restructuring stays paused.

**Tech Stack:** Existing Next.js 16.3.3 / React 19 / TypeScript, Supabase/Postgres, Zod, Node crypto/jose, Shippo address validation, Upstash request limiting, BotID, Jest, existing Playwright browser harness style, and the installed pg package. Add no runtime service or queue dependency.

**Spec:** [Approved specialty giveaway design](../specs/2026-11-25-specialty-giveaway-claims-design.md), approved 2026-11-25.

## Global Constraints

- "This is a standalone claim feature. It does not create a cart line, checkout, payment, ordinary order, shipping label, or pickup task."
- "Opening or completing the form reserves nothing. The first complete, valid submission accepted by the server wins available stock." Acceptance is the database's committed decision, not HTTP arrival order.
- "One successful claim per campaign across all specialty products is allowed for either a normalized address or a normalized Instagram handle. Matching either blocks another win."
- "US addresses only for this launch"; no email, phone, legal name, card, or shipping/pickup selection is required.
- "Keep new business logic together in feature folders and keep framework routes thin; do not move unrelated existing code."
- "Add additive schema changes, not a destructive reset." Preserve the single-store compatibility baseline and existing legacy columns.
- "Raw addresses, Instagram handles, signed validation tokens, recovery credentials, and request bodies must not enter logs, analytics, URLs, or error reports."
- "After the first win, quantities cannot be edited or restocked in this version." Metadata edits cannot overwrite consumed stock.
- "Do not cache private claim results." Discovery freshness is at most five seconds; authoritative checks always run in Postgres.
- Stress-test "1,000 simultaneous submissions"; "all 1,000 reach a truthful terminal result or recover to it within 30 seconds, p95 claim response at most 3 seconds, p99 at most 10 seconds, zero oversells/duplicate wins/lost committed wins, and no unhandled server errors."
- "Preserve PR-based staging and production tag gates." Writing/executing this plan does not authorize merge, release, production migrations, or a production load test.

## Review Focus

These five user-impacting conditions need explicit tests in the owning tasks, even when the happy path works:

1. Unit information moves between street line 1 and line 2: equivalent Apt 4 / #4 identities match; unit 5 remains distinct (Task 2).
2. An admin's edit form is older than an accepted claim: saving its metadata never restores stock; attempted quantity changes fail truthfully (Tasks 3, 6).
3. A committed winner reopens after the campaign closes or the validation token expires: authorized recovery returns the original instructions without revalidating the address (Tasks 4, 5, 8).
4. Two simultaneous attempts target different prizes with one shared address or handle: at most one wins and the other prize retains its stock (Tasks 4, 10).
5. Two homepage product sections or a later rerender try to inject a giveaway: one stable placement appears, no private inventory/cost fields cross a new client boundary, and ordinary order/counts remain unchanged (Task 7).

## Scope, working baseline, and execution setup

This is one dependent feature plan, not separate independent projects. It builds in this order: contracts → validation → protected product storage → award transaction → HTTP → admin product creation → discovery → claim dialog → staff claims → stress/evidence.

Planning baseline: commit `63d715e6` on `codex/customer-admin-ux-audit`. Other assessment files and `scripts/audits/` were already untracked; do not stage or change them. Recheck HEAD/status before execution; another chat may advance the checkout. At execution time use the worktree skill to create an isolated `codex/specialty-giveaway-claims` branch containing the approved spec and this plan. Do not switch or reset another task's shared checkout.

The broader [Black Friday hybrid load design](../specs/2026-11-25-black-friday-hybrid-load-design.md) is a separate 10,000-shopper program. This feature's 1,000-claim test must be callable by that work later; do not replace its shopping workload or claim it has run.

Read AGENTS.md and reach for CodeGraph before code exploration/edits. Relevant installed Next guides already checked while planning, and must be rechecked at execution if the installed version changes:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (dynamic params are promises)
- `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`
- `node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md` (Next cache invalidation does not purge an independent CDN copy)

Use existing Node entry points if npm is absent from PATH. All command paths below are repository-relative and run from the execution worktree. Example focused test:

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/Claim/normalization.test.ts
```

New module test files already match `jest.config.ts`'s `**/src/**/*.test.ts(x)` pattern. Database tests use Node's test runner and real independent pg connections, not Jest schema-text assertions.

## File structure and responsibility map

New feature code lives under `src/Modules/SpecialtyProducts/Source/Features/`; corresponding unit tests live under `src/Modules/SpecialtyProducts/Tests/Features/` with the same feature names.

| Feature             | Files and responsibility                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim               | `claim-contract.ts` (public/internal types); `normalize-identity.ts` (canonicalization/keys); `validation-token.ts` (signed eligibility); `claim-repository.ts` (RPC adapter); `claim-handler.ts` (submit/recovery orchestration); `claim-dependencies.ts` (server wiring); `claim-client.ts` (typed browser API); `attempt-storage.ts` (opaque credential persistence); `ClaimButton.tsx` and `ClaimDialog.tsx` (shared customer flow). |
| ValidateEligibility | `address-provider.ts` (canonical Shippo adapter); `validate-eligibility-handler.ts` (validation/correction HTTP logic).                                                                                                                                                                                                                                                                                                                  |
| ManageProducts      | `specialty-product-contract.ts`, `specialty-product-repository.ts`, `specialty-product-handler.ts`, `SpecialtyProductForm.tsx` (atomic admin prize management).                                                                                                                                                                                                                                                                          |
| Discovery           | `discovery.ts` (eligible pool/filter predicate); `DiscoveryInsertion.tsx` (stable insertion of one extra card); `SpecialtyProductCard.tsx` (safe public projection).                                                                                                                                                                                                                                                                     |
| ManageClaims        | `admin-claims.ts` (listing/status/campaign operations), `SpecialtyClaimsClient.tsx` (staff screen).                                                                                                                                                                                                                                                                                                                                      |
| RequestProtection   | `claim-protection.ts` (guest context, claim-specific quotas and existing bot verification), `claim-telemetry.ts` (allowlisted metrics).                                                                                                                                                                                                                                                                                                  |

Database changes: `supabase/migrations/20261125120000_specialty_product_foundation.sql`, `20261125121000_specialty_claim_awards.sql`, and `20261125122000_specialty_claim_admin.sql`. Each task adds a new migration rather than rewriting one already applied by an earlier task. Runtime database types remain `src/types/db/database.types.ts`.

Thin route adapters: `src/app/api/specialty/{eligibility,claims,claims/result,discovery}/route.ts` and `src/app/api/admin/specialty/{products,products/[productId],claims,claims/[claimId],campaign}/route.ts`. Admin page: `src/app/admin/specialty-claims/page.tsx`.

Database fixtures/tests: `tests/database/fixtures/specialty-claims.mjs`; `tests/database/specialty-claims-{schema,concurrency}.test.mjs`. Browser checks: `tests/browser/specialty-claims.mjs`. Load tooling: `scripts/load/{specialty-fixtures,specialty-claims}.mjs`; `tests/load/specialty-claims-runner.test.mjs`. Operator/evidence guide: `docs/operations/specialty-giveaway-claims.md`.

Existing integration points are listed explicitly per task below; do not replace existing checkout helpers or the homepage carousel with a new general framework.

## Shared interfaces

Assertion examples below are test contracts, using fixtures/spies defined locally in their owning test files; they are not additional runtime API exports. `expiresAt` is epoch milliseconds and receipt `acceptedAt` is an ISO UTC timestamp.

Define these in Task 1, export them from `Claim/claim-contract.ts`, and import rather than redefine them:

```ts
type EligibilityAddress = {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};
type AttemptCredentials = { attemptId: string; recoverySecret: string };
type SpecialtyPublicProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  claimable: boolean;
};
type ClaimSubmission = AttemptCredentials & {
  productId: string;
  instagramHandle: string;
  address: EligibilityAddress;
  validationToken?: string;
};
type ClaimReceipt = {
  claimId: string;
  productId: string;
  productName: string;
  instagramHandle: string;
  instructions: string;
  acceptedAt: string;
  decisionOrdinal: number;
};
type ClaimDecision =
  | { status: "won"; receipt: ClaimReceipt }
  | { status: "sold_out" | "already_claimed" | "closed" };
type ClaimReply = { result: ClaimDecision; replayed: boolean };
type ValidatedEligibility = {
  campaignId: string;
  productId: string;
  browserId: string;
  instagramHandle: string;
  address: EligibilityAddress;
  addressKey: string;
  instagramKey: string;
  normalizationVersion: 1;
  identityKeyFingerprint: string;
  expiresAt: number;
};
type AwardCommand = {
  attemptId: string;
  recoveryHash: string;
  inputHash: string;
  payloadHash: string;
  eligibility: ValidatedEligibility;
};
type StoredAttempt = {
  inputHash: string;
  payloadHash: string;
  result: ClaimDecision;
};
type ValidationReply =
  | {
      status: "valid";
      address: EligibilityAddress;
      validationToken: string;
      expiresAt: number;
    }
  | {
      status: "correction_required";
      address: EligibilityAddress;
      correctionToken: string;
    }
  | { status: "invalid"; fields: Record<string, string> }
  | { status: "unavailable"; retryAfterSeconds: number };
```

Server resolves the configured campaign from the product and `SPECIALTY_CAMPAIGN_SLUG` (default `black-friday-2026`); clients cannot choose arbitrary campaigns or send authoritative keys. `SPECIALTY_CLAIMS_SECRET` is optional in global environment parsing (minimum 32 characters when present), but fresh claims require it. Do not import server secrets into a client component.

Browser HTTP contracts:

| Endpoint                            | Request                                                   | Response                                                                                                      |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST `/api/specialty/eligibility`   | `{productId, instagramHandle, address, correctionToken?}` | `ValidationReply`, private/no-store; token lifetime 600,000 ms.                                               |
| POST `/api/specialty/claims`        | `ClaimSubmission`                                         | `ClaimReply`; 201 for a new win, 200 for terminal denials or authorized replay.                               |
| POST `/api/specialty/claims/result` | `AttemptCredentials`                                      | 200 `ClaimReply` for a recorded result; 202 `{status:"unknown", retryAfterSeconds:1}` if uncommitted/unknown. |
| GET `/api/specialty/discovery`      | No contact/identity query parameters                      | `{products: SpecialtyPublicProduct[]}`; public TTL five seconds, no stale-while-revalidate extension.         |

Use 422 for malformed/invalid information or a fresh token required, 409 for changed-payload idempotency conflict, 403 for unauthorized result credentials, 429 with Retry-After for throttling, and 503 for temporary protection/provider/database failure. Return typed, generic errors without input bodies or underlying provider messages. A 202/429/503 is never Sold out.

### Task 1: Establish identity, token, and payload contracts

Also produce `getIdentityKeyFingerprint(secret:string):string`, a purpose-separated non-secret key identifier used to pin the campaign's identity HMAC key. Include it in signed eligibility and award validation.

**Files:** Create `Claim/{claim-contract,normalize-identity,validation-token}.ts` and tests `Claim/{normalization,validation-token}.test.ts` beneath the module roots above. Modify `src/config/env.ts`.

**Interfaces:** Produce `normalizeInstagramHandle(value: string): string`; `canonicalAddressIdentity(address: EligibilityAddress): string`; `deriveEligibilityKeys(campaignId: string, handle: string, address: EligibilityAddress, secret: string): {addressKey: string; instagramKey: string}`; `fingerprintSubmission(productId: string, identity: ValidatedEligibility): string`; `fingerprintInput(input: Pick<ClaimSubmission,"productId"|"instagramHandle"|"address">, secret:string): string`; `hashRecoverySecret(secret: string): string`; `issueEligibilityToken(value: ValidatedEligibility, secret: string): string`; `verifyEligibilityToken(token: string, binding: {campaignId:string;productId:string;browserId:string}, secret:string, nowMs:number): ValidatedEligibility | null`. Correction tokens use separate `issueCorrectionToken` / `verifyCorrectionToken` exports with the same binding/signature shape and an explicit correction purpose; they cannot be submitted as eligibility tokens.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/Claim/normalization.test.ts src/Modules/SpecialtyProducts/Tests/Features/Claim/validation-token.test.ts
```

- [ ] **Step 1: Write failing normalization/token tests.** Assert `normalizeInstagramHandle("  @SoLe.Example_1 ") === "sole.example_1"`; periods/underscores remain significant; internal spaces, multiple @ prefixes, URLs, and unsupported username characters are rejected. Pin NFKC normalization and ASCII username length 1–30. Assert campaign/purpose-separated HMAC keys, ZIP/ZIP+4 equivalence, distinct units, constant-time signature/credential comparisons, and rejection of edited/expired/wrong-browser/wrong-product/wrong-purpose tokens.

```ts
expect(normalizeInstagramHandle("  @SoLe.Example_1 ")).toBe("sole.example_1");
expect(normalizeInstagramHandle("sole.name")).not.toBe(
  normalizeInstagramHandle("sole_name"),
);
expect(verifyEligibilityToken(token, binding, secret, issuedAt + 600_001)).toBeNull();
```

- [ ] **Step 2: Run the focused Jest files.** Expect missing exports/modules or specific failed assertions, not an unrelated environment failure.
- [ ] **Step 3: Implement the pure contracts and cryptography.** Use Node crypto or installed jose; version identities as 1; sign ten-minute eligibility tokens; generate recovery secrets from 32 random bytes. Canonical fingerprints exclude expiring validation tokens and include campaign/product/address/handle identity. Also store a purpose-separated server HMAC inputHash over the normalized submitted fields, excluding tokens/credentials; it permits matching an exact retry before any provider call. Normalize handle case/@ and address case/whitespace for that binding. A changed inputHash returns 409 and directs authorized clients to credential-only recovery; it never awards another unit. Add the two server env names above without making the whole storefront fail when claims are disabled.
- [ ] **Step 4: Run focused tests and `node node_modules/typescript/bin/tsc --noEmit`.** Expect PASS for identity/token tests and no new type errors.
- [ ] **Step 5: Commit the explicitly named files.** Suggested message: `feat: define specialty claim identity and token contracts`.

### Task 2: Validate canonical eligibility without holding inventory

**Files:** Create `ValidateEligibility/{address-provider,validate-eligibility-handler}.ts` and `ValidateEligibility/{address-provider,validate-eligibility-handler}.test.ts`. If transport reuse needs a shared export, modify only `src/lib/shipping/validate-shipping-address.ts` and retain its existing public behavior; test `tests/unit/shipping-address-validation.test.ts`.

**Interfaces:** Consume Task 1. Produce `validateEligibilityAddress(address: EligibilityAddress, deps: {token:string;fetcher:typeof fetch}): Promise<{status:"valid";address:EligibilityAddress}|{status:"correction_required";address:EligibilityAddress}|{status:"invalid"|"unavailable"}>`. Export `validateEligibilityHandler(request: Request, deps: EligibilityDependencies): Promise<Response>`. Define `EligibilityDependencies` here with `getContext(request:Request,productId:string):Promise<SpecialtyContext|null>`, `protect(request:Request,operation:"validate"|"submit"|"recover",browserId:string):Promise<ProtectionDecision>`, `validateAddress(address:EligibilityAddress):ReturnType<typeof validateEligibilityAddress>`, `secret():string|null`, and `nowMs():number`. Define `SpecialtyContext = {campaignId:string;productId:string;browserId:string;normalizationVersion:1;identityKeyFingerprint:string|null}` and `ProtectionDecision = {allowed:true}|{allowed:false;status:403|429|503;retryAfterSeconds?:number}` in claim-contract.ts. This interface has no inventory reservation/award dependency.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/ValidateEligibility/address-provider.test.ts src/Modules/SpecialtyProducts/Tests/Features/ValidateEligibility/validate-eligibility-handler.test.ts tests/unit/shipping-address-validation.test.ts
```

- [ ] **Step 1: Write failing provider/handler tests.** Verify provider-standardized street/state/unit output is used; Apt 4 at the end of line 1 and #4 in line 2 produce the same identity; unit 5 remains different. Verify dropped units, ambiguous/partially valid results without a usable canonical address, provider timeout, and malformed provider JSON never issue eligible tokens. Confirm corrected addresses require a purpose-bound correction token and explicit confirmation.

```ts
expect(canonicalAddressIdentity(validatedApt4)).toBe(
  canonicalAddressIdentity(validatedHash4),
);
expect(canonicalAddressIdentity(validatedApt4)).not.toBe(
  canonicalAddressIdentity(validatedApt5),
);
expect(unavailableProviderResult.status).toBe("unavailable");
expect(reservationSpy).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the new tests plus `tests/unit/shipping-address-validation.test.ts`.** Expect focused failures for the missing claim adapter.
- [ ] **Step 3: Implement the adapter and validation handler.** Use the existing Shippo validation endpoint/credentials and response schema, with an eight-second request deadline and no address logging. Canonicalize a validated provider projection, not unverified raw input; extract/preserve secondary unit identity consistently, normalize known equivalent unit designators, and use ZIP5 in the identity. Return Unavailable when required standardization cannot be obtained; do not offer an unchecked-address override. Keep canonical submitted address details for the eventual restricted winner record. Handle confirmation in the same endpoint; return a valid signed token after confirmation, without an award, stock change, order, or attempt record.
- [ ] **Step 4: Run the focused Jest files and checkout address regression.** Expect PASS, including assertions that provider/claim validation never calls any stock mutation.
- [ ] **Step 5: Commit.** Suggested message: `feat: validate specialty claim eligibility addresses`.

### Task 3: Add protected prize storage and atomic admin inventory operations

Campaign storage also contains `identity_key_fingerprint`, pinned by the first enable operation and immutable afterward. The campaign-enable RPC below additionally accepts `p_identity_key_fingerprint text`; enabling requires a match (or sets it only on first enable), while disabling remains possible without a signing secret. New award commands with another key identity fail unavailable. Add the real-database test that changing the secret while keeping normalizationVersion 1 cannot grant a previous winner another prize; credential-only recovery still works.

**Files:** Create `supabase/migrations/20261125120000_specialty_product_foundation.sql`; `ManageProducts/{specialty-product-contract,specialty-product-repository}.ts`; `tests/database/fixtures/specialty-claims.mjs`; `tests/database/specialty-claims-schema.test.mjs`. Update `src/types/db/database.types.ts` from the migrated disposable database.

**Interfaces:** Produce the four tables named in the spec with unique constraints on campaign/address key, campaign/Instagram key, and attempt ID. Produce `save_specialty_product(p_product_id uuid, p_input jsonb, p_actor_id uuid, p_compatibility_tenant_id uuid) returns jsonb` for create/update, and `set_specialty_campaign_enabled(p_campaign_id uuid,p_enabled boolean,p_expected_revision bigint,p_actor_id uuid,p_identity_key_fingerprint text) returns jsonb`. New feature tables have no tenant concept; the compatibility argument is only for existing product/taxonomy columns and comes from trusted existing admin context. Produce `SpecialtyProductRepository.save(input: SpecialtyProductWrite, actor: {userId:string;tenantId:string}): Promise<{productId:string;revision:number}>`.

Define `SpecialtyProductMetadata = {name:string;description:string|null;images:Array<{url:string;sortOrder:number;isPrimary:boolean}>;goLiveAt:string;instructions:string|null}` and `SpecialtyProductWrite = SpecialtyProductMetadata & ({mode:"create";quantity:number}|{mode:"update";productId:string;expectedRevision:number;quantity?:number})`. Resolve/reuse neutral Other brand and a none-type One Size tag for compatibility. No model, zero sale/shipping prices, one designated variant. Keep existing owner defaults/nullability intact; do not perform physical tenant contraction. The test fixture exports `connectTestDatabase()`, `applySpecialtyMigrations(client)`, `seedPrize(client,{quantity,campaignSlug?})`, and `readRunState(client,runId)`; it applies only the additive specialty migrations after a disposable full pre-specialty baseline has been prepared. Local Supabase is configured for Postgres 17 on port 64332; never reset the existing shared developer database to prepare this fixture.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node --test tests/database/specialty-claims-schema.test.mjs
```

- [ ] **Step 1: Write failing real-database schema/lifecycle tests.** Assert an initially disabled `black-friday-2026` campaign and pinned key identity on first enable, atomic product/config/variant/image creation, no partial publication after failure, one designated variant, zero-price enforcement, and no ordinary↔specialty conversion. Assert anon/customer roles cannot read claim contacts, mutate specialty stock, or execute privileged functions.

```js
assert.equal(campaign.enabled, false);
assert.equal(prize.variants.length, 1);
assert.equal(prize.variants[0].sale_price_cents, 0);
await assert.rejects(anonymousReadClaims(), /permission denied/);
```

- [ ] **Step 2: Add the disposable fixture with the tests.** Require `SPECIALTY_TEST_DATABASE_URL` pointing to localhost/loopback port 64332 and a `specialty_test_[a-z0-9_]+` database; verify current_database and a test-owned marker before applying migrations or cleanup. Fail if absent/mismatched; do not silently skip. Use the existing single-store fixture as a safety-pattern reference, with separate connections for concurrent tests. Run `node --test tests/database/specialty-claims-schema.test.mjs` and confirm the intended missing schema/RPC failures.
- [ ] **Step 3: Implement the additive schema and admin RPCs.** Use restrictive winner references, immutable acceptance/contact snapshots, attempt recovery hashes/payload fingerprints without losing applicants' raw contact data, config revision/decision ordinal, and follow-up status/audit fields. Grant server-role execution only; use fixed search_path and RLS. Guard specialty stock/variant/category writes so ordinary product APIs cannot overwrite them. Permit narrowly scoped transaction-local writes only inside privileged prize/claim functions; do not grant callers a generic bypass. Add a reservation guard that rejects specialty variants inserted into `inventory_reservations`, so legacy checkout RPCs cannot reserve them. All stock-affecting functions use a documented common lock order. Metadata-only saves never write quantity; explicit quantity changes after a win fail with a typed conflict.
- [ ] **Step 4: Apply and replay against fresh and populated disposable databases; regenerate types and run schema tests.** Use the installed Supabase CLI's local gen-types command, preserving repository formatting/aliases. Assert ordinary catalog/reservation data survives, archive preserves history, a claimed product/variant cannot be deleted, and unauthorized stock writes fail. Expect PASS; static SQL assertions alone are insufficient.
- [ ] **Step 5: Commit.** Suggested message: `feat: add protected specialty prize storage`.

### Task 4: Implement atomic awards and authorized replay

**Files:** Create `supabase/migrations/20261125121000_specialty_claim_awards.sql`; `Claim/claim-repository.ts`; `Claim/claim-repository.test.ts`; `tests/database/specialty-claims-concurrency.test.mjs`. Extend the database fixture and regenerate database types.

**Interfaces:** Consume `AwardCommand` and `StoredAttempt`. Produce `accept_specialty_claim(p_command jsonb) returns jsonb`, validating the server-supplied command and returning `ClaimReply`; `read_specialty_claim_result(p_attempt_id uuid,p_recovery_hash text) returns jsonb` returns the bound `StoredAttempt` or null, rejecting a wrong credential. Export class `SpecialtyClaimRepository` with `findAttempt(credentials: AttemptCredentials): Promise<StoredAttempt|null>` and `accept(command: AwardCommand): Promise<ClaimReply>`. Map RPC errors to typed `ClaimRepositoryError` codes `unauthorized | payload_conflict | temporary_unavailable`; never expose SQL/provider text.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node --test tests/database/specialty-claims-concurrency.test.mjs
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/Claim/claim-repository.test.ts
```

- [ ] **Step 1: Write failing real-transaction races and adapter tests.** With separate connections released behind one barrier, assert the following, and repeat with quantity 10 and shared identities across different prizes:

```js
assert.equal(results.filter((r) => r.result.status === "won").length, 1);
assert.equal(await remainingStock(productId), 0);
assert.equal(await winningClaimCount(productId), 1);
assert.equal(await ordinaryOrderCountForRun(), 0);
```

Also assert same-attempt concurrency returns one original decision; changed payload/credential is refused; metadata save cannot restore stock; a stale explicit quantity update conflicts after a win; a failed insert leaves no decrement; archive/disable blocks new awards while prior result recovery succeeds.

- [ ] **Step 2: Run `node --test tests/database/specialty-claims-concurrency.test.mjs` and the repository Jest test.** Expect the missing award/result RPC failures.
- [ ] **Step 3: Implement the transaction and adapter.** Serialize attempt IDs with a transaction-scoped advisory lock, verify recoveryHash/inputHash/payloadHash binding before current availability, then use shared campaign locking and consistent product → config → variant write locks. Shared campaign readers must not serialize unrelated products; campaign disable must wait for already-deciding transactions. Recheck normalization/key identity, token expiry, go-live, archive/active state, zero price, stock and both unique eligibility keys. Use conflict-safe winner insertion; decrement and advance the per-product decision ordinal only for an accepted winner; persist its attempt/result/snapshots in the same transaction. Record Sold out/Already claimed/Closed without storing losing contact details. Use a two-second lock timeout and five-second statement timeout initially; deadlock/timeout/connection failures become retryable, not business denials. Expected uniqueness conflicts are handled inside a savepoint/conflict-safe insert so they cannot strand stock changes. Keep network calls out of SQL and keep attempts uncommitted until the final result exists.
- [ ] **Step 4: Run schema, concurrency, and repository tests.** Add deterministic lost-response cases: commit a win and discard the response, then recover the same receipt after disable/token expiry; roll back before commit and assert no stock/eligibility was consumed. Confirm both unique database constraints remain authoritative when different products race. Expect PASS and exact stock/result reconciliation.
- [ ] **Step 5: Commit.** Suggested message: `feat: award specialty claims atomically with safe replay`.

### Task 5: Expose protected validation, submission, and recovery APIs

Before fresh validation or submission, compare the configured key fingerprint to the pinned campaign value. Refuse new claims on mismatch. This check never gates authorized credential-only recovery. Extend the shared SpecialtyContext with `identityKeyFingerprint:string|null` when defining it in Task 2, and populate it from the campaign lookup.

**Files:** Create `Claim/{claim-handler,claim-dependencies}.ts`; `RequestProtection/{claim-protection,claim-telemetry}.ts`; the three private `src/app/api/specialty/{eligibility,claims,claims/result}/route.ts` adapters; tests `Claim/claim-handler.test.ts`, `ValidateEligibility/validate-eligibility-handler.test.ts`, `RequestProtection/claim-protection.test.ts` and `tests/unit/specialty-claim-routes.test.ts`. Modify `src/instrumentation-client.ts`, `src/proxy/rate-limit.ts` and `src/config/security.ts` only for the new paths/policies.

**Interfaces:** Export `submitClaimHandler(request:Request,deps:ClaimDependencies):Promise<Response>`, `recoverClaimHandler(request:Request,deps:ClaimDependencies):Promise<Response>`, and `createSpecialtyClaimDependencies():ClaimDependencies`. Define `ClaimDependencies = EligibilityDependencies & {findAttempt(credentials:AttemptCredentials):Promise<StoredAttempt|null>;accept(command:AwardCommand):Promise<ClaimReply>;recordMetric(event:ClaimMetric):void}` using Tasks 2/4. Define `ClaimMetric = {requestId:string;productId?:string;campaignId?:string;outcome:string;durationMs:number}` in claim-telemetry.ts; the sink accepts no arbitrary payload/error object. Reuse the context/protection types already defined in Task 2.

`getContext` returns `{campaignId,productId,browserId,normalizationVersion:1,identityKeyFingerprint:string|null} | null` from trusted configuration, even if a configured product is now archived/sold out so SQL can make the final decision. `protect` accepts `"validate" | "submit" | "recover"` and returns `{allowed:true} | {allowed:false;status:403|429|503;retryAfterSeconds?:number}`. Browser context is a signed, HttpOnly, SameSite cookie (Secure in deployed HTTPS), not an account/email identifier.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/Claim/claim-handler.test.ts src/Modules/SpecialtyProducts/Tests/Features/ValidateEligibility/validate-eligibility-handler.test.ts src/Modules/SpecialtyProducts/Tests/Features/RequestProtection/claim-protection.test.ts tests/unit/specialty-claim-routes.test.ts
```

- [ ] **Step 1: Write failing handler/route tests.** Cover an authorized replay before token expiry/product availability checks, changed-payload conflict, tampered/expired tokens, missing secrets, closed campaign, 429/503/202 distinctions, and invalid JSON/body size. Assert recovery after campaign close uses neither Shippo nor a fresh award; a new key with a previously winning identity returns Already claimed. Assert all private responses are no-store and that logs/metrics never include submitted contact data, tokens, credentials, or provider error strings.

```ts
expect(await response.json()).toEqual({ result: originalDecision, replayed: true });
expect(response.headers.get("Cache-Control")).toContain("no-store");
expect(deps.validateAddress).not.toHaveBeenCalled();
expect(deps.accept).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused Jest files.** Expect missing handlers/routes/protection wiring.
- [ ] **Step 3: Implement adapters and dependency wiring.** Use the existing service-role client, admin-independent guest access, trusted-IP/CSRF/store-access controls, and BotID on eligibility/submission. Initialize BotID for the two new write paths. Recover by opaque credentials with same-origin and rate protection; it must not require a fresh address validation or deep-analysis provider call. Reuse an authorized recorded result first; otherwise validate current payload, verify/refresh the eligibility token, derive keys/fingerprint server-side, and call the award RPC. Reject an expired token at acceptance; refreshing a token with the same canonical identity retains the same attempt. Generate no order/payment/notification job.

Initial quotas: validate 10/minute per browser and 300/minute per IP; submit 10/minute per browser and 2,000/minute per IP; recover 60/minute per browser and 5,000/minute per IP. Store keys under a specialty-specific prefix using hashed identities. Remove these routes from the generic 30/minute write bucket only when this dedicated policy is active; never remove CSRF/bot protection. Protection backend failures return 503. Make quotas named server constants, record any later calibration, and separately test the shared-IP/provider limits instead of calling throttled traffic a successful capacity test. Cap private request bodies at 16 KiB before parsing. On an authorized existing attempt, compare inputHash before token/provider/availability checks; an exact bound retry returns its saved result even with an expired token, whereas changed input returns 409. Credential-only recovery remains available without the submitted fields or signing-secret availability.

- [ ] **Step 4: Run focused tests plus `tests/unit/{csrf,client-ip,checkout-rate-limit,checkout-bot,instrumentation-client}.test.ts`.** Expect PASS; confirm public visitors cannot call privileged database RPCs directly.
- [ ] **Step 5: Commit.** Suggested message: `feat: expose protected specialty claim APIs`.

### Task 6: Add specialty product creation and safe editing

**Files:** Create `ManageProducts/specialty-product-handler.ts`, `ManageProducts/SpecialtyProductForm.tsx`, `ManageProducts/specialty-product-handler.test.ts`, and `ManageProducts/specialty-product-form.test.tsx`; create `src/app/api/admin/specialty/products/route.ts` and `src/app/api/admin/specialty/products/[productId]/route.ts`. Modify `src/components/inventory/ProductForm.tsx`, `src/app/admin/inventory/{create/client.tsx,[id]/edit/client.tsx,[id]/edit/actions.ts,client.tsx}`, `src/lib/validation/product.ts` and `src/services/product-service.ts` at their existing product/category/mutation seams. Test existing product validation/service/archive routes.

**Interfaces:** Export `saveSpecialtyProductHandler(request:Request, productId:string|null):Promise<Response>`, authenticated using `requireAdminApi` before service-role operations. `SpecialtyProductForm` takes `initial?: SpecialtyProductDraft`, `onSubmit(input:SpecialtyProductWrite):Promise<void>` and `onCancel():void`; define `SpecialtyProductDraft = SpecialtyProductMetadata & {productId:string;revision:number;remainingQuantity:number;hasClaims:boolean}` in the product contract. Creation returns `{productId,revision}`; stale/forbidden inventory edits return 409 with no partial mutation.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/ManageProducts/specialty-product-handler.test.ts src/Modules/SpecialtyProducts/Tests/Features/ManageProducts/specialty-product-form.test.tsx tests/unit/product-validation.test.ts tests/unit/product-service.test.ts tests/unit/product-archive-api.test.ts
```

- [ ] **Step 1: Write failing admin/form tests.** Selecting Specialty delegates to the dedicated prize form and offers title, description, images, quantity, instructions and go-live only. Assert no shipping/pickup, price, email, or forced money-prize brand fields. Verify admin 401/403 handling, same-category editing only, explicit quantity-change semantics, and a stale metadata save after a claim preserving stock. Ordinary product creation/editing remains unchanged.

```ts
expect(screen.queryByLabelText(/shipping|pickup|email|card/i)).toBeNull();
expect(staleQuantityResponse.status).toBe(409);
expect(stockAfterMetadataSave).toBe(stockAfterClaim);
```

- [ ] **Step 2: Run new module tests and existing `tests/unit/{product-validation,product-service,product-archive-api}.test.ts`.** Expect focused failures for the absent specialty branch/endpoints.
- [ ] **Step 3: Implement the dedicated form/handlers.** Keep a visible Specialty category choice in the existing creation flow, but delegate to the small feature form instead of expanding ordinary variant logic. Creation/edit clients dispatch specialty payloads to the new endpoints; do not send them to the ordinary product schema/service. Reuse the existing product-image upload protocol. Show current quantity and disable its editing after a win; metadata-only submissions omit quantity. Generic update/duplicate/delete/archive code must not bypass specialized stock/category guards. Preserve archive/read-only behavior and recoverable winner snapshots. Default instructions are exactly: "You claimed [product]. The reseller will contact @[handle] on Instagram to arrange your prize. Keep this confirmation for your records." Store/render custom instructions as plain text, never HTML.
- [ ] **Step 4: Run form/admin tests and the Task 3–4 stale-edit/database guards.** Expect PASS, including quantity changes racing the first claim and no return of consumed stock after save.
- [ ] **Step 5: Commit.** Suggested message: `feat: manage specialty giveaway products in inventory`.

### Task 7: Add random discovery and block ordinary purchase paths

**Files:** Create `Discovery/{discovery.ts,DiscoveryInsertion.tsx,SpecialtyProductCard.tsx}`, `Discovery/discovery.test.ts`, `Discovery/discovery-insertion.test.tsx`, and `src/app/api/specialty/discovery/route.ts`. Modify `src/repositories/product-repo.ts` (storefront listing/search/facets/cart/checkout retrieval seams), `src/services/featured-items-service.ts`, `src/app/(store)/store/page.tsx`, `src/components/store/{ProductGrid,ProductCard,ProductDetail}.tsx`, `src/app/(store)/store/[productId]/page.tsx`, `src/components/home/FeaturedItems.tsx` and `src/app/(store)/page.tsx`. Test existing storefront/cart/checkout/featured units and `tests/unit/specialty-discovery-route.test.ts`.

**Interfaces:** Produce `listSpecialtyDiscoveryPool(client:AdminSupabaseClient):Promise<SpecialtyPublicProduct[]>`, `isSpecialtyDiscoveryAllowed(filters:ProductFilters):boolean`, and `insertDiscoveryItem<T>(items:readonly T[],item:T,position:number):T[]`. `DiscoveryInsertion` consumes ordinary rendered items `Array<{id:string;node:ReactNode}>` plus `allowed:boolean` and renders one extra specialty card at a stable position; never serialize full private ProductWithDetails rows just to make a server grid interactive. `SpecialtyProductCard` consumes only `SpecialtyPublicProduct`; Claim-button/dialog wiring follows in Task 8.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/Discovery/discovery.test.ts src/Modules/SpecialtyProducts/Tests/Features/Discovery/discovery-insertion.test.tsx tests/unit/specialty-discovery-route.test.ts tests/unit/storefront-taxonomy-filters.test.ts tests/unit/cart-validate-route.test.ts tests/unit/checkout-cart-resolver.test.ts tests/unit/featured-items-api.test.ts
```

- [ ] **Step 1: Write failing discovery/exclusion tests.** Assert keyword and every category/brand/model/size/condition/price filter disables injection; sort/view/page alone does not. Count/ordinary order stay unchanged; no specialty category or specialty-only metadata leaks into public facets/search. Assert zero-stock/future/archived/disabled products are absent from the pool. Confirm at most one homepage section is opted in and rerendering does not move the prize. Verify forged cart/checkout lines and curated-featured insertion are rejected.

```ts
expect(isSpecialtyDiscoveryAllowed({ priceMaxCents: 0 })).toBe(false);
expect(isSpecialtyDiscoveryAllowed({ sort: "price_asc", page: 2 })).toBe(true);
expect(insertDiscoveryItem(["a", "b"], "prize", 1)).toEqual(["a", "prize", "b"]);
expect(homepageSpecialtyCards).toHaveLength(1);
```

- [ ] **Step 2: Run module tests plus `tests/unit/{storefront-taxonomy-filters,cart-validate-route,checkout-cart-resolver,featured-items-api}.test.ts`.** Expect focused exclusion/discovery failures.
- [ ] **Step 3: Implement separate discovery and exclusion.** All normal storefront search/list/facet/price/size/condition queries exclude specialty by default while inventory search includes it. Cart/checkout reads exclude it explicitly; retain the database reservation guard. Reject manual placement in ordinary featured inventory so a specialty card cannot bypass campaign checks. Discovery reads only the configured campaign and small specialty pool, joining active/go-live/configured stock; cache its public projection for five seconds with no stale extension. Randomize only specialty selection and insertion position; do not randomize/paginate the ordinary catalog differently. Use a stable per-mount browser seed. Opt in only the homepage's first non-clothing FeaturedItems section and unfiltered Shop All; skip injection when there are no ordinary cards. New client props contain safe public data/server-rendered nodes, never unit costs or claim instructions. Detail pages may render cached specialty metadata but cannot authorize awards.
- [ ] **Step 4: Run the focused regressions.** Confirm the pool endpoint uses five-second CDN headers, private endpoints remain no-store, and stale cards cannot enter cart/checkout. Ordinary counts/sorting and both homepage carousels retain their existing behavior.
- [ ] **Step 5: Commit.** Suggested message: `feat: mix specialty prizes into storefront discovery`.

### Task 8: Build the claim popup and recover the same attempt

**Files:** Create `Claim/{claim-client,attempt-storage}.ts`, `Claim/{ClaimButton,ClaimDialog}.tsx`, `Claim/claim-client.test.ts`, `Claim/attempt-storage.test.ts`, and `Claim/claim-dialog.test.tsx`. Wire `Discovery/SpecialtyProductCard.tsx` and `src/components/store/ProductDetail.tsx`; reuse `src/components/ui/ModalPortal.tsx` and existing dialog focus conventions.

**Interfaces:** Export `validateClaimEligibility(input:EligibilityRequest):Promise<ValidationReply>`, `submitClaim(input:ClaimSubmission):Promise<ClaimReply>`, `recoverClaim(credentials:AttemptCredentials):Promise<ClaimReply|{status:"unknown";retryAfterSeconds:number}>` from the browser client; define `EligibilityRequest` using the eligibility endpoint's exact request shape. Export `createAttempt(productId:string):SavedAttempt`, `readAttempt(productId:string):SavedAttempt|null` and `saveAttempt(attempt:SavedAttempt):void`; `SavedAttempt = AttemptCredentials & {productId:string}`. `ClaimButton({product}:{product:SpecialtyPublicProduct})` owns open state and renders `ClaimDialog({product,open,onClose})`. Keep all secrets server-side and all address/handle form state in memory.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/Claim/claim-client.test.ts src/Modules/SpecialtyProducts/Tests/Features/Claim/attempt-storage.test.ts src/Modules/SpecialtyProducts/Tests/Features/Claim/claim-dialog.test.tsx
```

- [ ] **Step 1: Write failing UI/client/storage tests.** Opening/typing/closing calls no award API. Eligibility corrections need confirmation; address/handle edits clear the eligibility token. Double click sends one attempt; 429/503 and response loss do not become Sold out. On refresh/reopen, recover first; a completed win survives closed campaign/token expiry. Session storage contains only attemptId/recoverySecret/productId, never handle, address, token, or full receipt. Treat unavailable browser storage as an in-memory fallback with an explicit instruction to keep the confirmation open.

```ts
expect(submitClaimMock).not.toHaveBeenCalled(); // opening/typing alone
expect(submitClaimMock).toHaveBeenCalledTimes(1); // after a double submit click
expect(JSON.stringify(savedAttempt)).not.toContain("address");
expect(screen.queryByText(/someone else claimed/i)).toBeNull(); // timeout state
```

- [ ] **Step 2: Run the three new Jest files.** Expect missing dialog/client/storage exports and focused state assertions.
- [ ] **Step 3: Implement the accessible flow.** Validate while completing the form and again if needed before acceptance, without a hold. On submit, allocate credentials once and save them before the network request. Freeze the submitted in-memory payload during an uncertain outcome; check the result endpoint and retry the same attempt with bounded exponential backoff/jitter (base 250 ms, cap 2 seconds, automatic recovery deadline 30 seconds). After that deadline offer Check result again, retaining credentials; never silently allocate a new attempt or announce a loss. After a refresh with an unknown/uncommitted result and no stored address, ask for the original details again using the same attempt; do not claim submission completed. Present one clear accessible state, retain input on errors, restore focus on close, and allow closing without cancelling a committed win. Won shows the saved receipt/instructions; Sold out uses "Unfortunately, someone else claimed this item before you." Already claimed uses "You have already claimed a specialty product in this giveaway." No login/email/card/fulfillment step is introduced.
- [ ] **Step 4: Run UI/client/storage tests and typecheck.** Expect PASS, including keyboard focus/escape behavior, mobile scroll containment, prototype-polluted storage/invalid JSON rejection, no secret in fetch URLs, and no server-only imports in the client bundle.
- [ ] **Step 5: Commit.** Suggested message: `feat: add specialty claim dialog and receipt recovery`.

### Task 9: Add private staff claims and campaign controls

The admin migration produces `update_specialty_claim_status(p_claim_id uuid,p_status text,p_expected_revision bigint,p_actor_id uuid) returns jsonb` and `specialty_claim_status_audit`. The update appends audit and changes follow-up state atomically, without modifying identity, acceptance facts, or stock.

**Files:** Create `ManageClaims/{admin-claims.ts,SpecialtyClaimsClient.tsx}`, `ManageClaims/admin-claims.test.ts`, `ManageClaims/specialty-claims-client.test.tsx`, `src/app/admin/specialty-claims/page.tsx`, `src/app/api/admin/specialty/{claims,claims/[claimId],campaign}/route.ts`, and `supabase/migrations/20261125122000_specialty_claim_admin.sql`. Modify `src/components/admin/{AdminSidebar,AdminTopbar}.tsx`; add `tests/unit/admin-specialty-claims-routes.test.ts` and regenerate database types.

**Interfaces:** Export `listSpecialtyClaims(input:{productId?:string;status?:"new"|"contacted"|"fulfilled";page:number;pageSize:number}):Promise<{claims:AdminSpecialtyClaim[];total:number}>`; `updateSpecialtyClaimStatus(input:{claimId:string;status:"new"|"contacted"|"fulfilled";expectedRevision:number},actorId:string):Promise<AdminSpecialtyClaim>`; `setSpecialtyCampaignEnabled(input:{enabled:boolean;expectedRevision:number},actorId:string):Promise<{enabled:boolean;revision:number}>`. Define `AdminSpecialtyClaim` in `admin-claims.ts` as ClaimReceipt & {imageUrl:string|null;address:EligibilityAddress;status:"new"|"contacted"|"fulfilled";revision:number;updatedBy:string;updatedAt:string}. Eligibility HMAC keys are not returned by the admin API. All exported server operations require trusted authenticated admin context; route adapters call `requireAdminApi` and page calls `requireAdmin`.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath src/Modules/SpecialtyProducts/Tests/Features/ManageClaims/admin-claims.test.ts src/Modules/SpecialtyProducts/Tests/Features/ManageClaims/specialty-claims-client.test.tsx tests/unit/admin-specialty-claims-routes.test.ts
```

- [ ] **Step 1: Write failing admin/API tests.** Verify unauthenticated/customer denial; paginated successful-winner records only; safe Instagram profile links; escaped instructions; New/Contacted/Fulfilled transitions; stale revision conflict; audited actor/time; and no changes to stock, claim identity, eligibility, or accepted instructions when status changes.

```ts
expect(customerListResponse.status).toBe(403);
expect(staleStatusResponse.status).toBe(409);
expect(afterStatusUpdate.addressKey).toBe(beforeStatusUpdate.addressKey);
expect(afterStatusUpdate.remainingStock).toBe(beforeStatusUpdate.remainingStock);
```

- [ ] **Step 2: Run new module/route tests.** Expect focused missing-page/operation failures.
- [ ] **Step 3: Implement staff views and mutation RPCs.** Add Specialty Product Claims to Commerce and its active-prefix/title handling. Render product/reference/time/decision order, Instagram link, private address details, saved instructions, status controls and product/status filters. Page size defaults to 25 and is capped at 100. Protect status writes with compare-and-set revision plus an append-only actor/time audit record; add the corresponding audit table in the award migration. The enabled switch is manual, revision-checked, and begins disabled. Closing stops new SQL awards even if discovery is cached. Do not add claims to ordinary transactions, shipping, pickup, tax totals, payment expiry, or emails.
- [ ] **Step 4: Run focused tests plus `tests/unit/admin-contrast.test.tsx` and Task 4 recovery/disable tests.** Expect PASS; public and non-admin clients cannot retrieve contact records or call the follow-up RPC directly.
- [ ] **Step 5: Commit.** Suggested message: `feat: add admin specialty claims and campaign controls`.

### Task 10: Prove customer/admin integration in the browser

**Files:** Create `tests/browser/specialty-claims.mjs` and `tests/browser/fixtures/specialty-claims.mjs`; update `package.json` with `test:specialty:browser` and `test:specialty:database` scripts using the exact file lists in this plan. Extend the operator guide with the local browser/database prerequisites.

**Interfaces:** Produce a browser runner with `--mode=mocked|database` and `--base-url=<local-or-staging-origin>`. Mocked mode checks UI behavior with labeled route fixtures; database mode uses the real application/claim RPC and isolated prizes. Expose fixture helpers `seedBrowserPrize(runId:string,quantity:number)` and `readBrowserRunState(runId:string):Promise<{winningClaims:number;remainingStock:number;ordinaryPrizeOrderItems:number}>` in the test fixture; they use the same guarded database target as Task 3 and never live production prizes. Do not add test bypass routes to the application.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node tests/browser/specialty-claims.mjs --mode=mocked --base-url=http://localhost:3000
node tests/browser/specialty-claims.mjs --mode=database --base-url=http://localhost:3000
```

- [ ] **Step 1: Write failing browser scenarios.** Assert a visible Claim action opens the popup without adding a cart line/hold; form fields contain only the approved information; a winner sees stored instructions and loses exactly one unit; a loser sees the losing message; case/address variants are blocked across different products; fresh guest and signed-in sessions share the same cap. Cover filtered-search exclusion, homepage double-section placement, keyboard/mobile behavior, authorized admin follow-up, and continued ordinary paid checkout/cart behavior.

```js
await expect(page.getByLabel("Instagram handle")).toBeVisible();
await expect(page.getByLabel(/card number/i)).toHaveCount(0);
assert.equal(stateAfterRecovery.winningClaims, 1);
assert.equal(stateAfterRecovery.remainingStock, 0);
assert.equal(stateAfterRecovery.ordinaryPrizeOrderItems, 0);
```

- [ ] **Step 2: Run the runner in mocked mode before the UI is wired.** It must fail on the missing feature assertion; treat a stopped app/missing fixture as setup failure rather than red test evidence.
- [ ] **Step 3: Complete the browser harness and response-loss probe.** Use the existing repository Playwright programmatic style. Include an app-to-database lost-response test: allow a real winning request to commit, drop only its browser response, reopen/refresh, and verify the same receipt and stock. Distinguish that from a route returning a fabricated winning fixture. Ensure source fixture tokens/credentials/contact data never enter screenshots, saved traces or reports. Keep campaign disabled outside test-owned fixtures.
- [ ] **Step 4: Run `node tests/browser/specialty-claims.mjs --mode=mocked --base-url=http://localhost:3000`, then database mode against the guarded local app/database.** Run existing `home-featured-items.mjs`, `home-clothing.mjs`, `checkout-ui.mjs` and `checkout-success.mjs` browser regressions. Expect PASS; label provider mocking and hosted differences explicitly.
- [ ] **Step 5: Commit.** Suggested message: `test: cover specialty claim browser and admin flows`.

### Task 11: Deliver the 1,000-submission stress harness and release evidence

Use exact report fields `actorCount`, `requestCount`, `outcomes.{won,soldOut,alreadyClaimed,retryable,unresolved,unexpectedErrors}`, `latency.{p95Ms,p99Ms}`, `maxResolutionMs`, and `reconciliation.{winnerCount,remainingStock,duplicateIdentities,ordinaryPrizeOrderItems}`, plus target/mode/SHA/generator metadata and failure reasons. Require a client dispatch window of at most one second for the nominal synchronized burst, record observed in-flight concurrency and server-ingress timing where available, and fail qualification if the generator cannot deliver that workload. A staging synthetic campaign row plus its deployment's explicitly matching campaign slug is the test-owned marker; the preparer may create that row only after verifying the non-production origin/project allowlist. Cleanup rechecks the marker/manifest and deletes only that run's synthetic data in FK-safe order; it does not change production configuration or drop/disable global protections.

**Files:** Create `scripts/load/{specialty-fixtures,specialty-claims}.mjs`, `tests/load/specialty-claims-runner.test.mjs` and `docs/operations/specialty-giveaway-claims.md`. Update `package.json` with `test:specialty:load` invoking the Node runner. The existing CI unit-test glob already discovers module tests; keep real database and hosted stress qualification explicit release gates rather than adding a new CI infrastructure project. Existing deployment workflows inject Doppler variables, while Vercel runtime variables come from its project configuration; document and verify the two new runtime variables in that existing path without changing branch/tag gates or printing secret values.

**Interfaces:** `specialty-fixtures.mjs` exports `prepareSpecialtyLoadRun(options):Promise<LoadManifest>`, `assertLoadTarget(options):Promise<void>` and `cleanupSpecialtyLoadRun(manifest):Promise<void>`. `LoadManifest` includes runId, permitted origin/project/database identity, synthetic campaign/product IDs, counts, and private fixture-credential file location; it is never a response from a public route. `specialty-claims.mjs` exports `runSpecialtyBurst(manifest,options):Promise<SpecialtyLoadReport>` and CLI `--target=local|staging --scenario=<name> --concurrency=1000`. Define `SpecialtyLoadReport` as sanitized JSON containing deployment SHA, mode/provider/protection differences, generator arrival window/actual concurrency, request/result counts, percentile latencies, terminal resolution times, database before/after inventory/winner reconciliation, and pass/fail reasons.

**Focused verification for Steps 2/4:** run the following command(s); after the new tests are written expect the specified feature failure, and after implementation expect PASS. Existing regressions in the command must remain passing.

```powershell
node --test tests/load/specialty-claims-runner.test.mjs
node --import tsx scripts/load/specialty-claims.mjs --target=local --scenario=hot-one --concurrency=1000
```

- [ ] **Step 1: Write failing runner/target-safety tests.** Reject production/mismatched project or database targets, real prize IDs, missing test marker, changed run manifests, and cleanup outside the run namespace. Assert a barrier releases 1,000 independent HTTP actors rather than serializing 1,000 awaited requests; failing to achieve the reported arrival window cannot produce a capacity PASS. Duplicate request count is distinct from unique claimant count. A thousand 403/429 responses must not pass the valid-claim capacity test.

```js
assert.equal(report.actorCount, 1000);
assert.equal(report.outcomes.won, 1); // hot-one
assert.equal(report.reconciliation.duplicateIdentities, 0);
assert.equal(report.outcomes.unresolved, 0);
assert.ok(report.latency.p95Ms <= 3000 && report.latency.p99Ms <= 10000);
assert.ok(report.maxResolutionMs <= 30000);
```

- [ ] **Step 2: Run `node --test tests/load/specialty-claims-runner.test.mjs`.** Expect missing runner/guard failures, without connecting to any production database.
- [ ] **Step 3: Implement synthetic fixtures, bounded load, and reports.** Use existing pg and Node HTTP/fetch facilities; no new queue service, load-testing application bypass, or production-only fixture endpoint. Use independent requests and a common barrier; report transport/generator constraints rather than hiding them with queued client requests. Local fixtures use Task 3's disposable database. Staging requires an explicit expected project ref, non-production origin allowlist, synthetic campaign slug `black-friday-2026-load-<runId>`, a pre-existing test-owned target marker, and that deployment's configured `SPECIALTY_CAMPAIGN_SLUG` matching the synthetic campaign. Verify these conditions before seeding; no script switches a production deployment's campaign. Create synthetic canonical address/handle fixtures and sign real eligibility tokens using that isolated target's secret locally in the trusted runner; delete credential artifacts after the run, keep only sanitized evidence. Stage authorization, secret availability, and host bot-test support must be checked before a measured run. Document provider-supported isolated staging test mode if needed; never silently disable deployed bot/security controls.

Implement named scenarios `hot-one` (quantity 1), `hot-many` (quantity 10), `multi-product`, `duplicate-address`, `duplicate-instagram`, `replayed-attempt`, `lost-response` and `overload`. Each normal burst has 1,000 synchronized submissions; include a distinct-identity multi-product run and cross-product cap races. Reconcile actual winners and stock afterward. Test on-demand/cold address validation and provider failure separately; prepared-token capacity does not prove Shippo's ability to validate 1,000 new addresses simultaneously. Record shared-IP quota effects and real browser/BotID evidence separately from isolated HTTP application capacity.

- [ ] **Step 4: Run local harness self-tests, real database contention, and the 1,000-submission local HTTP scenarios.** Require exactly one hot-one winner, 10 hot-many winners, no duplicate campaign identity, no negative stock, no lost committed receipt, no ordinary order/payment creation, and truthfully resolved outcomes. Fail the prepared-valid-submission capacity result if p95 > 3 seconds, p99 > 10 seconds, any attempt remains unresolved after 30 seconds, or unexpected server errors occur. An overload scenario may produce bounded retryable responses, but must never produce false business losses, extra winners, or corruption. Run hosted staging qualification only on the explicitly permitted deployment/fixtures and record its real outcome; if access or test-mode setup is unavailable, mark that evidence pending rather than claiming a pass. This is a release gate, not permission to change staging/production outside existing controls.
- [ ] **Step 5: Run final verification and commit.** Execute full existing unit/integration suites, focused real database tests, relevant browser checks, typecheck, lint, formatting and a production build. Record command results, tested SHA/deployment, capacities and provider/protection gaps in the operator guide/evidence output. Use existing deployment secret management for `SPECIALTY_CLAIMS_SECRET` and the single selected campaign slug; do not print secrets. Keep the campaign disabled until staged validation and the normal release approval. Commit only feature/evidence-guide changes: `test: qualify specialty claims under simultaneous load`.

## Concrete verification commands

These are execution-time commands; none of the implementation or load checks are claimed to have run during planning.

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand
node node_modules/jest/bin/jest.js --config jest.integration.config.ts --runInBand
node --test tests/database/specialty-claims-schema.test.mjs tests/database/specialty-claims-concurrency.test.mjs
node --test tests/load/specialty-claims-runner.test.mjs
node tests/browser/specialty-claims.mjs --mode=database --base-url=http://localhost:3000
node --import tsx scripts/load/specialty-claims.mjs --target=local --scenario=hot-one --concurrency=1000
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ignore-pattern "test-results/**" --ignore-pattern ".playwright/**"
node node_modules/prettier/bin/prettier.cjs --check <explicit-changed-files>
doppler run -- node node_modules/next/dist/bin/next build
```

Run every named load scenario; the hot-one command is the example, not the whole load suite. Use PowerShell environment setup for a disposable database and the local/staging app; never put credential URLs in the report or shell history. Where a broad baseline check fails on unrelated work, record the failure and the focused result instead of describing the whole repository as passing.

## Self-review and handoff

Before presenting this plan, check:

- [x] Every approved requirement has an owning task: prize creation/stock (3/6), canonical eligibility (1/2), atomic winner/replay (4/5), discovery/exclusions (7), popup/recovery (8), staff/campaign controls (9), real browser checks (10), and 1,000-submit evidence/operation (11).
- [x] Every cross-task type/function is defined above or introduced in the task that produces it; no client imports privileged dependencies.
- [x] The five Review Focus conditions each have an explicit owning test.
- [x] Database correctness, mocked browser behavior, actual provider integration, and hosted capacity remain separately reported.
- [x] No queued architecture rebuild, production mutation, unrequested messaging, or unrelated assessment work was added.

Execution recommendation: Native execution in this session, with one independent whole-branch review before release handoff. These tasks share database/API contracts heavily and the user prioritized speed; a fresh implementer/reviewer per task adds coordination cost. Subagent-driven execution remains an option if the user prefers the additional independent review gates.

The next step is user review of this plan and choice of execution method. Only then invoke executing-plans (Native) or subagent-driven-development (Subagent-driven). At execution start use the worktree skill, record the isolated branch/baseline, implement task-by-task with focused commits, and review the complete branch before any proposed merge/release.
