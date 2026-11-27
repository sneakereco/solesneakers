# Checkout and Cart Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair all scoped checkout/cart findings on the current release and produce evidence for truthful customer states, purchase correctness and Black Friday readiness.

**Architecture:** Selectively port reviewed Cart/Checkout behavior behind compatible current route/component adapters. PostgreSQL owns allocation, financial attempts, provider facts and durable recovery; Cart owns browser basket revisions and original-unit consumption. Keep external calls outside SQL locks and coordinate, rather than duplicate, the independent load/giveaway/UX work.

**Tech Stack:** Existing Node 24.14.1 floor, TypeScript, Next.js 16.3.3 installed documentation, React 19, Supabase/PostgreSQL 17, Square SDK 45, Upstash, Jest, Playwright/esbuild and existing SMTP outbox. Retain project-pinned versions; do not upgrade this stack as part of the repair.

**Spec:** [Approved design](../specs/2026-11-25-checkout-cart-release-hardening-design.md), approved November 25, 2026. Also read the [13-finding assessment](../../operations/2026-11-25-black-friday-checkout-cart-assessment.md).

## Global Constraints

- “Keep the existing 15-minute hold duration.”
- “Preserve tab-local guest `sessionStorage` and account-specific `localStorage` keys.”
- “Preserve the existing deliberate guest/account separation on sign-in; do not silently merge or transfer baskets.”
- “Keep an unavailable row visible with its product/size, requested quantity and reason.”
- “No provider call occurs while those database locks are held.”
- “Do not persist card details, raw payment source tokens or Turnstile tokens.”
- “Keep `orders.status` as a compatible projection for current consumers, not the sole history or authority for all of them.”
- “No paid upgrade is authorized by this design.”
- “Preserve PR staging and production tag gates”; no task authorizes merge, promotion, a production stress run or real card charges.
- “Proposed initial worker settings: one-minute schedule for recovery and notification fallback, batches of 50 with repeated claims until a 45-second budget, at most four concurrent external operations per dependency, 10-second external request deadline, 120-second leases, and retry delays from 5 seconds to five minutes with jitter.” Verify plan support and calibrate before enabling. Global limits apply across invocations.
- Preserve USD integer-cent totals, supported payment methods, address review, pickup/shipping/billing rules and consent behavior. Read relevant `node_modules/next/dist/docs/` guides before framework changes.
- New feature source/tests live under `src/Modules/<Module>/{Source,Tests}/Features/<Feature>/`; retain current framework import points as adapters. Historical migrations are immutable. Current `.codegraph/` means CodeGraph is the first code-location/read tool.
- Isolate execution using the worktree skill. Never merge the broad architecture branches, reset shared Supabase, stage unrelated concurrent work, or copy donor test claims as receiving-branch proof.

## Review Focus

1. A browser/API dies after dispatch is recorded but before a payment ID is saved: retain one unknown attempt, prevent a second charge, recover with no open browser. Pin in Tasks 4, 5 and 12.
2. Remove/readd the same SKU or change account while a write/receipt waits for its lock: newer units/account state survive. Pin in Tasks 8, 9 and 11.
3. Own last-unit hold makes public stock zero: ordinary validation must retain the customer's original held units without trusting a supplied order ID. Pin in Tasks 7 and 10.
4. A poisoned first batch or Redis outage overlaps worker invocations: global dependency limits, fairness and durable inquiry continue. Pin in Tasks 3 and 12–14.
5. Old clients/permits and a partial rollout meet tighter grants: staff mutations remain authorized, customer mutations fail, legacy retry resumes one attempt and rollback retains guards. Pin in Tasks 2, 5, 15 and 17.

---

## Baseline, execution boundaries and file structure

Planning source is `d8ce10191a294a0974be759bb2cb43b0bd980c53`; reviewed design/evidence commit is `167ce4b1b1d3d7b0847b8a3511c932be237dc733`. Confirm current application drift before execution. Preserve the concurrent load, specialty and UX documents/files. The load suite remains owned by [its plan](2026-11-25-black-friday-hybrid-load-testing.md); specialty claims by [their plan](2026-11-25-specialty-giveaway-claims.md). This is one coordinated safety plan because dispatch, reservation, receipt and basket proof share invariants. Those independent projects are not subprojects to rebuild here.

All paths below are repository-relative. Braces enumerate exact files in that directory; `.test.ts` files live in the matching feature Tests directory, while `.postgres.test.mjs` and `.browser.mjs` use Node's runner and real database/browser adapters. Existing Jest includes `src/**/*.test.ts(x)`; do not pretend its current integration config includes feature-local `.mjs` files.

| Owner                            | Source files / responsibility                                                                                                                                                                                              | Existing adapters touched                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Orders TrustedMutations          | `src/Modules/Orders/Source/Features/TrustedMutations/{trusted-order-write,order-write-repository}.ts`                                                                                                                      | Admin order fulfill/pickup routes, order repositories/services; required label/refund/event writers |
| Checkout Recovery                | `src/Modules/Checkout/Source/Features/Recovery/{recovery-contract,recovery-repository,recovery-worker,expiry-operation,notification-drain,dependency-lease}.ts`                                                            | Existing expire/notification crons and scheduler                                                    |
| Checkout Payments                | `src/Modules/Checkout/Source/Features/Payments/{attempt-contract,attempt-repository,dispatch-payment,payment-facts,webhook-inbox,projection-repository}.ts`                                                                | Permit/pay dependency factories, handlers, Square payment event/webhook adapters                    |
| Checkout Preparation             | `src/Modules/Checkout/Source/Features/Preparation/{guest-context,reservation-contract,reservation-repository,prepare-checkout}.ts`                                                                                         | Existing quote/prepare routes, checkout reservation repository                                      |
| Cart ManageBasket/ValidateBasket | `src/Modules/Cart/Source/Features/ManageBasket/{CartProvider,cart-storage,decode-saved-basket,use-basket-identity,purchase-capture}` and `ValidateBasket/{validation-contract,request-validation,reconcile-validation}.ts` | Existing CartProvider/service paths, product add, cart page/drawer, root/session observers          |
| Checkout Outcomes                | `src/Modules/Checkout/Source/Features/Outcomes/{outcome-contract,outcome-observer,client-session,prepared-attempt,CheckoutOutcome,CheckoutOutcomeProvider}`                                                                | Existing processing/success/cancel pages, CheckoutClient and SquarePaymentMethods                   |
| Orders OrderStatus               | `src/Modules/Orders/Source/Features/OrderStatus/purchased-lines.ts`                                                                                                                                                        | Authorized order GET and OrdersService                                                              |
| Checkout Operations              | `src/Modules/Checkout/Source/Features/Operations/{admission,checkout-controls,lifecycle-event,health-snapshot}.ts`                                                                                                         | Proxy limiter, checkout limiter/access, logger, worker metrics                                      |
| Shared SQL/testing               | Five additive migrations listed below; `tests/database/fixtures/checkout-hardening.mjs`, `scripts/test-checkout-hardening-db.mjs`, `tests/browser/fixtures/checkout-hardening.mjs`                                         | Generated database types, package scripts, CI, `vercel.json`, release runbook/evidence checks       |

Use `.tsx` for CartProvider/CheckoutOutcome/CheckoutOutcomeProvider, `.ts` for hooks without JSX and the other source files. Retain neutral Cart contracts and its narrow `Source/Client.ts` entry; do not expose storage implementation details to Checkout. The donor's complete Cart private capture implementation is `purchase-capture.ts` together with changes to `cart-storage.ts` and `Contracts/Basket.ts`; merge those changes with Task 8's newer storage repairs rather than overwrite them with an older donor file. The donor's Outcomes helpers are `order-polling.ts`, `order-state.ts` and `status-url.ts`; retain those private helpers behind the planned observer. Create `src/Modules/Checkout/Source/Client.ts` in Task 11 for the narrow public observer/provider/session surface. Dependency injection object types are private implementation choices; the named cross-task interfaces and DTOs below are fixed.

