# Checkout final payment implementation

Spec: `docs/superpowers/specs/2026-11-27-checkout-final-payment-design.md`. Execute inline in `codex/checkout-final-payment`, base `eb8d90b671b83f3be1fca402a64e5c2004523d10`.

## Global constraints

Preserve server financial guards and original-order recovery. Never release ambiguous submitted payment inventory on elapsed time alone. Never log payment sources, permits, credentials, or addresses. No production writes or deployment in this implementation stage.

## Task 1: Nonreserving review and final server submission

Interfaces: review returns validated totals without an order; submit accepts preparation plus source token and optional Turnstile, returning a prepared order plus payment response. Existing preparation, permit, and direct-payment handlers remain the enforcement points.

Write failing tests proving review does not reserve/create an order/credential; invalid quotes and address suggestions still fail before reservation. Test submit sequencing, early inventory refusal, permit refusal, ambiguous dispatch recovery, and recovery-only requests not dispatching. Run targeted Jest tests; expect RED before implementation and GREEN afterward. Implement review branch and injectable submission coordinator plus route; add route to sanitized metrics. Commit after passing tests.

## Task 2: Client review, provider approval, and final submit

Interfaces: SquarePaymentMethods consumes nonreserving review and final prepare with token; CheckoutClient captures financial identity only at final submission, binds returned order, and reuses existing recovery after uncertain responses. Existing bound original retries remain supported.

Write failing browser regressions for guest Afterpay accepted address plus session revalidation, no stock claim before tokenization, long approval with fresh permit, and bounded stalled provider continuation. Implement frozen reviewed context, final request wiring, permit-after-token compatibility, bounded owner wait/provider timeout, and synchronous Apple Pay invocation. Run relevant unit and component-browser suites; expect GREEN. Commit after checks.

## Task 3: Admin clarity, combined verification, and release evidence

Interfaces: existing order status/reason fields drive presentation only. Inspect and test automatic expiration versus pending/incomplete and canceled display. Run typecheck, lint on changed code, checkout unit/browser suites and isolated database concurrency/recovery checks. Record unavailable provider/deployment evidence honestly. Commit final documentation and review changes.

## Review focus

Inspect two shoppers racing for one unit; browser disappearance during final submit; no callback after cancel; quote/address ownership across session revalidation; expired address confirmation or Turnstile during SDK approval; original retries after definite decline; ambiguous payment outcomes, durable expiry guards and guest recovery when the response is lost. Check payment source/permit secrecy and middleware admission for the new route. A fresh whole-branch reviewer is required before claiming completion.
