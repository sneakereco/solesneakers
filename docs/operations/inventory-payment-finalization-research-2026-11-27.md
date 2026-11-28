# Inventory allocation at payment finalization

Research date: 2026-11-27. Scope: one-of-one reseller stock and Square payment timing. This is a recommendation, not an approved design. No application code, provider configuration, credentials, or live payment state were changed.

## Finding

**Architectural recommendation:** keep stock available while a buyer reviews checkout and completes the Square SDK's buyer interaction. Once the SDK returns a usable payment token, atomically claim the complete cart in PostgreSQL immediately before the backend submits the payment. Keep that claim attached to the durable payment attempt until the money outcome is resolved.

This avoids blocking shoppers during someone else's Afterpay login or abandonment, and avoids charging competing buyers who lose stock. A payment-in-progress commitment remains necessary: a provider timeout does not prove that no payment happened.

The proposed winner is **the first valid final server commit that claims every required unit**. Opening checkout, clicking first, or receiving a webhook first confers no priority. Explain before provider interaction that availability is confirmed at final submission.

## Current repository behavior

The coordinating investigation verified the following local source behavior on 2026-11-27:

| Evidence                                                                            | Current behavior                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/checkout/SquarePaymentMethods.tsx`, `submitPreparedMethod`          | After validation/payment-method submission, prepares and reserves before calling `authorizeAndTokenize`; opening the checkout page alone is not this trigger. |
| `src/lib/square/web-payments.ts`, `authorizeAndTokenize`                            | Obtains an application permit lasting 120 seconds before invoking SDK tokenization. That application permit is distinct from provider payment authorization.  |
| `supabase/migrations/20261127044000_checkout_reservations.sql`, lines 307, 322, 328 | The database computes expiry as `clock_timestamp() + interval '15 minutes'`, decrements `product_variants.stock`, and records reservations for the lines.     |
| `src/lib/square/payments.ts`, `request`                                             | Sends `autocomplete: true` to Square.                                                                                                                         |
| `src/lib/square/checkout-order-payload.ts`                                          | Builds ad hoc Square order lines using name, quantity, and base price, without a Square `catalogObjectId`.                                                    |

**Implication:** a timeout change or `autocomplete` switch is insufficient. Reservation timing, durable dispatch, recovery, amount validation, and existing-hold compatibility need a coordinated design. Preserve existing safety repairs meanwhile.

## What the Square stages mean

The SDK produces a single-use token; it does not create payments itself. The backend processes the token with the Payments API. SDK success is not a completed Square payment. [SDK overview](https://developer.squareup.com/docs/web-payments/overview)

Card buyer authentication is also distinct from payment acceptance: Square notes that verification does not guarantee that the issuer will accept the card. [Square card payments](https://developer.squareup.com/docs/payments-api/take-payments/card-payments)

In `CreatePayment`, `autocomplete: true` requests completion; `false` leaves an approved payment. `CompletePayment` captures an `APPROVED` payment; `CancelPayment` voids it. These backend actions differ from browser approval. [CreatePayment](https://developer.squareup.com/reference/square/payments-api/create-payment), [CompletePayment](https://developer.squareup.com/reference/square/payments-api/complete-payment), [CancelPayment](https://developer.squareup.com/reference/square/payments-api/cancel-payment)

For Afterpay, the SDK first returns a token after the buyer interaction; the backend must charge that token, using the same amount that Afterpay was shown. **Afterpay authorization itself charges the first installment and starts the installment plan.** It is not equivalent to a card-only authorization hold. [Square Afterpay and Clearpay payments](https://developer.squareup.com/docs/payments-api/take-payments/afterpay-payments)

## Delayed capture by payment method

| Method            | Published support                                                                                                                                                                                                    | Limitation relevant to this decision                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credit/debit card | `autocomplete: false` produces an approved payment; explicitly complete or cancel it.                                                                                                                                | Authorization places a hold. Online card authorization defaults to seven days; configurable `delay_duration` is at least one minute and below the default threshold. `delay_action` defaults to `CANCEL`. Automatic `COMPLETE` has restrictions when an explicit order ID is supplied. [Delayed card capture](https://developer.squareup.com/docs/payments-api/take-payments/card-payments/delayed-capture)               |
| Apple Pay         | Square identifies Apple Pay as facilitating a card payment, rather than the `WALLET` tender used by Cash App Pay. Applying the card delayed-capture flow is the supported architectural reading of these references. | Validate the actual Apple Pay flow for this seller and API version before adopting it. The Apple Pay guide requires calling `tokenize()` directly from the click handler without an intervening asynchronous API call. Prepare the quote before that click. [TenderType](https://developer.squareup.com/reference/square/enums/TenderType), [Apple Pay guide](https://developer.squareup.com/docs/web-payments/apple-pay) |
| Cash App Pay      | The method-specific guide explicitly supports `autocomplete: false` followed by `CompletePayment`.                                                                                                                   | Cash App Pay is US-only. The API reference describes custom `delay_duration` as card-only; do not assume the card deadline settings are available here. [Cash App payments](https://developer.squareup.com/docs/payments-api/take-payments/cash-app-payments), [CreatePayment](https://developer.squareup.com/reference/square/payments-api/create-payment)                                                               |
| Afterpay/Clearpay | The method-specific guide explicitly supports `autocomplete: false` followed by `CompletePayment`.                                                                                                                   | The authorization has the buyer effect described above. This makes authorizing all contenders before claiming stock an unattractive default. [Afterpay and Clearpay payments](https://developer.squareup.com/docs/payments-api/take-payments/afterpay-payments)                                                                                                                                                           |

**Documentation inconsistency:** both the Cash App and Afterpay guides label the initial payment status `AUTHORIZED`. The canonical `Payment.status` reference lists only `APPROVED`, `PENDING`, `COMPLETED`, `CANCELED`, and `FAILED`; the completion endpoint accepts `APPROVED`. Treat this as a documentation inconsistency, not permission to invent a new application status. Confirm actual per-method responses in Sandbox and, where necessary, with Square before implementing delayed capture. [Payment object](https://developer.squareup.com/reference/square/objects/payment), [CompletePayment](https://developer.squareup.com/reference/square/payments-api/complete-payment)

**Unverified:** merchant capabilities and buyer-facing release timing. Afterpay eligibility depends on seller/amount, and Sandbox ignores eligibility checks. [Afterpay SDK guide](https://developer.squareup.com/docs/web-payments/add-afterpay)

## Why allocating only after a completed charge is weaker

**Architectural inference:** if two buyers can both call `CreatePayment` before an exclusive stock claim, both can pay for the same last unit. A later PostgreSQL transaction can still guarantee only one fulfillment, but it cannot undo the other completed payment. The losing payment requires a refund rather than an approved-payment cancellation.

Refunds can be `PENDING`, `COMPLETED`, `REJECTED`, or `FAILED`: requesting a refund does not mean the buyer already has the money back. Payment status stays `COMPLETED` after refund, requiring separate tracking. [Refund payments](https://developer.squareup.com/docs/payments-api/refund-payments)

**Architectural inference:** for one-of-one stock, charge-then-award converts normal competition into customer refund incidents. Authorization-then-claim reduces captured-payment refunds for some methods, but still exposes losing card buyers to holds and has the Afterpay buyer consequence already described. A late atomic claim before backend money submission avoids both normal-path problems.

## Recommended sequence to design

The following is an architectural proposal, not a provider guarantee or a deployed change:

1. Prepare/review a trusted quote and fulfillment details without changing stock. Freeze approved quantities, versions, amount, tax, shipping and address; material changes require renewed approval.
2. Run SDK buyer interaction without reserving stock. Keep Apple Pay's click-to-tokenization path synchronous until tokenization begins.
3. After tokenization, use a short PostgreSQL transaction to validate ownership, approved quote, sale eligibility and all stock. Claim every unit and persist a durable attempt and stable payment idempotency key. Any unavailable line means no claim and no backend charge.
4. Commit before calling Square. Dispatch only for that attempt and approved amount. Recovery resumes the existing attempt without another allocation or payment identity.
5. Verified completion fulfills the claim once and projects the receipt. Definite failure or verified cancellation releases it once. Unknown outcomes retain the obligation for reconciliation.

PostgreSQL row locks last until transaction end. Its documentation recommends consistent object ordering to avoid deadlocks and warns against leaving transactions open while waiting for user input. The proposed persistent claim is a committed record, not a row lock or open SQL transaction held during provider calls. [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)

**Tradeoff:** stock can sell during provider interaction. A buyer may return with a valid token and receive an unavailable response before backend payment processing. Normal processing should be brief; unresolved provider outcomes preclude guaranteeing a fixed seconds-only commitment.

## Recovery and unknown outcomes

Payments can succeed despite a lost response. Retry the identical `CreatePayment` request with its original idempotency key to recover its result without charging twice; changing that request can fail. [Square idempotency](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)

When the payment ID is known, `GetPayment` retrieves its current state. Square also offers `CancelPaymentByIdempotencyKey` for an unknown `CreatePayment` result. That cancellation endpoint returns success without taking action when no matching payment is found. The documentation does not establish an empty cancellation result as a permanent fence against every request that might still arrive later. [GetPayment](https://developer.squareup.com/reference/square/payments-api/get-payment), [CancelPaymentByIdempotencyKey](https://developer.squareup.com/reference/square/payments-api/cancel-payment-by-idempotency-key)

Payment updates are available through webhooks. Deliveries can repeat, have no guaranteed order, and are retried for up to 24 hours. Webhook arrival order is therefore unsuitable as the rule for awarding scarce stock. [Payment updated](https://developer.squareup.com/reference/square/payments-api/webhooks/payment.updated), [Square webhooks](https://developer.squareup.com/docs/webhooks/overview)

**Required design properties:** persist identity before dispatch; reconcile the original operation; deduplicate finalization; prevent old workers dispatching after release. Release requires proof that no later payment can succeed, including durable prevention of dispatch for unsent attempts. A timeout, closed tab, elapsed 15 minutes, or missing webhook is insufficient. Cancellation fencing needs design review.

## Square orders and inventory do not replace the stock claim

For a single payment, Square supports `CreatePayment` with an order ID and an amount equal to the order total. `PayOrder` instead completes previously approved delayed-capture payments that reference that order. It also cancels approved payments for the same order that were omitted from its payment-ID list, supports idempotency, and optionally checks the Square order version. [Pay for orders](https://developer.squareup.com/docs/orders-api/pay-for-orders), [PayOrder](https://developer.squareup.com/reference/square/orders-api/pay-order)

Square's documented automatic stock adjustments apply to tracked Square catalog variations in itemized transactions. Calling `CompletePayment` or `PayOrder` moves the sold quantities from `IN_STOCK` to `SOLD`. The `RESERVED_FOR_SALE` state is read-only through the Inventory API. [Inventory process flow](https://developer.squareup.com/docs/inventory-api/how-it-works), [InventoryState](https://developer.squareup.com/reference/square/enums/InventoryState)

**Architectural inference:** Square order versions/idempotency do not atomically check PostgreSQL reseller stock. Current ad hoc lines identify no tracked catalog variations. `PayOrder` cannot replace local allocation. External sales channels need the same allocation authority or a separately designed synchronization/oversell policy.

## What other commerce platforms establish

Shopify checks inventory throughout checkout but holds it only when payment information is submitted, releasing on payment failure. Early commitment is a product choice rather than a universal requirement; this does not equate Shopify's trigger with our provider interaction. [Shopify Checkout](https://help.shopify.com/en/manual/checkout-settings/)

commercetools separately supports reserve-on-order and reserve-on-cart. Reserve-on-order does not hold stock when cart lines are added; it checks/deducts at order creation and fails when stock is insufficient, except when configured restock behavior permits it. Reserve-on-cart holds stock earlier with a configured expiry. [commercetools inventory overview](https://docs.commercetools.com/api/inventory-overview)

**Inference boundary:** these examples establish choices about commitment timing, not the safety of charge-before-allocation or Shopify's internal payment transaction sequence.

## Evidence needed before implementation or release

- Concurrency: many valid submissions for one unit produce one winning stock claim and exactly one backend payment dispatch; stock losers dispatch zero payments. Mixed carts succeed or fail as a whole.
- Abandonment and replay: abandoned provider approval leaves stock available; stale tokens, late callbacks, refreshes, duplicated submissions and old workers cannot reserve, pay, finalize, or release twice.
- Recovery: lost provider responses, dispatch-boundary crashes, out-of-order webhooks, declines and unknown outcomes preserve the stock/payment invariant.
- Quote integrity: changed address, shipping, tax, price, quantity or eligibility triggers revalidation/reapproval. Submitted and provider-approved amounts match.
- Method evidence: real SDK/Sandbox coverage for card, native Apple Pay, Cash App Pay and Afterpay; delayed-capture response details if that alternative is selected; seller-specific production eligibility and bounded production verification. Square notes that Afterpay Sandbox capture/void/refund changes are not reflected in Afterpay's Sandbox, so those tests have a clear evidence limit. [Afterpay payments testing](https://developer.squareup.com/docs/payments-api/take-payments/afterpay-payments)
- Migration: inventory already held under the old flow, compatibility with old application writers and active checkout attempts, and reconciliation/operational ownership are addressed before rollout. No release authorization or provider verification is implied by this research.

The user subsequently approved this recommendation for implementation. See the [implementation and release evidence](checkout-final-payment-implementation-2026-11-27.md); the research recommendation alone does not establish deployment.