Reserve migrations `20261127040000_checkout_authority.sql`, `20261127041000_checkout_recovery.sql`, `20261127042000_checkout_attempts.sql`, `20261127043000_checkout_financial_facts.sql`, `20261127044000_checkout_reservations.sql`, `20261127045000_checkout_operations.sql`. Verify these versions are unused and ordered after current main and the independently planned specialty `120000/121000` migrations. If another writer has taken a version, coordinate one replacement sequence before committing; never edit a published migration. Regenerate `src/types/db/database.types.ts` from the combined disposable schema after each relevant task, serialized with the specialty owner.

### Common commands and task completion

Use the pinned Node runtime from `mise.toml`; on this Windows host it is available under `C:\Users\dsrus\AppData\Local\mise\installs\node\24.14.1\`. Set `PLAYWRIGHT_BROWSERS_PATH=C:\Users\dsrus\AppData\Local\ms-playwright` for local browser commands when needed. Do not download browsers if the installed matching runtime works.

`JEST <path>` below means `node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath <path>`. `DB <path>` means `node scripts/test-checkout-hardening-db.mjs --test <path>` from Task 1. `BROWSER <path>` means `node --test <path>`. Expand these aliases in execution logs; they are notation, not assumed shell functions. Every task has a red test, minimal implementation, green verification and a scoped commit. A missing runtime/provider is an explicit unrun gate, not PASS. Review each task before depending on it.

## Task 1: Reproducible isolated database/browser safety harness

**Files:** Create `tests/database/fixtures/checkout-hardening.mjs`, `tests/database/checkout-hardening-fixture.test.mjs`, `scripts/test-checkout-hardening-db.mjs`, `tests/browser/fixtures/checkout-hardening.mjs`, `tests/browser/checkout-hardening-fixture.test.mjs`, `docs/operations/checkout-hardening-port-manifest.md`.

**Interfaces:** Produce `withCheckoutDatabase(mode: 'fresh' | 'populated', run: (fixture: CheckoutDatabase) => Promise<void>): Promise<void>`. `CheckoutDatabase` exposes `admin`, `connect(role): Promise<Client>`, `seedCatalog({stock}): Promise<{productId,variantId}>`, `seedOrder({userId?,status?,totalCents?}): Promise<{orderId,userId}>`, `barrier(parties): {wait():Promise<void>, release():void}`. `mountCheckoutBrowser({initialUser,guestItems,accountItems,route}): Promise<{page,context,close}>` mounts actual providers with synthetic framework/network seams; no cart-hook substitute.

The browser fixture's `route` is an intercepted network callback; add optional `path` and `view:'cart'|'checkout'|'receipt'` inputs to select the actual current UI adapter. A fixture-only probe publishes the current real hook values as `window.testCart` and `window.testSession`; these names never enter production code. Assertion snippets below name the test and its essential expectations, with local fixture variables arranged as described in that task's Step 1; they are not complete test files or extra application interfaces. Use Playwright's expect for browser assertions, Jest's expect for unit tests and Node assert for SQL/CLI assertions.

- [ ] **Step 1 — Red guard tests:** reject a remote URL, ordinary `postgres` as mutation target, URL query/fragment, pre-existing target, missing cleanup ownership marker and an unexpected external browser request. Assert application-database fingerprints are unchanged after successful/failed setup and cleanup. `node --test tests/database/checkout-hardening-fixture.test.mjs tests/browser/checkout-hardening-fixture.test.mjs` must initially fail because the guarded fixture is absent.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: rejects_foreign_targets_without_touching_application_data
assert.notEqual(rejected.status, 0);
assert.deepEqual(applicationAfter, applicationBefore);
assert.equal(ownedDatabasesAfterCleanup.length, 0);
```

- [ ] **Step 2 — Implement the fixture:** use the pinned Supabase CLI to start an isolated temporary project with an owned `checkout-hardening-test-<run>` project ID, unique loopback ports and seed disabled. Its real platform bootstrap supplies auth/storage/extensions and roles; apply the complete application migration directory and verify the registry/hashes. Fresh mode starts empty; populated mode applies the historical prefix, seeds synthetic data, then applies hardening additions and verifies preserved rows. Reuse existing preflight guards where safe; do not clone an old function set and call it fresh replay. Cleanup stops only the owned project, then verifies every resolved temporary path is beneath its owned workspace directory before removal. No global stop/prune or application db reset is allowed.
- [ ] **Step 3 — Implement CLI/browser seams:** `--test` executes the requested real Node test with fixture credentials supplied privately, records exact source/schema/run IDs, and cleans only owned databases. Fixture callbacks get independent connections and barriers. Browser routes reject all non-fixture egress, with an explicit installed-browser check. Print no URLs containing credentials. Keep diagnostic assertions distinct from correctness assertions.
- [ ] **Step 4 — Green:** run the guard command again and `node scripts/test-checkout-hardening-db.mjs --self-test`; require guard passes, complete fresh migration replay, populated preservation, no leaked fixture and deliberate gate failure detected. Record donor SHAs (`b2064a32`, Checkout `da3c0d1f`, capture/observation/transport dependencies), imported tests and adaptation decisions in the port manifest.
- [ ] **Step 5 — Commit:** `test: add isolated checkout safety harness`. Stage only the listed harness/manifest paths. No product behavior changes in this task.

## Task 2: Trusted staff mutations and customer financial-write denial

**Depends:** 1. **Files:** Create Orders TrustedMutations source above; matching `trusted-order-write.test.ts` and `authority.postgres.test.mjs`; migration `20261127040000_checkout_authority.sql`. Modify `src/app/api/admin/orders/[orderId]/{fulfill,pickup}/route.ts`, required label/refund/event writers found in the mutation inventory, `src/repositories/orders-repo.ts`, `src/services/orders-service.ts`, generated types.

**Interfaces:** `writeTrustedOrder(input: {orderId:string; action:'fulfill'|'pickup'; trackingNumber?:string|null; carrier?:string|null}, actor: {userId:string; role:'admin'}, deps): Promise<{orderId:string; fulfillmentStatus:string}>`. Actor comes only from `requireAdminApi`; `order-write-repository.ts` performs narrowly validated service-only mutations. Existing tracking/customer GET contracts remain unchanged.

