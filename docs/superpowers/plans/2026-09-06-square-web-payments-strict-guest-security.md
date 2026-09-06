# Square Web Payments Strict Guest Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hosted Square Payment Links with a guest-capable embedded Square Web Payments flow protected by BotID Deep Analysis, server-validated Turnstile, one-use permits, layered limits, and webhook-authoritative settlement.

**Architecture:** Separate checkout preparation from payment authorization. Preparation validates and reserves the server-priced cart and creates an attached Square Order; permit issuance applies the strict guest controls; payment atomically consumes the permit before calling Square. Browser status remains informational while existing signed webhooks and reconciliation own paid state, fulfillment, and the custom receipt.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Square Node SDK 45/Web Payments SDK v1, Vercel BotID 1.5, Cloudflare Turnstile Siteverify, Upstash Redis, Supabase/PostgreSQL, Jest 30.

**Spec:** `docs/superpowers/specs/2026-09-06-square-web-payments-strict-guest-security-design.md`

## Global Constraints

- Guest checkout remains available.
- Raw PAN and CVV never enter Sole Sneakers code, requests, logs, analytics, or storage.
- Every payment attempt requires BotID Deep Analysis; guest permits also require server-validated Turnstile.
- Payment permits are opaque, single-use, exact-order/exact-amount/exact-method credentials with a two-minute TTL.
- Square webhooks or authoritative reconciliation—not browser state—authorize paid state, inventory consumption, receipts, and fulfillment.
- Card and Afterpay/Clearpay ship in the embedded release; existing available wallets must not silently regress.
- No new runtime dependency is added for Turnstile or permit signing/storage.

---

### Task 1: Strict Browser Verification and Payment Permits

**Files:**

- Modify: `src/config/env.ts`
- Modify: `src/config/client-env.ts`
- Modify: `src/config/security.ts`
- Modify: `src/lib/security/checkout-bot.ts`
- Create: `src/lib/security/turnstile.ts`
- Create: `src/lib/checkout/payment-permit.ts`
- Test: `tests/unit/checkout-bot.test.ts`
- Create: `tests/unit/turnstile.test.ts`
- Create: `tests/unit/payment-permit.test.ts`
- Modify: `tests/unit/security-headers.test.ts`

**Interfaces:**

- Produces: `verifyCheckoutBrowser(): Promise<CheckoutBotVerdict>` using `deepAnalysis`.
- Produces: `verifyTurnstile(input: TurnstileVerificationInput): Promise<TurnstileVerdict>`.
- Produces: `PaymentPermitStore.issue(input): Promise<{ token: string; expiresAt: string }>` and `PaymentPermitStore.consume(input): Promise<PaymentPermitPayload | null>`.

- [ ] **Step 1: Write failing tests for Deep BotID, Turnstile, one-use permits, and CSP**

```typescript
it("requests BotID Deep Analysis", async () => {
  mockCheckBotId.mockResolvedValue({ isBot: false } as never);
  await verifyCheckoutBrowser();
  expect(mockCheckBotId).toHaveBeenCalledWith({
    advancedOptions: { checkLevel: "deepAnalysis" },
  });
});

it("rejects a replayed payment permit", async () => {
  const store = new PaymentPermitStore(redis, () => new Date("2026-09-06T12:00:00Z"));
  const permit = await store.issue(payload);
  await expect(store.consume({ token: permit.token, ...binding })).resolves.toEqual(
    payload,
  );
  await expect(store.consume({ token: permit.token, ...binding })).resolves.toBeNull();
});

it("fails closed when Siteverify is unavailable", async () => {
  fetchMock.mockRejectedValue(new Error("network"));
  await expect(verifyTurnstile(input)).resolves.toEqual({
    allowed: false,
    reason: "unavailable",
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm run test:jest:unit -- --runInBand tests/unit/checkout-bot.test.ts tests/unit/turnstile.test.ts tests/unit/payment-permit.test.ts tests/unit/security-headers.test.ts`  
Expected: FAIL because Deep Analysis, Turnstile verification, permit storage, and Square/Turnstile CSP origins are absent.

- [ ] **Step 3: Implement the minimum trust-boundary primitives**

