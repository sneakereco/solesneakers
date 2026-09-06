# Square Web Payments Strict Guest Security Design

**Status:** Approved  
**Date:** 2026-09-06

## Decision

Replace Square Payment Links with Square Web Payments SDK and the Payments API. Guest checkout remains available. Sole Sneakers owns the checkout form, order summary, shipping address, and custom receipt UI; Square-hosted fields continue to collect card data and return a single-use token. Raw PAN and CVV must never enter Sole Sneakers JavaScript state, API bodies, logs, analytics, or storage.

The production flow is:

```text
Checkout form
  -> server-authoritative cart, shipping, tax, and inventory reservation
  -> Square Order creation
  -> BotID Deep Analysis
  -> guest Turnstile verification
  -> single-use payment permit
  -> Square Web Payments tokenization
  -> permit consumption + Square CreatePayment
  -> signed Square webhook settlement
  -> Sole Sneakers confirmation page and custom receipt
```

## Payment Methods

- Support card and Afterpay/Clearpay in the first embedded release.
- Preserve Apple Pay, Google Pay, and Cash App Pay where the SDK reports them available; an unavailable optional method must not prevent card checkout.
- Require the server-calculated Square Order total to equal the amount passed to every SDK payment request and `CreatePayment`.
- Omit `buyer_email_address` and Square customer creation from `CreatePayment` so Sole Sneakers does not request a Square email receipt. Afterpay may still send the buyer required account, financing, or installment communications.
- Do not store cards on file in this project.

## Strict Guest Profile

Every payment attempt passes BotID Deep Analysis. A guest order additionally requires a successful Cloudflare Turnstile token before the server issues a payment permit. Turnstile is used without enabling the Cloudflare HTTP proxy.

A payment permit is an opaque random value stored in Upstash with a two-minute TTL. It is bound to:

- tenant ID and local order ID;
- cart hash and exact total in cents;
- payment method;
- device session ID and normalized email HMAC;
- one logical payment attempt.

The payment endpoint atomically consumes the permit before calling Square. Missing, expired, mismatched, replayed, or unverifiable permits fail closed without contacting Square. A definite Square decline requires a new permit and a new Turnstile token. An ambiguous transport failure is reconciled using the same Square idempotency key; the browser does not initiate a second charge.

## Velocity Controls

Keep existing daily limits and add payment-stage limits:

| Signal                   | Initial limit                                                           |
| ------------------------ | ----------------------------------------------------------------------- |
| local order              | 3 permits per 30 minutes                                                |
| normalized email/account | 5 new checkout attempts per 24 hours                                    |
| device session           | 10 new checkout attempts per 24 hours and 5 declines per hour           |
| trusted Vercel IP        | 10 payment permits per hour, plus Vercel edge limits                    |
| Square card              | decline after 3 completed transactions in 24 hours through Risk Manager |

Limits are launch defaults. Store only masked IP evidence and HMAC-normalized email identifiers in order records. Short-lived raw IP counters may exist in Vercel or Upstash but must expire with their rate-limit windows.

Do not automatically close the entire store from one attacker-controlled counter. Attack mode requires multiple signals such as a high absolute decline count, a high decline ratio, and several distinct sessions. The existing checkout lock remains the operator-controlled emergency stop.

## Square Risk and Afterpay

Pass complete buyer verification details to `card.tokenize()` so Square can evaluate risk and invoke 3DS. Production Square Risk Manager must decline invalid CVV and high-risk payments, invoke 3DS for moderate-risk or suspicious address cases, and enforce same-card velocity.

Square Risk Manager does not cover Afterpay. Afterpay still uses BotID, guest Turnstile, application limits, an exact-amount permit, and signed webhook settlement. The client must check Afterpay eligibility and amount support; an unavailable Afterpay method is hidden without affecting card checkout.

## Order and Payment Authority