- [ ] **Step 1 — Red:** in the real role test, seed an owned order as service, then attempt total/status/user/line/payment/reservation writes and callable-definer bypasses as anon/customer. Assert denial and unchanged rows, including the assessment's canceled/one-cent case. Add route tests: unauthenticated 401, customer 403, validated admin fulfillment/pickup succeeds and emits one event.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: customer_cannot_rewrite_owned_order_finances
await assert.rejects(
  customer.query("update public.orders set total = 0.01 where id = $1", [orderId]),
  /permission denied|row-level security/,
);
assert.equal(
  (await admin.query("select total from public.orders where id=$1", [orderId])).rows[0]
    .total,
  originalTotal,
);
```

- [ ] **Step 2 — Run** `DB src/Modules/Orders/Tests/Features/TrustedMutations/authority.postgres.test.mjs` and `JEST src/Modules/Orders/Tests/Features/TrustedMutations/trusted-order-write.test.ts`; first run must expose the existing grant/policy and session-client dependency failures.
- [ ] **Step 3 — Implement trusted routes before restrictions:** inventory all financial/child writes and required execute privileges, adapt staff paths after server auth, then revoke client mutation/TRUNCATE/unnecessary grants and broad customer `ALL` policies while preserving owned reads. Restrict any new definer RPC to service_role and a fixed search path. Keep existing service/webhook workers functional.
- [ ] **Step 4 — Green:** rerun both commands plus affected admin/shipping/refund unit tests. Assert staff read/write/label/refund/resend compatibility and customer read isolation against the real schema. Regenerate types; retain the inventory in the port manifest.
- [ ] **Step 5 — Commit:** `fix: restrict order financial writes to trusted operations`, staging only this task's inventory-approved files. Production tightening waits for Task 17's compatible rollout.

## Task 3: Durable work, webhook receipt storage and global dependency leases

**Depends:** 1. **Files:** Recovery `recovery-contract.ts`, `recovery-repository.ts`, `dependency-lease.ts`; Payments `webhook-inbox.ts`; matching `work-storage.test.ts`, `work-storage.postgres.test.mjs`; migration `20261127041000_checkout_recovery.sql`; generated types.

**Interfaces:** `RecoveryKind = 'reconcile_payment'|'expire_reservation'|'square_event'`; `RecoveryJob = {id:string; kind:RecoveryKind; orderId:string|null; eventId:string|null; leaseToken:string; attempts:number}`. Produce `enqueueRecovery(input): Promise<void>`, `claimRecovery({limit:50,leaseSeconds:120,now}): Promise<RecoveryJob[]>`, `finishRecovery({id,leaseToken,result:'done'|'retry'|'review',nextAttemptAt?,reason?}): Promise<boolean>`, `acquireDependencyLease({dependency:'square'|'shippo'|'smtp',limit:4,leaseSeconds:120}): Promise<string|null>`, `releaseDependencyLease(token): Promise<void>`, `receiveSquareEvent({eventId,kind,payloadHash,payload}): Promise<'stored'|'duplicate'>`. Enqueue and receipt RPCs can run in the caller's financial transaction.

`RecoveryInput` has `uniqueKey:string`, `dueAt:string` (ISO), scrubbed `reason:string|null`, and either `{kind:'square_event';eventId:string}` or `{kind:'reconcile_payment'|'expire_reservation';orderId:string}`. Use SQL names `enqueue_checkout_recovery`, `claim_checkout_recovery`, `finish_checkout_recovery`, `acquire_checkout_dependency_lease`, `release_checkout_dependency_lease` and `receive_checkout_square_event`; their named parameters map to these DTO fields. Expose them only through the repository and service role.

- [ ] **Step 1 — Red:** race two claims and five lease acquirers on independent connections. Assert disjoint job sets, at most four active dependency leases, expired-token completion returns false, one duplicate event produces one work obligation, a poison job reschedules behind other due work and Redis is never required. Run `DB src/Modules/Checkout/Tests/Features/Recovery/work-storage.postgres.test.mjs` to observe missing storage/RPC failures.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: disjoint_claims_and_global_dependency_limit_survive_redis_outage
assert.equal(
  firstClaim.some((a) => secondClaim.some((b) => a.id === b.id)),
  false,
);
assert.equal(acquiredLeases.filter(Boolean).length, 4);
assert.equal(await finishRecovery(staleCompletion), false);
```

- [ ] **Step 2 — Implement additive service-only work/inbox/lease tables or scoped additions to the existing webhook table:** indexed due time/lease expiry, active-work uniqueness, SKIP LOCKED claims, bounded payloads, keyed receipt deduplication and individually persisted retry/review reasons. Keep previously processed events recognizable; migration cannot turn every old event into new work.
- [ ] **Step 3 — Implement TypeScript adapters** with the exact interfaces above and runtime JSON validation. All stale-token updates are conditional. Claim/lease transactions finish before external work; dead workers relinquish claims only through expiry.
- [ ] **Step 4 — Green:** rerun DB plus `JEST src/Modules/Checkout/Tests/Features/Recovery/work-storage.test.ts`. Verify fresh/populated replay, direct client denial, expired/reclaimed lease races and no duplicate active work. Update generated types.
- [ ] **Step 5 — Commit:** `feat: persist checkout recovery work and dependency leases`.

## Task 4: One durable financial attempt per order

**Depends:** 2–3. **Files:** Payments `attempt-contract.ts`, `attempt-repository.ts`; matching `attempt-repository.test.ts`, `attempt-ledger.postgres.test.mjs`; migration `20261127042000_checkout_attempts.sql`; generated types.

**Interfaces:** `AttemptState = 'ready'|'dispatch_started'|'pending'|'unknown'|'succeeded'|'declined'|'canceled'|'review'`. `PaymentAttempt = {id:string;orderId:string;sequence:number;state:AttemptState;method:PaymentMethod;amountCents:number;currency:'USD';squareIdempotencyKey:string;requestDigest:string|null;providerPaymentId:string|null}`. Produce `getOrCreateAttempt({orderId,method,ownerBinding}): Promise<PaymentAttempt>`; `beginDispatch({attemptId,ownerBinding,requestDigest,sourceDigest}): Promise<{kind:'dispatch'|'observe';attempt:PaymentAttempt}>`; `recordAttemptOutcome({attemptId,providerPaymentId,state,verifiedFacts}): Promise<PaymentAttempt>`. `ownerBinding` is server-derived, never a client user ID.

- [ ] **Step 1 — Red:** barrier-race creation for one pending order; assert one unresolved row and one stable key. Race beginDispatch; exactly one result is dispatch. Crash after that commit; reload reports unknown/dispatch_started and rejects fresh-attempt replacement even after lease expiry. A verified decline permits sequence 2 only while the same order/hold remains payable. Run the real ledger test and observe failure.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: two_issuers_share_one_attempt_and_one_dispatch
assert.equal(attemptA.id, attemptB.id);
assert.equal(attemptA.squareIdempotencyKey, attemptB.squareIdempotencyKey);
assert.equal(decisions.filter((x) => x.kind === "dispatch").length, 1);
assert.equal(reloaded.state === "unknown" || reloaded.state === "dispatch_started", true);
```

- [ ] **Step 2 — Implement schema/RPCs:** `get_or_create_checkout_payment_attempt`, `begin_checkout_payment_dispatch` and `record_checkout_payment_outcome` back the three named interfaces. Add unresolved-attempt partial uniqueness (ready/dispatch_started/pending/unknown/review), unique provider IDs/key, exact cent/currency/method/cart binding, additive guest context binding on orders, transition history/review reason and durable recovery enqueue in the same dispatch transaction. Lock order then attempt before inventory rows. Ready means no provider invocation; dispatch_started means money may have moved.
- [ ] **Step 3 — Implement adapter/runtime schemas:** mismatched source/request digests cannot replace a dispatched request; terminal or unknown attempts cannot become ready through a generic update. Never store raw payment/Turnstile tokens. Add service-only narrowly guarded mutations to the role test.
- [ ] **Step 4 — Green:** `DB src/Modules/Checkout/Tests/Features/Payments/attempt-ledger.postgres.test.mjs` and `JEST src/Modules/Checkout/Tests/Features/Payments/attempt-repository.test.ts`; assert lost response, response-save failure, simultaneous fresh permits and attempt-expiry cases. Regenerate types.
- [ ] **Step 5 — Commit:** `fix: persist a single guarded payment attempt per order`.

## Task 5: Bind permits and gateway dispatch to the durable attempt

**Depends:** 4. **Files:** Create Payments `dispatch-payment.ts`, `dispatch-payment.test.ts`; modify `src/lib/checkout/{issue-payment-permit,create-direct-payment,payment-api-dependencies,payment-permit}.ts`, `src/Modules/Checkout/Source/Features/ContractCompatibility/payment-permit-reader.ts`, `src/lib/square/payments.ts`, relevant existing permit/API tests. Preserve reader compatibility.

**Interfaces:** `dispatchPayment({permit,sourceId}, deps): Promise<{kind:'observe';orderId:string;attemptId:string;statusUrl:string}|{kind:'not_submitted';code:'PAYMENT_NOT_SUBMITTED';message:string}|{kind:'declined';orderId:string;attemptId:string}>`; consumes Task 4's beginDispatch/outcome methods. New permits add attemptId and retain the current order/device/method/total binding. Legacy permits resolve to the same guarded ledger before any call.

- [ ] **Step 1 — Red:** send two distinct consumed permits for the same pending order through real handlers with a counted gateway adapter; assert `gateway.create` called exactly once and the stable key equals the persisted attempt key. Also pin: invalid source before dispatch => PAYMENT_NOT_SUBMITTED; timeout/save failure/token-used/idempotency-conflict after dispatch => observe, never that code; expired permit after ambiguous response cannot cause a new key.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: two_permits_cannot_invoke_the_gateway_twice
await Promise.all([
  dispatchPayment(firstRequest, deps),
  dispatchPayment(secondRequest, deps),
]);
expect(gateway.create).toHaveBeenCalledTimes(1);
expect(timedOut.kind).toBe("observe");
expect(beforeDispatch.code).toBe("PAYMENT_NOT_SUBMITTED");
```