Add `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and `SQUARE_APPLICATION_ID` validation. Validate Siteverify with `fetch`, require `success`, expected hostname, and expected `action`, and never log its token. Store an opaque `randomUUID()` permit in Upstash using `SET NX EX 120`; consume it with one Lua `GET`/binding-check/`DEL` operation so mismatches and replays fail closed.

```typescript
export type PaymentPermitPayload = {
  tenantId: string;
  orderId: string;
  cartHash: string;
  totalCents: number;
  method: "card" | "afterpay" | "applePay" | "googlePay" | "cashAppPay";
  deviceSessionId: string;
  normalizedEmailHash: string;
  squareIdempotencyKey: string;
};
```

Update checkout CSP allowlists only with the exact Square Web Payments and Turnstile script, frame, image, and connection origins documented by those providers.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `npm run test:jest:unit -- --runInBand tests/unit/checkout-bot.test.ts tests/unit/turnstile.test.ts tests/unit/payment-permit.test.ts tests/unit/security-headers.test.ts`  
Expected: PASS with one-use permit behavior and fail-closed provider failures.

- [ ] **Step 5: Commit the trust-boundary primitives**

```powershell
git add src/config/env.ts src/config/client-env.ts src/config/security.ts src/lib/security/checkout-bot.ts src/lib/security/turnstile.ts src/lib/checkout/payment-permit.ts tests/unit/checkout-bot.test.ts tests/unit/turnstile.test.ts tests/unit/payment-permit.test.ts tests/unit/security-headers.test.ts
git commit -m "feat: add strict checkout payment permits"
```

### Task 2: Square Order and Direct Payment Gateways

**Files:**

- Create: `src/lib/square/checkout-orders.ts`
- Create: `src/lib/square/payments.ts`
- Modify: `src/lib/square/client.ts`
- Create: `tests/unit/square-checkout-orders.test.ts`
- Create: `tests/unit/square-payments.test.ts`
- Create: `supabase/migrations/20260906120000_square_web_payments_checkout.sql`
- Modify: `src/repositories/checkout-reservation-repo.ts`
- Modify: `tests/unit/checkout-reservation-repo.test.ts`
- Modify: `tests/integration/square-checkout-schema.test.ts`

**Interfaces:**

- Produces: `SquareCheckoutOrdersGateway.create(input): Promise<SquareCheckoutOrder>` and `cancel(orderId, version): Promise<void>`.
- Produces: `SquarePaymentsGateway.create(input): Promise<DirectPaymentResult>` and `get(paymentId): Promise<DirectPaymentResult>`.
- Produces: `CheckoutReservationRepository.attachSquareOrder(orderId, squareOrder): Promise<void>`.

- [ ] **Step 1: Write failing gateway and repository tests**

```typescript
it("creates a server-priced Square order with automatic taxes", async () => {
  await gateway.create(input);
  expect(orders.create).toHaveBeenCalledWith(
    expect.objectContaining({
      idempotencyKey: input.idempotencyKey,
      order: expect.objectContaining({
        referenceId: input.localOrderId,
        pricingOptions: { autoApplyTaxes: true, autoApplyDiscounts: false },
      }),
    }),
  );
});