The browser never supplies prices, tax, shipping cost, order status, or a Square order ID as authority. The server resolves current product data, reserves inventory, creates a Square Order with `autoApplyTaxes`, validates the returned total, and attaches its ID and calculated amounts to the local pending order.

`CreatePayment` uses:

- the one-use SDK token as `sourceId`;
- the attached Square order ID;
- the exact local/Square total;
- a stable idempotency key derived for that logical attempt;
- `autocomplete: true` for immediate completion.

The synchronous response may update the customer-facing state, but only a verified, deduplicated Square webhook or authoritative reconciliation may consume inventory, mark the order paid, enqueue the Sole Sneakers receipt, or authorize fulfillment.

## Browser and PCI Boundary

- Serve checkout only through HTTPS and Square-supported secure contexts.
- Add only documented Square, Afterpay, and Turnstile origins to the checkout CSP directives.
- Keep unrelated analytics, session replay, chat, tag-manager, and marketing scripts off the embedded payment surface.
- Maintain an inventory and justification for scripts running on checkout and monitor payment-page/header changes as required by the applicable PCI DSS assessment.
- Confirm the final SAQ classification with Square or the acquiring/compliance authority before production; do not assume the hosted-link classification automatically carries over.

## Customer Experience

- Shipping checkout collects the complete US shipping address before payment; pickup omits it.
- Display server-calculated subtotal, shipping, tax, and total before enabling payment methods.
- Turnstile Managed Mode should normally be low-friction, but a challenge failure produces a retryable verification message rather than a processor decline.
- Display generic card-decline language and never reveal whether PAN, CVV, postal code, balance, or issuer response identified the card.
- On accepted payment, navigate directly to the Sole Sneakers processing/status page and then the custom confirmation page. Do not redirect through a Square-hosted page.

## Receipts

The existing checkout notification outbox remains the sole Sole Sneakers receipt trigger and sends once after authoritative payment confirmation. `CreatePayment` must not opt into a Square receipt email. Sandbox and one staffed production purchase must verify that Square does not send a merchant receipt while Afterpay-required communications remain distinguishable from the Sole Sneakers order receipt.

## Failure Behavior

- BotID, Turnstile Siteverify, Upstash, pricing, inventory, or required Square configuration unavailable: return `503`, contact no payment API, retain a safe retry path.
- Invalid or exhausted permit: return `403` or `429`, contact no payment API.
- Definite Square decline: retain the reservation while valid, record a sanitized decline, require a new permit.
- Unknown Square outcome: show processing, reconcile by idempotency/order/payment identifiers, and forbid a second logical payment.
- Expired unpaid reservation: cancel the attached open Square Order when possible, then release inventory. A later payment enters review and cannot authorize fulfillment.

## Acceptance Criteria

- A guest can complete card or eligible Afterpay checkout without creating an account.
- No guest payment reaches `CreatePayment` without Deep BotID, server-validated Turnstile, all velocity checks, and a matching one-use permit.
- Replaying a permit or SDK token cannot create a second payment.
- Server and Square totals match before the payment button is enabled and again before `CreatePayment`.
- Card information remains inside Square-hosted SDK fields.
- Signed webhook delivery completes the order and sends exactly one custom receipt.
- Direct browser refresh, delayed webhook, and ambiguous Square response converge on the same order result without an infinite spinner.
- Square Payment Link creation and hosted-checkout redirects are no longer reachable from the storefront.

## Primary References

- Square Web Payments SDK: https://developer.squareup.com/docs/web-payments/overview
- Square card buyer verification: https://developer.squareup.com/docs/web-payments/take-card-payment
- Square Afterpay payments: https://developer.squareup.com/docs/payments-api/take-payments/afterpay-payments
- Square Risk Manager: https://squareup.com/help/us/en/article/6816-navigating-square-risk-manager
- Cloudflare Turnstile server validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Vercel BotID: https://vercel.com/docs/botid
- PCI SSC embedded-payment script guidance: https://www.pcisecuritystandards.org/faqs/1588/