- [ ] **Step 2 — Run** `JEST src/Modules/Checkout/Tests/Features/Payments/dispatch-payment.test.ts` and the existing checkout API/permit suites; the duplicate-permit test must fail against the old code before repair.
- [ ] **Step 3 — Implement:** authorize current owner/access and validate required contact/address/quote outside locks; recheck immutable bindings, order/hold/controls and atomically claim dispatch. Commit, call the gateway with bounded identical-request SDK retries, then persist outcome. Followers only observe. A legacy key conflict observes the existing attempt rather than creating another. Unknown SDK errors and expired leases are inquiry cases; a positive no-charge claim requires proven pre-dispatch state.
- [ ] **Step 4 — Green:** rerun new/existing suites; add a barrier between durable claim and external invocation, then crash/reload and prove zero second invocations. Keep accepted processing JSON/status URL compatible for old browsers and preserve all payment methods.
- [ ] **Step 5 — Commit:** `fix: guard payment dispatch across permits and retries`.

## Task 6: Preserve provider payment/refund facts and durably accept webhooks

**Depends:** 3–5. **Files:** Payments `payment-facts.ts`, `projection-repository.ts`, matching `payment-facts.test.ts`, `financial-projection.postgres.test.mjs`; extend `webhook-inbox.ts`; migration `20261127043000_checkout_financial_facts.sql`. Modify `src/app/api/webhooks/square/route.ts`, `src/lib/square/{payment-event,payment-reconciliation,payment-details}.ts`, signed-webhook tests and generated types.

**Interfaces:** `VerifiedFinancialFact = {kind:'payment'|'refund';providerId:string;paymentId:string;orderId:string;providerVersion:string;status:string;amountCents:number;currency:'USD';expectedTotalCents:number;fulfillmentStatus:string}`. Produce `applyFinancialFact(fact): Promise<FinancialSnapshot>` and `projectOrderFinancialState(facts): FinancialSnapshot`. `FinancialSnapshot={orderId:string;revision:string;financialState:'unpaid'|'paid'|'partially_refunded'|'refunded';capturedCents:number;refundedCents:number;fulfillmentStatus:string;reviewReason:string|null}`. Only verified normalized facts cross this seam; the expected total is read from the immutable server quote, not accepted from webhook/client input.

- [ ] **Step 1 — Red:** real SQL sequences paid→refund→old completed event, shipped→completed repeat, partial refund duplicates and distinct refunds in reverse delivery order. Assert captured/refunded amounts unchanged by replay, refunded remains refunded, fulfillment survives and exactly one notification per durable kind is queued. Invalid amount/currency/order/location cannot authorize fulfillment. Run the DB test to reproduce the assessment's regression.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: refund_history_survives_old_completed_payment_event
const projected = projectOrderFinancialState(reorderedFacts);
expect(projected.financialState).toBe("refunded");
expect(projected.refundedCents).toBe(1000);
expect(projected.fulfillmentStatus).toBe("shipped");
```

- [ ] **Step 2 — Implement facts and projection:** unique object/version facts, deterministic refund totals, terminal preservation and independent review reason; update the legacy order projection without manufacturing tax from arbitrary excess payment. Provider version tokens are opaque equality/deduplication identifiers, not lexicographically ordered revisions; refresh provider facts when precedence cannot be proved. Route repeated reserve consumption through these invariants. Keep disputes and existing shipping-contact synchronization working, queued through durable obligations when deferred.
- [ ] **Step 3 — Implement signed durable receipt:** verify raw-body signature, merchant/location and bounded shape; persist inbox+work before 2xx. Duplicate returns success without another effect. Storage failure returns retryable failure; unknown event kinds are explicitly ignored without unbounded storage. Provider refresh uses persisted work rather than webhook delivery order; preserve necessary normalized fields without source credentials.
- [ ] **Step 4 — Green:** DB test plus new facts and existing Square event/webhook/refund tests. Assert durable receipt survives worker failure, replay after crash is idempotent, and malformed or oversized events neither acknowledge lost work nor reveal secrets. Regenerate types.
- [ ] **Step 5 — Commit:** `fix: preserve financial facts across webhook replay and reordering`.

## Task 7: Idempotent preparation, guest proof and transactional item conflicts

**Depends:** 3–6. **Files:** Preparation source table above; tests `guest-context.test.ts`, `reservation-contract.test.ts`, `reservation-races.postgres.test.mjs`; migration `20261127044000_checkout_reservations.sql`. Modify `src/lib/checkout/{checkout-quote,prepare-checkout,prepare-checkout-dependencies}.ts`, `src/repositories/checkout-reservation-repo.ts`, quote/prepare tests, generated types.

**Interfaces:** `InventoryConflict = {productId:string;variantId:string;requestedQuantity:number;availableQuantity:number;reason:'reserved_by_other'|'sold_out'|'unavailable'}`. `ReservationDecision = {kind:'reserved';orderId:string;expiresAt:string;reused:boolean}|{kind:'conflict';conflicts:InventoryConflict[]}`. Produce `reserveCheckout(input: ReserveCheckoutInput & {ownerBinding:string}): Promise<ReservationDecision>`, `readOrIssueGuestContext(request): {contextHash:string;setCookie?:string}` and `verifyGuestPreparationReuse(order, contextHash): boolean`.

- [ ] **Step 1 — Red:** stock-one requests, same-key matching/differing carts, different principals, reversed overlapping baskets and expired attempts. Assert one winner/no negative stock, full basket rollback, matching owned key resumes one order, losing stock response identifies exact requested IDs and reserves no replacement basket. A lost guest prepare reply can resume from its original signed cookie but a different cookie cannot mint the order token. Run DB and guest context suites; old generic503/reuse behavior must fail these assertions.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: stock_one_loser_gets_its_exact_conflict_without_partial_allocation
expect(response.status).toBe(409);
expect(body).toMatchObject({
  code: "INVENTORY_CONFLICT",
  paymentState: "not_submitted",
  conflicts: [{ productId, variantId, availableQuantity: 0 }],
});
assert.equal(committedReservations, 1);
assert.equal(remainingStock, 0);
```