it("creates a payment for the attached order without requesting a Square receipt", async () => {
  await gateway.create(input);
  expect(payments.create).toHaveBeenCalledWith(
    expect.objectContaining({
      sourceId: input.sourceId,
      orderId: input.squareOrderId,
      idempotencyKey: input.idempotencyKey,
      autocomplete: true,
    }),
  );
  expect(payments.create.mock.calls[0]?.[0]).not.toHaveProperty("buyerEmailAddress");
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm run test:jest:unit -- --runInBand tests/unit/square-checkout-orders.test.ts tests/unit/square-payments.test.ts tests/unit/checkout-reservation-repo.test.ts`  
Expected: FAIL because direct Square order/payment gateways and attachment RPC do not exist.

- [ ] **Step 3: Implement Square gateways and atomic order attachment**

Create the Square Order from validated local items, shipping fee, and `autoApplyTaxes`; reject missing/non-USD/unsafe totals. Create the payment only when the submitted amount equals the attached order amount. Do not set `buyerEmailAddress` or create a Square customer.

The migration adds `attach_square_checkout_order(p_order_id, p_square_order_id, p_square_order_version, p_shipping_cents, p_tax_cents, p_total_cents, p_tax_calculation_id)` as a service-role-only, fail-closed function. It updates only an unexpired pending reservation with no different attached Square order and returns `false` otherwise. Add `square_order_version integer` only if the current schema lacks an equivalent version column.

- [ ] **Step 4: Run unit and migration-contract tests and confirm GREEN**

Run: `npm run test:jest:unit -- --runInBand tests/unit/square-checkout-orders.test.ts tests/unit/square-payments.test.ts tests/unit/checkout-reservation-repo.test.ts`  
Run: `npm run test:jest:integration -- --runInBand tests/integration/square-checkout-schema.test.ts`  
Expected: PASS; the integration test may skip only when its documented database prerequisites are absent.

- [ ] **Step 5: Commit direct Square primitives**

```powershell
git add src/lib/square/checkout-orders.ts src/lib/square/payments.ts src/lib/square/client.ts src/repositories/checkout-reservation-repo.ts supabase/migrations/20260906120000_square_web_payments_checkout.sql tests/unit/square-checkout-orders.test.ts tests/unit/square-payments.test.ts tests/unit/checkout-reservation-repo.test.ts tests/integration/square-checkout-schema.test.ts
git commit -m "feat: add direct Square order payments"
```

### Task 3: Prepare, Permit, and Pay API Flow

**Files:**

- Rename: `src/lib/checkout/payment-link-request.ts` to `src/lib/checkout/checkout-request.ts`
- Replace: `src/lib/checkout/create-payment-link.ts` with `src/lib/checkout/prepare-checkout.ts`
- Replace: `src/lib/checkout/create-payment-link-dependencies.ts` with `src/lib/checkout/prepare-checkout-dependencies.ts`
- Create: `src/lib/checkout/issue-payment-permit.ts`
- Create: `src/lib/checkout/create-direct-payment.ts`
- Replace: `app/api/checkout/payment-link/route.ts` with `app/api/checkout/prepare/route.ts`
- Create: `app/api/checkout/payment-permit/route.ts`
- Create: `app/api/checkout/pay/route.ts`
- Modify: `src/lib/checkout/checkout-attempt-limit.ts`
- Modify: `src/repositories/checkout-reservation-repo.ts`
- Replace: `tests/unit/payment-link-request.test.ts` with `tests/unit/checkout-request.test.ts`
- Replace: `tests/unit/create-payment-link.test.ts` with `tests/unit/prepare-checkout.test.ts`
- Replace: `tests/unit/payment-link-route.test.ts` with `tests/unit/checkout-api-routes.test.ts`
- Modify: `tests/unit/checkout-attempt-limit.test.ts`
- Create: `tests/unit/issue-payment-permit.test.ts`
- Create: `tests/unit/create-direct-payment.test.ts`

**Interfaces:**

- Produces: `prepareCheckoutHandler(request, deps): Promise<Response>` returning `{ orderId, expiresAt, totals, guestAccessToken }`.
- Produces: `issuePaymentPermitHandler(request, deps): Promise<Response>` returning `{ permit, expiresAt }`.
- Produces: `createDirectPaymentHandler(request, deps): Promise<Response>` returning `{ orderId, paymentId, status, statusUrl }`.

- [ ] **Step 1: Write failing orchestration tests in security order**

```typescript
it("does not contact Square when a guest Turnstile token fails", async () => {
  deps.verifyTurnstile.mockResolvedValue({ allowed: false, reason: "invalid" });
  const response = await issuePaymentPermitHandler(request, deps);
  expect(response.status).toBe(403);
  expect(deps.issuePermit).not.toHaveBeenCalled();
});

it("consumes a matching permit before CreatePayment", async () => {
  deps.consumePermit.mockResolvedValue(permitPayload);
  await createDirectPaymentHandler(request, deps);
  expect(deps.consumePermit.mock.invocationCallOrder[0]).toBeLessThan(
    deps.createPayment.mock.invocationCallOrder[0],
  );
});

it("never contacts Square for a replayed permit", async () => {
  deps.consumePermit.mockResolvedValue(null);
  const response = await createDirectPaymentHandler(request, deps);
  expect(response.status).toBe(403);
  expect(deps.createPayment).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run orchestration tests and confirm RED**

Run: `npm run test:jest:unit -- --runInBand tests/unit/checkout-request.test.ts tests/unit/prepare-checkout.test.ts tests/unit/checkout-api-routes.test.ts tests/unit/checkout-attempt-limit.test.ts tests/unit/issue-payment-permit.test.ts tests/unit/create-direct-payment.test.ts`  
Expected: FAIL because the three-stage direct-payment API is absent.

- [ ] **Step 3: Implement the guarded three-stage API**

Preparation keeps access checks, request parsing, identity binding, server cart resolution, shipping quote, reservation, and guest access token creation. It creates and attaches a Square Order instead of a Payment Link and returns only server totals and identifiers.

Permit issuance checks access, Deep BotID, order ownership/guest token, trusted client IP, method, per-order/email/device/IP quotas, and guest Turnstile before issuing the bound permit. Payment submission accepts only `{ permit, sourceId }`, atomically consumes the permit, reloads the pending attached order, rechecks its total/expiry/state, and calls `CreatePayment` with the permit's stable idempotency key.

Map definite declines to one generic `402` message. Map exhausted limits to `429` with `Retry-After`. Map unknown provider outcome to `202` plus the existing protected status URL so reconciliation can converge without a second charge.

- [ ] **Step 4: Run orchestration tests and confirm GREEN**

Run: `npm run test:jest:unit -- --runInBand tests/unit/checkout-request.test.ts tests/unit/prepare-checkout.test.ts tests/unit/checkout-api-routes.test.ts tests/unit/checkout-attempt-limit.test.ts tests/unit/issue-payment-permit.test.ts tests/unit/create-direct-payment.test.ts`  
Expected: PASS, including proof that every rejected path avoids `CreatePayment`.

- [ ] **Step 5: Commit the server flow**

```powershell
git add app/api/checkout src/lib/checkout src/repositories/checkout-reservation-repo.ts tests/unit/checkout-request.test.ts tests/unit/prepare-checkout.test.ts tests/unit/checkout-api-routes.test.ts tests/unit/checkout-attempt-limit.test.ts tests/unit/issue-payment-permit.test.ts tests/unit/create-direct-payment.test.ts
git commit -m "feat: guard direct checkout payments"
```

### Task 4: Embedded Checkout UI for Card and Afterpay

**Files:**

- Modify: `app/(store)/cart/page.tsx`
- Modify: `src/components/checkout/CheckoutClient.tsx`
- Create: `src/components/checkout/SquarePaymentMethods.tsx`
- Create: `src/lib/square/web-payments.ts`
- Modify: `src/lib/checkout/client-session.ts`
- Modify: `tests/unit/checkout-client.test.tsx`
- Create: `tests/unit/square-payment-methods.test.tsx`
- Create: `tests/unit/square-web-payments.test.ts`
- Modify: `tests/unit/cart-checkout.test.tsx`
- Modify: `tests/unit/checkout-client-session.test.ts`

**Interfaces:**

- Consumes: the prepare, permit, and pay API contracts from Task 3.
- Produces: `loadSquareWebPayments(config): Promise<SquarePayments>` and an availability-driven `SquarePaymentMethods` component.

- [ ] **Step 1: Write failing UI and SDK-adapter tests**

```typescript
it("keeps guest checkout and collects a shipping address before payment", () => {
  const html = renderToStaticMarkup(<CheckoutClient />);
  expect(html).toContain('autocomplete="shipping street-address"');
  expect(html).toContain('type="email"');
  expect(html).toContain("Card");
  expect(html).toContain("Afterpay");
  expect(html).not.toContain("Address and payment details are entered on Square");
});

it("requests a permit before tokenizing", async () => {
  await submitCard();
  expect(fetchPermit.mock.invocationCallOrder[0]).toBeLessThan(
    cardTokenize.mock.invocationCallOrder[0],
  );
});
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npm run test:jest:unit -- --runInBand tests/unit/checkout-client.test.tsx tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts tests/unit/cart-checkout.test.tsx tests/unit/checkout-client-session.test.ts`  
Expected: FAIL because checkout still redirects to a Square-hosted link.

- [ ] **Step 3: Implement the embedded payment surface**

Collect email and the complete US shipping address for shipping; omit address fields for pickup. Prepare the checkout and show the returned subtotal, shipping, tax, and total before enabling payment buttons. Load Square's official SDK once, attach the Square card element, and pass amount, currency, intent, and complete billing/shipping contact to `tokenize()`.

Initialize Afterpay from a `PaymentRequest` containing the same exact total and shipping contact. Catch Square's unsupported/amount/eligibility errors and hide only Afterpay. Initialize Apple Pay, Google Pay, and Cash App Pay independently so any unsupported optional method does not disable card.

For each method: obtain a guest Turnstile token, request a method-bound permit, tokenize with Square, submit `{ permit, sourceId }`, store guest order access, clear the cart only after accepted payment, and navigate to the returned local status URL. Disable double submission and render sanitized retry guidance for `402`, `403`, `429`, and `503`.

- [ ] **Step 4: Run UI tests and confirm GREEN**

Run: `npm run test:jest:unit -- --runInBand tests/unit/checkout-client.test.tsx tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts tests/unit/cart-checkout.test.tsx tests/unit/checkout-client-session.test.ts`  
Expected: PASS with no hosted Square URL dependency.

- [ ] **Step 5: Commit the embedded checkout**

```powershell
git add 'app/(store)/cart/page.tsx' src/components/checkout/CheckoutClient.tsx src/components/checkout/SquarePaymentMethods.tsx src/lib/square/web-payments.ts src/lib/checkout/client-session.ts tests/unit/checkout-client.test.tsx tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts tests/unit/cart-checkout.test.tsx tests/unit/checkout-client-session.test.ts
git commit -m "feat: embed Square card and Afterpay checkout"
```

### Task 5: Remove Hosted Checkout, Prove Settlement, and Document Operations

**Files:**

- Delete: `src/lib/square/payment-links.ts`
- Delete: `tests/unit/square-payment-links.test.ts`
- Modify: `src/lib/checkout/expire-checkout-reservations.ts`
- Modify: `tests/unit/expire-checkout-reservations.test.ts`
- Modify: `src/lib/square/payment-event.ts`
- Modify: `src/lib/square/payment-reconciliation.ts`
- Modify: `tests/unit/square-payment-event.test.ts`
- Modify: `tests/unit/square-payment-reconciliation.test.ts`
- Modify: `tests/unit/checkout-notification-worker.test.ts`
- Modify: `app/checkout/processing/page.tsx`
- Modify: `tests/unit/checkout-page.test.tsx`
- Modify: `docs/operations/square-checkout-launch-gates.md`
- Modify: `docs/operations/checkout-security-monitoring.md`
- Create: `tests/e2e/square-web-payments-checkout.spec.ts`

**Interfaces:**

- Consumes: attached Square Order and direct payment IDs from Tasks 2 and 3.
- Produces: one convergent paid/review/declined status flow and one custom receipt event.

- [ ] **Step 1: Write failing retirement and convergence tests**

```typescript
it("expires a direct unpaid checkout without requiring a payment-link deletion", async () => {
  const result = await expireCheckoutReservations([directCheckout], deps);
  expect(deps.cancelSquareOrder).toHaveBeenCalledWith("square-order-1", 1);
  expect(deps.releaseReservation).toHaveBeenCalledWith(
    directCheckout.orderId,
    "checkout_expired",
  );
  expect(result.released).toBe(1);
});

it("sends one custom confirmation after duplicate payment webhooks", async () => {
  await process(event, deps);
  await process(event, deps);
  expect(deps.enqueueNotification).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run settlement tests and confirm RED**

Run: `npm run test:jest:unit -- --runInBand tests/unit/expire-checkout-reservations.test.ts tests/unit/square-payment-event.test.ts tests/unit/square-payment-reconciliation.test.ts tests/unit/checkout-notification-worker.test.ts tests/unit/checkout-page.test.tsx`  
Expected: FAIL where lifecycle code still assumes a Payment Link and where direct-response convergence is unhandled.

- [ ] **Step 3: Remove Payment Links and update lifecycle/operations**

Expire direct unpaid orders by cancelling an attached open Square Order when possible, then release the reservation. Preserve the existing fail-closed late-payment review behavior. Make payment-event and reconciliation lookup converge by attached Square order/payment IDs and continue deduplicating webhook event IDs before mutation. Keep notification enqueueing behind the authoritative paid transition.

The processing page must stop spinning after its bounded polling window and show a resumable status message with order ID and retry/status link. Update operations docs with exact Vercel Deep BotID settings, Turnstile hostname/action keys, Square Risk Manager rules, Afterpay eligibility, custom-receipt verification, alert thresholds, method-specific checkout lock procedure, and Sandbox/staffed-production evidence fields.

- [ ] **Step 4: Run complete verification**

Run: `npm run typecheck`  
Run: `npm run lint`  
Run inside this isolated worktree: `npm run test:jest:unit -- --runInBand`  
Run inside this isolated worktree: `npm run test:jest:integration -- --runInBand`  
Run: `npm run build`  
Run after supplying official Sandbox credentials: `npm run test:e2e -- tests/e2e/square-web-payments-checkout.spec.ts`  
Expected: all local checks PASS; the Sandbox E2E proves card success, card decline, permit replay rejection, delayed webhook recovery, pickup, shipping, Afterpay success, and exactly one custom receipt.

- [ ] **Step 5: Commit the completed migration**

```powershell
git add -A
git commit -m "feat: complete secure Square SDK checkout migration"
```

## Plan Self-Review

- Spec coverage: guest checkout, card/Afterpay, wallets, Deep BotID, Turnstile, permits, layered limits, Square tax/order authority, webhook settlement, custom receipts, expiry, PCI/CSP, monitoring, and hosted-link removal each map to a task.
- Placeholder scan: no deferred implementation placeholders remain; production-only credentialed validation is an explicit release gate.
- Type consistency: `PaymentPermitPayload`, Square order attachment, prepare response, permit response, and pay response are defined once and consumed in later tasks under the same names.