- [ ] **Step 2 — Implement signed guest context in quote response:** Secure/HttpOnly/SameSite cookie, keyed stored binding, stable context for issued attempts. Existing secure order tokens still authorize new-browser tracking; raw key/device/email alone cannot mint credentials. Legacy unbound orders require existing valid access or explicit recovery, never infer ownership from a known key.
- [ ] **Step 3 — Implement authoritative reservation transaction:** create service-only `reserve_checkout_inventory_v2(p_request jsonb)` with strict versioned request validation. Resolve order idempotency before allocation; lock order/attempt then products/variants/reservations in sorted IDs; validate all items, ordinary product eligibility and current price/quote; all-or-nothing allocation with 15-minute expiry. Raise a validated structured SQL conflict detail to roll back inserted order/stock, and translate it to typed conflicts; never infer the loser through a post-failure unlocked query. Preserve the existing overloaded RPC contracts through compatibility wrappers; do not edit historical SQL.
- [ ] **Step 4 — Green:** DB race suite and existing preparation/quote tests. Exact HTTP response is 409 with `code:'INVENTORY_CONFLICT'`, `conflicts` and `paymentState:'not_submitted'` only when no dispatch occurred. Technical faults remain retryable technical failures. Preserve quantity<=5, <=10 checkout lines, original hash/address readers and no-store.
- [ ] **Step 5 — Commit:** `fix: return owned idempotent checkout and transactional stock conflicts`.

## Task 8: Cart owner, revision, storage and session correctness

**Depends:** 1; integrate before Tasks 9–11. **Files:** Port ManageBasket `CartProvider.tsx`, `cart-storage.ts`, `decode-saved-basket.ts`, `use-basket-identity.ts`, neutral `src/Modules/Cart/Source/Contracts/Basket.ts`, `Source/Client.ts`; test `basket-state.browser.mjs`. Adapt `src/components/cart/CartProvider.tsx`, `src/services/cart-service.ts`, `src/contexts/SessionContext.tsx`, `src/components/auth/login/{PasswordLoginForm,OtpLoginForm}.tsx`, logout callers and product-add feedback only where required by the caller inventory.

**Interfaces:** Existing useCart operations remain available; mutation results become `Promise<{status:'saved'}|{status:'unavailable'|'stale'}>` where callers need persisted-success feedback. `BasketAccess = 'checking'|'ready'|'denied'|'unavailable'`; current session observation distinguishes confirmed account/guest from failed lookup. UI never writes another observation's storage.

- [ ] **Step 1 — Red browser regressions:** delay validation, remove line, then fulfill old response: line remains absent. Switch guest→account before old fulfillment: account contents remain unchanged. In another tab clear/edit account storage: rendered state updates. Queue a write behind a lock and change account: old write rejects. Assert denied/quota/malformed/null/mixed saved rows preserve recoverable data and do not emit successful-add measurement. Run BROWSER on the receiving branch before porting and record failures.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: delayed_guest_validation_cannot_overwrite_account_after_login
await heldGuestResponse.fulfill({ json: { items: guestItems } });
await expect.poll(() => page.evaluate(() => window.testCart.items)).toEqual(accountItems);
expect(accountSavedBytesAfter).toBe(accountSavedBytesBefore);
```

- [ ] **Step 2 — Port reviewed behavior plus its complete tests:** use immutable storage connection/generation, serialized Web Locks, revision+bytes checks, storage events and runtime salvage. Keep legacy key formats; reads do not rewrite damaged arrays. Adapt existing identity observer rather than pulling the broader Identity module. Bootstrap user is not an enduring override of current session state.
- [ ] **Step 3 — Update actual auth/product callers:** successful password/OTP/login/logout publishes a verified observation; 503/malformed session is unavailable, not guest. Failed logout remains visible. Await persisted add result for success UI/measurement. Retain standard guest/account separation and useful retry when required storage/lock access is unavailable.
- [ ] **Step 4 — Green:** BROWSER `src/Modules/Cart/Tests/Features/ManageBasket/basket-state.browser.mjs`, focused session/auth/product tests and TypeScript. Include same-bytes edit/revert and native event-delivery delay; prove empty and nonempty cross-tab outcomes. No checkout financial behavior is changed by a storage access failure.
- [ ] **Step 5 — Commit:** `fix: preserve cart ownership and edits across async work and tabs`, with donor/adaptation manifest update.

## Task 9: Original-unit capture and idempotent purchase consumption

**Depends:** 8. **Files:** Port ManageBasket `purchase-capture.ts` plus its reviewed private lineage/journal helpers and neutral public types; tests `purchase-capture.browser.mjs`, `purchase-capture.test.ts`. Update Cart storage/Client exports and port manifest.

**Interfaces:** `captureForCheckout({attemptKey,mode:'new'|'resume',expectedItems}): Promise<{status:'captured';captureId:string;items:readonly PurchaseLine[]}|ProofFailure>`; `bindPreparedOrder(captureId:string,orderId:string): Promise<boolean>`; `consumeConfirmedPurchase(orderId:string,purchased:readonly PurchaseLine[]): Promise<{status:'matched';attemptKey:string}|ProofFailure>`. `PurchaseLine={productId:string;variantId:string;quantity:number}`; `ProofFailure.status='missing'|'stale'|'corrupt'|'mismatch'|'unavailable'`.

- [ ] **Step 1 — Red:** capture/bind one unit; add a later unit of the same SKU; confirmed consume leaves exactly the later unit. Remove/readd identical SKU before receipt: replacement survives. Two tabs consume one bound purchase: subtraction once. Cancel/change observation while lock is queued: no capture/bind/consume side effect. Missing/corrupt proof never authorizes clearing.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: confirmed_purchase_preserves_later_and_readded_units
expect(consumption.status).toBe("matched");
expect(laterSameSkuUnits).toEqual(originalLaterUnits);
expect(readdedIncarnation).toEqual(beforeReceiptIncarnation);
expect(secondConsumptionChangedBytes).toBe(false);
```

- [ ] **Step 2 — Run** new pure/browser tests; require failure before donor adoption, including explicit lock barriers and interrupted journal writes.
- [ ] **Step 3 — Port the reviewed algorithm, not quantity subtraction:** preserve `_cartUnits` incarnation/ranges/high-water marks, bounded bigint proof parsing, new/resume distinction, committed journals and final owner/render/persisted-view checks. Keep its limits: 64 decimal digits/offset, 4,096 ranges/line, 1,024 capture/projection lines and 2,097,152 serialized association characters. Checkout never accesses this private state directly.
- [ ] **Step 4 — Green:** pure Jest and BROWSER files. Include range arithmetic beyond MAX_SAFE_INTEGER offsets with safe public quantities, legacy initialization, evicted proof, failed write rollback, same-layout active handoff and canceled queued operations. Check proof/private fields never enter validation or analytics payloads.
- [ ] **Step 5 — Commit:** `fix: consume only original order-bound cart units`.

## Task 10: Retained unavailable rows and truthful stock-loss UI

**Depends:** 7–9. **Files:** ValidateBasket `validation-contract.ts`, `request-validation.ts`, `reconcile-validation.ts`; tests `validation-contract.test.ts`, `availability.browser.mjs`, `cart-validate-route.test.ts`; modify `src/app/api/cart/validate/route.ts`, `src/lib/validation/cart.ts`, current cart page/drawer and `src/components/checkout/CheckoutOrderSummary.tsx`, affected Cart contracts/provider and CheckoutClient conflict handling.

**Interfaces:** `CartValidationV2={contractVersion:2;items:CartItem[];removed:LegacyRemoval[];lineState:LineState[]}`. `LineState` uses Task 7's IDs/quantities/reason plus availability `'available'|'reserved_by_other'|'sold_out'|'unavailable'` and canonical facts when readable. `reconcileValidation(snapshot,response): {kind:'apply';items:BasketLine[]}|{kind:'ignore';reason:string}`; BasketLine retains requested quantity, validation status and eligibility independently from payment total.

- [ ] **Step 1 — Red:** last pair held elsewhere returns row/product/size and exact copy `Someone else just reserved the last pair of [product], size [size]. You haven't been charged.` A generic unavailable line uses generic copy. It stays visible, is excluded from total/capture, and Remove/Recheck work. Price/clamp changes require review. A mixed basket is not automatically charged after one loses stock. Run Jest and BROWSER before repair.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: losing_last_pair_remains_identifiable_and_is_not_payable
await expect(
  page.getByText(
    "Someone else just reserved the last pair of Air Runner, size 10. You haven\'t been charged.",
  ),
).toBeVisible();
expect(eligibleCapturedVariantIds).not.toContain(unavailableVariantId);
expect(otherLineAfter).toEqual(otherLineBefore);
expect(noChargeCopyForUnknownPayment).toBe(false);
```

- [ ] **Step 2 — Implement additive response and guarded reconciliation:** retain legacy available-items/removed behavior for old clients. V2 must contain exactly one valid state per requested pair; missing, duplicates, foreign pairs and malformed money do not overwrite storage. Legacy-only responses preserve row identity with conservative availability. Persist unavailable rows compatibly and revalidate on recheck/focus without resurrecting superseded snapshots.
- [ ] **Step 3 — Handle own hold:** optional scoped order reference/access reaches the validator; authorize it server-side before adding its active held quantity. An unrelated order ID cannot make a line available. Test stock0 with own active hold, another customer's hold, expired hold and unknown payment. Bound original units survive validation during unresolved financial recovery.
- [ ] **Step 4 — Green:** route/Jest/browser suites and cart/header/summary regressions. Assert submitted/unknown financial attempt never receives the no-charge copy; display pending recovery instead. Review buttons, visible item identity, keyboard status announcements and unchanged other items.
- [ ] **Step 5 — Commit:** `fix: retain unavailable cart items with clear stock conflict feedback`.

## Task 11: One verified outcome observer and conditional receipt housekeeping

**Depends:** 5–6 and 9–10. **Files:** Outcomes source files in map, tests `outcome-observer.test.ts`, `checkout-outcome.browser.mjs`; Orders OrderStatus `purchased-lines.ts`, `purchased-lines.test.ts`. Modify current processing/success/cancel pages, `src/components/checkout/{CheckoutClient,SquarePaymentMethods,CheckoutPaymentDialog}.tsx`, `src/app/api/orders/[orderId]/route.ts`, OrdersService/status types and existing browser runner entry points. Coordinate shared UI edits with UX owner.

**Interfaces:** `observeCheckoutOutcome({orderId,credential,identityGeneration,signal,onState}): ()=>void`; states `waiting|delayed|denied|error|review|confirmed|refunded`, with authorized validated facts. `readPurchasedLines({orderId,authorizedAccess},deps): Promise<readonly PurchaseLine[]|null>` returns null for incomplete/malformed/prohibited evidence. Uses Task 9's three methods and Task 5's stable attempt/status recovery; it cannot clear all shopping state.

- [ ] **Step 1 — Red:** navigate to fake/denied receipt: zero clear and zero success assertion. Send pay UNKNOWN/lost response then verify pending: GET-only recovery and retained basket. Fast-forward 60 seconds: delayed state plus Check order status, not an endless spinner. Malformed/truncated purchased projection: financial receipt allowed if independently valid, zero guessed subtraction. Switch credential/account after verified GET but before navigation: old facts cannot appear in the new context.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: invalid_receipt_and_deadline_never_clear_or_assert_paid
expect(clearAllCalls).toBe(0);
expect(purchaseConsumptionsForDeniedOrder).toBe(0);
expect(stateAfter60000ms).toBe("delayed");
expect(newPayPostsAfterStatusRetry).toBe(0);
```

- [ ] **Step 2 — Run** new observer/Jest/BROWSER and existing `tests/browser/{checkout-progress,checkout-success}.mjs`; record failing state assertions before port.
- [ ] **Step 3 — Port reviewed attempt journaling, scoped guest credential and outcome behavior:** capture before prepare, publish/reuse issued key, bind returned order before permit, enter observation after any possibly submitted payment, preserve same-layout single-use verified handoff. One observer uses immediate read, short early retry, increasing <=5-second jittered intervals with no overlap and a 60-second wall-clock/body-read deadline. GET status reuses background recovery instead of unbounded provider fan-out.
- [ ] **Step 4 — Implement authorized item read and consumption:** validate IDs, row count, unique pairs and positive quantities after order access. Only settled/shipped compatible outcomes with complete facts may consume original proof. Missing proof preserves cart. Clear only the originating financial pair after a still-matching observation/receipt; keep newer credentials, device ID and unrelated address/cart state. Rerun all new/old browser cases including all four actual payment paths and persistent spinner identity.
- [ ] **Step 5 — Commit:** `fix: bind receipts and cart housekeeping to verified order outcomes`.

## Task 12: Fair background reconciliation, safe expiry and notification drain

**Depends:** 3–7. **Files:** Recovery `recovery-worker.ts`, `expiry-operation.ts`, `notification-drain.ts`; tests `recovery-worker.test.ts`, `expiry-races.postgres.test.mjs`, `recovery-fairness.postgres.test.mjs`. Adapt existing expire/notification cron routes, notification scheduler/worker/dependencies, Square reconciliation adapter and `vercel.json`.

**Interfaces:** `runCheckoutRecovery({deadlineMs:45000,batchSize:50,concurrency:4},deps): Promise<{claimed:number;done:number;retry:number;review:number;oldestDueMs:number}>`; `expireCheckout(orderId,deps): Promise<'released'|'reconcile'|'review'|'unchanged'>`; `drainNotifications({deadlineMs:45000,batchSize:50,concurrency:4},deps): Promise<{sent:number;failed:number;remaining:number}>`. Claim/finish/dependency leases come from Task 3; financial application comes from Task 6. Workers never create a fresh payment.

- [ ] **Step 1 — Red:** close browser and suppress webhook after gateway acceptance; worker settles the existing attempt. Fill first50 jobs with retryable errors and place a valid due job afterward; it is serviced without premature stock release. Expire/consume concurrently and repeatedly: one authoritative outcome, conserved stock. Redis outage and overlapping workers still obey global4 limit. SMTP outage preserves independent confirmation/pickup jobs and audit state. Run unit/DB barrier suites before replacement.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: poison_batch_and_closed_browser_do_not_block_durable_recovery
expect(completedJobIds).toContain(validJobAfterFirst50);
expect(peakExternalCallsAcrossWorkers).toBeLessThanOrEqual(4);
expect(newGatewayCreateCallsDuringInquiry).toBe(0);
assert.equal(restoredStockAcrossRepeatedRelease, 1);
```

- [ ] **Step 2 — Implement durable worker loop:** lease due jobs fairly, commit before network, enforce global dependency leases, 10-second request deadlines, 45-second budget, 120-second claims, jittered 5-second→5-minute retries and persisted review/escalation. Sweep legacy pending/expired/unprocessed work without resetting old outcomes. Failed jobs cannot block every batch; stale workers cannot complete reclaimed work.
- [ ] **Step 3 — Implement expiry as mark/inquire/cancel/recheck:** block new dispatch under order lock; never infer nonpayment from TTL, absent ID or empty inquiry. Release only with cancellation/no-accepted-payment proof and final locked recheck. Keep ambiguous stock protected with recovery/review. Preserve settlement/refund facts for late payment. Notification prompt remains an optimization; repeated bounded claims replace the three-job bottleneck and ambiguous SMTP handoff remains explicit.
- [ ] **Step 4 — Green:** new/existing worker/expiry tests plus real pay-versus-expire, duplicate consume/release, poisoned batch and crash/reclaim barriers. Configure proposed one-minute crons only after platform support is recorded; unsupported hosting is a readiness gate. Verify actual scheduler cadence later in Task 16, not by reading vercel.json alone.
- [ ] **Step 5 — Commit:** `fix: recover checkout and notification work without an open browser`.

## Task 13: Shopper-scoped admission and independent operational switches

**Depends:** 5, 7, 12. **Files:** Operations `admission.ts`, `checkout-controls.ts`; tests `admission.test.ts`, `checkout-controls.postgres.test.mjs`; migration `20261127045000_checkout_operations.sql` for service-only operational controls. Modify `src/lib/checkout/{checkout-attempt-limit,checkout-access,payment-api-dependencies,prepare-checkout-dependencies}.ts`, `src/proxy/rate-limit.ts`, the settings read adapter, validated runtime configuration and generated database types. Do not grant customer settings writes.

**Interfaces:** `admitCheckout({kind:'new_prepare'|'resume'|'gateway_attempt'|'decline',shopperBinding,orderId?,ip},deps): Promise<{allowed:boolean;retryAfterSeconds:number|null}>`; `readCheckoutControls(): Promise<{pauseNewCheckouts:boolean;pausePaymentDispatch:boolean}>`. Counters are atomic/distributed; switches are independent of status/webhook/worker authorization.

- [ ] **Step 1 — Red:** 20 legitimate shopper contexts sharing an IP can complete the designated normal scenario; one shopper's sixth new key inside10min is limited; same-key resume/status does not spend a new allowance; fourth gateway attempt/order/30min and sixth confirmed decline/shopper/hour are rejected. Redis failure before dispatch is safe, while Task 12 recovery still inquires. Test both switches during an in-flight attempt and assert signed webhook/status/recovery continue.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: shared_ip_is_not_a_three_customer_ceiling
expect(sharedIpShopperResults.every((result) => result.allowed)).toBe(true);
expect(sixthNewKeyWithin10Minutes.allowed).toBe(false);
expect(fourthGatewayAttemptWithin30Minutes.allowed).toBe(false);
expect(existingOrderRecoveryDuringPause).toBe("allowed");
```

- [ ] **Step 2 — Run** new and existing limiter/access tests, then the real switch/attempt transaction test; old shared-IP3/30-minute policy must fail the designated test.
- [ ] **Step 3 — Implement approved initial budgets:** five new keys/shopper/10min, three gateway attempts/order/30min and five confirmed declines/shopper/hour. Bind guest shopper to server context, account shopper to verified ID. Require explicit versioned coarse-IP/global/provider budgets calibrated by the load project; no unconfigured infinite limit or silent security bypass. Pause new checkouts allows existing safe completion; pause dispatch prevents new gateway calls and yields truthful pre-dispatch response.
- [ ] **Step 4 — Green:** run all tests with different keys, periods, clock boundaries, shared networks and already-issued permits. Real admission uses unchanged CSRF/BotID/Turnstile/WAF gates; synthetic load bypass cannot establish real-perimeter acceptance.
- [ ] **Step 5 — Commit:** `fix: admit legitimate shoppers with bounded checkout controls`.

## Task 14: Credential-safe lifecycle logs, queue health and alerts

**Depends:** 5–6, 12–13. **Files:** Operations `lifecycle-event.ts`, `health-snapshot.ts`; tests `lifecycle-event.test.ts`, `health-snapshot.test.ts`; modify `src/lib/utils/log.ts`, order-status/proxy/error logging call sites, notification/recovery metrics and existing necessary operational health output. Record alert responder/runbook in `docs/operations/checkout-hardening-runbook.md`.

**Interfaces:** `sanitizeLifecycleEvent(input: unknown): SafeLifecycleEvent` allowlists event/route/status/duration/safe references; `readCheckoutHealth(deps): Promise<{oldestUnknownMs:number;oldestDueMs:number;expiredHoldLagMs:number;oldestNotificationMs:number;workerLastSeenAt:string|null;reviewCount:number}>`. Customer/order references stay out of metric label cardinality; credentials and raw PII stay out of every emitted value.

- [ ] **Step 1 — Red:** include synthetic secrets in URL query, nested object/array, Error message/stack, cookies, permit, sourceId and provider body; intercept actual logger output and assert none appear. Assert safe route template/request/order/release correlation remains. Missing heartbeat/old unknown/poison queue produces a degraded health result, not healthy readiness.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: synthetic_credentials_cannot_escape_nested_url_or_error_logging
const safe = sanitizeLifecycleEvent(credentialBearingInput);
expect(JSON.stringify(safe)).not.toContain("SYNTHETIC_SECRET");
expect(safe.route).toBe("/api/orders/:orderId");
expect(missingHeartbeatHealth.workerLastSeenAt).toBeNull();
```

- [ ] **Step 2 — Run** the two new suites and existing logging/measurement/proxy tests. The assessment's token-in-URL example must fail against the original sanitizer.
- [ ] **Step 3 — Implement allowlisted safe events and operational counters:** p95/p99/errors/admission, attempted gateway calls/order, unknown age, hold expiry lag, queue depth/age, leases, webhook lag, notification backlog, heartbeat and DB pressure. Optional analytics still honors consent; no server operational event becomes preconsent optional tracking. Keep raw provider credentials out of SDK debug logs.
- [ ] **Step 4 — Green:** negative-secret tests, metric cardinality/health tests and a deliberate alert drill with a synthetic blocked job. Record named on-call responsibility before release. Historical exposure inspection/retention decisions remain protected work; do not delete logs or rotate all credentials automatically.
- [ ] **Step 5 — Commit:** `fix: expose checkout recovery health without leaking credentials`.

## Task 15: Integrated legacy/browser/database gates in CI

**Depends:** 2–14. **Files:** Create `tests/database/checkout-hardening-acceptance.test.mjs`, `tests/browser/checkout-hardening.mjs`; modify `.github/workflows/ci.yml`, package scripts and receiving-branch regression entry points. Extend port manifest with final adopted donor behavior and excluded dependencies. Coordinate simultaneous edits to workflows/types/shared UI.

**Interfaces:** Add `npm run test:checkout:db` → the Task1 runner for real role/attempt/fact/reservation/recovery tests, and `npm run test:checkout:browser` → receiving feature browser suites plus existing checkout/payment/shipping suites. Neither command is permitted to silently skip an absent database/browser.

- [ ] **Step 1 — Red CI detection tests:** intentionally violate one stock/attempt/role invariant and one browser state expectation; commands must exit nonzero with a named failed gate. Test an old-browser request, legacy permit plus newly issued permit on the same order, and staged grant restriction with new staff adapters. Assert one dispatch and working authorized staff flows.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case: ci_rejects_a_deliberately_broken_business_invariant
assert.notEqual(brokenInvariantRun.status, 0);
assert.match(brokenInvariantRun.stderr, /duplicate.*capture|stock.*negative/i);
assert.equal(legacyAndNewPermitGatewayCalls, 1);
```

- [ ] **Step 2 — Integrate the real matrix:** fresh full replay and populated preservation; independent transaction barriers for all financial races; original-unit/browser observation barriers; callback/shipping address and payment-method continuation tests. Include ordinary fabricated specialty-cart rejection when the separately approved feature is integrated; do not implement its claims here. Map every BF-A01–BF-A13 row to an executable test or explicit external dependency gate.
- [ ] **Step 3 — Wire CI:** isolated Supabase/Postgres fixture and explicit browser runtime, no production secrets. Run new DB/browser commands in addition to existing unit/integration/typecheck/lint/format/build checks. Keep raw reports private/run-scoped; commit scrubbed summaries and hashes only.
- [ ] **Step 4 — Green:** `npm run test:jest`, `npm run test:checkout:db`, `npm run test:checkout:browser`, `npm run test:measurement:browser`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `doppler run --project solesneakers --config stg_ci -- node node_modules/next/dist/bin/next build` after verifying that configuration's staging identity. Missing configuration is an unrun gate, never a reason to use a default or production target. Record counts, SHA/schema and expected warnings. Re-run only affected checks after new changes; a unit mock never replaces the DB/browser gate.
- [ ] **Step 5 — Commit:** `test: gate checkout safety on integrated database and browser behavior`.

## Task 16: Bounded provider and coordinated hosted-load acceptance

**Depends:** 15 plus approved load deployment/setup. **Files:** Create `scripts/verify-checkout-hardening-sandbox.mjs`, `tests/database/checkout-hardening-invariants.mjs`, `docs/operations/checkout-hardening-evidence.schema.json`, `docs/operations/checkout-hardening-acceptance.md`; tests `tests/database/checkout-hardening-invariants.test.mjs`, `scripts/audits/checkout-hardening-evidence.test.mjs`. Consume, do not modify privately, the load orchestrator's versioned run summary.

**Interfaces:** Read-only `assertCheckoutInvariants({runId,sourceSha,migrationHash},db): Promise<{violations:InvariantViolation[]}>`; evidence schema requires candidate/deployed SHA, migration hashes, provider mode, actual scheduler cadence, role checks, test totals, numeric budgets/achieved load, source report path/hash and each gate's `passed|failed|unrun` with reason. Sandbox runner refuses production Square/location/database identities and uses only owned synthetic fixtures/approved inboxes.

- [ ] **Step 1 — Red evidence tests:** mismatched candidate SHA, simulated provider labeled live, missing device, unrun recovery, absent exact migration chain, unexpected third-party traffic or missing metrics must prevent a readiness pass. Read-only invariant checker detects a deliberately seeded duplicate capture, negative stock, orphan accepted payment and unrelated cart-consumption loss without mutating them.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case:_missing_or_simulated_evidence_cannot_pass_as_live_readiness
assert.equal(result.ready, false);
assert.ok(result.unmet.includes("provider_matrix"));
assert.ok(result.unmet.includes("candidate_mismatch"));
assert.ok(result.unmet.includes("native_wallet_unrun"));
```

- [ ] **Step 2 — Implement bounded Sandbox matrix:** real supported methods for shipping/pickup, known decline, pending/approved/completed, response loss, same-key payload mismatch, cancel-order versus in-flight pay, late settlement and signed replay/reordering. Keep bulk emails/payments in the separate controlled sink mode; native wallet/device absence is unrun. Exact credentials remain secret. These checks require explicitly selected staging/Sandbox targets.
- [ ] **Step 3 — Coordinate the hybrid load run:** use its existing one-command setup/orchestrator and real schema/business path; pin the repaired candidate, actual provider/perimeter mode, resources and budgets. Require achieved10k ordinary shoppers, prescribed hold/spike/soak, shared-NAT and failure/recovery evidence; specialty1k is separate feature evidence if that feature is shipping. Never let the load harness silently tune application limits/worker cadence to pass.
- [ ] **Step 4 — Accept only evidence:** catalog/cart/polling p95<1s p99<2s; simulated-provider checkout operations p95<3s p99<5s; <1% unexpected failures; >=99% eligible normal seeded checkout outcomes within30s; zero oversells/duplicate accepted captures/orders/claims/lost accepted payments/unrelated cart edits; no dropped offered work. Recovery and notification bounds are exactly those in the approved design/load manifest, measured with actual intervals. Missing or failed gates remain no-go; repair the affected task and rerun the pinned evidence.
- [ ] **Step 5 — Commit:** scrubbed acceptance/runbook/schema changes as `test: record pinned checkout provider and load acceptance gates`. Do not commit raw addresses, secrets, real customer data or generated bulk artifacts.

## Task 17: Release rehearsal, guarded cutover and recoverable rollback

**Depends:** 16; requires normal deployment approvals. **Files:** Complete `docs/operations/checkout-hardening-runbook.md`; create `scripts/check-checkout-release-evidence.mjs`, `scripts/audits/checkout-release-evidence.test.mjs`. Update affected staging/production workflow checks only through the existing release process; do not create tags or promote as part of this plan-writing task.

**Interfaces:** CLI `node scripts/check-checkout-release-evidence.mjs --manifest <scrubbed-file> --candidate <sha>` exits zero only when every required gate passed for the matching code/schema/provider configuration. Runbook names the release operator/on-call responder and records switches, permissions, alias/schema identity and rollback-compatible build.

- [ ] **Step 1 — Red release tests:** a green health endpoint, missing provider evidence, old candidate, unknown legacy financial obligation, unsupported cron cadence or rollback to the original unsafe dispatcher cannot satisfy the manifest. Require nonzero exit and named missing gate.
      Core assertions for the named case (arrange fixtures from Step 1):

```typescript
// case:_release_check_refuses_a_green_probe_without_matching_safety_evidence
assert.notEqual(healthOnlyManifestRun.status, 0);
assert.notEqual(oldCandidateManifestRun.status, 0);
assert.notEqual(unsafeRollbackManifestRun.status, 0);
assert.equal(completeMatchingManifestRun.status, 0);
```

- [ ] **Step 2 — Rehearse with isolated/populated staging:** expand compatible schemas; pause new allocations; identify/drain/reconcile old dispatches using facts rather than sleep; deploy guarded server/staff/receiver/worker adapters; tighten grants; verify old browser/permit behavior. Keep durable webhook receipt and inquiry alive, or return retryable receipt failure if persistence cannot be guaranteed. Enqueue legacy pending work conservatively, leaving ambiguous stock protected with explicit review ownership.
- [ ] **Step 3 — Rehearse rollback/fault:** pause dispatch/new allocations, interrupt deployment/worker, restore only a guard-aware compatible application, and prove financial/inbox/outbox continuity and privileged-write denial. Never restore broad customer grants or erase attempts/jobs to make readiness green. Resume only after each unresolved obligation has a verified result or documented protected review.
- [ ] **Step 4 — Verify** the evidence-checker unit command and CLI, actual staging alias/commit/migrations/grants/cadence, fresh paid/declined/stock-conflict/receipt journeys and kill-switch/alert drill. Preserve PR staging and production tag gates; promotion/opening-time decisions remain the store owner's. A later material source/configuration change invalidates affected evidence and requires rerun.
- [ ] **Step 5 — Commit:** `docs: rehearse guarded checkout release and rollback`; hand over a scope-specific go/no-go with exact failed/unrun gates. Do not call BF readiness complete if resource, provider, device, migration or capacity evidence is missing.

## Self-review and implementation handoff

Coverage: BF-A01→2/15; A02→4/5/12/16; A03→6/12; A04–A06→8/9/10; A07–A08→9/11; A09→7/10; A10→13/16; A11→14; A12→3/12/14/16; A13→7/10/15/16 and the separate specialty plan. All five Review Focus classes have explicit receiving-task assertions. Dependency interfaces above are authoritative; adapters may preserve old names but must not introduce a competing second financial/cart implementation.

Before starting, read this plan and the approved spec, create an isolated workspace, choose one implementation owner for each shared adapter/migration/type file, and record the selected execution method. Native execution uses executing-plans; subagent-driven execution uses subagent-driven-development with task-level independent reviews and a final whole-branch review. Review every task's source, tests and actual evidence before building on it. Task commits should name only owned paths and retain concurrent independent work.

This plan creates no production readiness, payment/provider success or capacity claim by itself. It specifies the work and evidence needed to make those claims.
