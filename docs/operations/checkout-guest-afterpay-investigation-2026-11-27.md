# Guest Afterpay checkout investigation November 27 2026

Guest checkout has reproducible address-continuation and Afterpay timing defects. The initial production audit also found three declined orders whose inventory recovery was stuck. The exact reported production screen cannot be matched to an individual request without an order ID or time; the address reproduction below ends in an error, while a stalled provider reproduction remains on the Afterpay loading screen.

Evidence was collected around 8:02–8:17 p.m. Eastern on November 27. All production database transactions used `BEGIN READ ONLY` followed by `ROLLBACK`. Square calls were GET requests. This investigation submitted no real payments, changed no orders, sent no messages, and changed no provider configuration.

## Production revision and investigation scope

**Later production refresh:** deployment `dpl_J8QGFsP7iuELSsUP5YUQtAckqHkA`, source `eb8d90b671b83f3be1fca402a64e5c2004523d10`, became ready after its November 27 8:43 p.m. ET creation. Read-only SQL subsequently verified migrations `20261127135000`, `20261127195500`, and `20261127202000` are now applied. All three previously stuck declined orders are canceled with `checkout_expired`; their five reserved units are released. A subsequent one-hour Vercel production checkout-error grouping returned no matching groups. These observations do not qualify live Afterpay approval or establish an error-free checkout. The original audit below remains historical evidence. See the [implementation record](checkout-final-payment-implementation-2026-11-27.md) for the new branch.

- Production project: `sneakereco/soles-pro`, `prj_ROOpjgDuPj2405JzeR1yG4iRtFMf`.
- Deployment: `dpl_9vYSdCbqfBdpbucBKKjjNwtVbXv4`, source `dd4b7f6f9fb5fc82c3f196ae747307cdb071b562`.
- [Production deployment](https://vercel.com/sneakereco/soles-pro/9vYSdCbqfBdpbucBKKjjNwtVbXv4) and [Vercel logs](https://vercel.com/sneakereco/soles-pro/logs).
- The workspace advanced from `6658d2af` on `codex/store-opening-hotfix` to `8d8a3360` on `main` during this investigation. The checkout client, payment methods, payment-permit store, Web Payments helpers, and guest-context source used by the reproductions have no diff between that production revision and the inspected main revision. Later recovery fixes must be distinguished from deployed behavior.
- Vercel requests used explicit production project/team IDs because the local `.vercel/project.json` links to staging.

The user narrowed the report to a guest using Afterpay, after accepting the suggested address, with “Preparing your order” visible. No affected order ID or checkout time was available.

The subsequent inventory discussion raised a separate business-policy concern: one-of-one products become unavailable while a buyer is still in provider approval. The [inventory and payment-finalization research](inventory-payment-finalization-research-2026-11-27.md) evaluates moving allocation until after SDK tokenization and immediately before backend payment dispatch. That is a proposed replacement for the early hold, not an implemented change or a reason to release inventory with an unresolved payment.

## Address correction can be rejected after a session recheck

**Confirmed in the controlled browser; not correlated to a particular production customer.**

The test renders the real `SessionProvider`, `CartProvider`, checkout layout, `CheckoutClient`, and `SquarePaymentMethods`. It substitutes app API replies and the Square SDK boundary. A guest selects Afterpay, receives an address suggestion, and accepts the suggested capitalization and ZIP+4. The corrected address has a different quote fingerprint, with exactly the same total.

When the same guest session is rechecked while the second preparation is in progress, the continuation displays:

> Checkout totals changed. Check your original order before paying.

No permit is requested, no Afterpay tokenization occurs, and no payment is submitted. A prepared order can already exist at this point.

`prepareWithAddressReview` keeps the accepted address and its quote in continuation-local variables. `resolveWalletShippingContact` does not update the parent form address. The parent's refreshed quote therefore describes the original entered address. After revalidation, `CheckoutClient.prepare` compares that parent quote fingerprint against the accepted-address quote fingerprint and treats their expected difference as a checkout change, even with identical money totals. The fingerprint deliberately includes the full address, so address normalization can change it without changing the amount.

The controls isolate the difference:

| Address quote differs | Same guest reverified during preparation | Result                                     |
| --------------------- | ---------------------------------------- | ------------------------------------------ |
| Yes                   | No                                       | Reaches one permit and one mocked payment  |
| No                    | Yes                                      | Reaches one permit and one mocked payment  |
| Yes                   | Yes                                      | Rejects before permit/tokenization/payment |

Relevant source: `src/components/checkout/SquarePaymentMethods.tsx` around `prepareWithAddressReview`; `src/components/checkout/CheckoutClient.tsx` around `resolveWalletShippingContact` and the `reverified` quote comparison; `src/lib/checkout/checkout-quote-fingerprint.ts`.

The repair needs to reverify the quote for the accepted continuation address and preserve owner, basket, amount, billing, and address-confirmation checks. Treating different fingerprints as equivalent without checking their full context would weaken those checks.

## Payment authorization expires while the buyer is using Afterpay

**Confirmed ordering and lifetime defect; delayed-provider browser reproduction.**

`PaymentPermitStore` stores a permit in Redis for **120 seconds**. `authorizeAndTokenize` requests that permit **before** awaiting the Afterpay approval/tokenization. The client retains the same permit after tokenization, without renewal. A buyer taking longer than two minutes can therefore return a usable provider result to an expired application authorization. The backend then rejects it as `Payment authorization expired` before submitting a payment.

The browser diagnostic holds the provider result for 121 simulated seconds. It observes one permit request, then submission of that unchanged permit. Its simulated backend returns the expiration response. This is a controlled reproduction of the client timing, not a real expired Redis permit or a hosted Afterpay purchase.

Relevant source: `src/lib/checkout/payment-permit.ts:41`, `src/lib/square/web-payments.ts:160`, and `src/components/checkout/SquarePaymentMethods.tsx` around `submitPreparedMethod`.

The guest checkout-context cookie itself has no explicit age limit in this source. The other distinct clocks are the ten-minute address-confirmation proof and the fifteen-minute inventory reservation. Extending a signed-in session lifetime alone would not repair this permit problem.

The repair should obtain authorization near dispatch after provider approval, with fresh owner, original-order, inventory, total, and verification checks. Provider approval that outlives the reservation still requires safe original-order recovery.

## An unresolved Afterpay approval has no application recovery control

**Reproduced with an unsettled provider boundary; the reason a real provider might stall remains unverified.**

The checkout awaits `payment.tokenize()` without an application deadline or an escape/status action. The dialog only renders its cancel/return control during a review or error. With a never-settling SDK result, the diagnostic remains on `Loading Afterpay…` after **16 simulated minutes**, with no cancel button and zero payment submissions. By then the two-minute permit and fifteen-minute reservation have elapsed.

This can explain a persistent loading experience if the provider handoff stalls, but it does not prove whether a production popup, browser restriction, or provider callback caused the reported incident. A deadline must retire the old continuation and check the original attempt; it must not simply re-enable a second payment while an old callback can still arrive.

The ordinary app JSON requests already have fifteen-second deadlines. `useCheckoutOwnerAccess` also has an unbounded continuation wait during unavailable/denied verification or pending quotes; that is a separate recovery gap requiring scoped validation, rather than evidence that all server requests lack timeouts.

The current [Square Afterpay guide](https://developer.squareup.com/docs/web-payments/add-afterpay) explicitly uses `afterpay_shippingaddresschanged`, matching this integration. An event-name mismatch is **not** established as the cause. Square's [SDK reference](https://developer.squareup.com/reference/sdks/web/payments/objects/AfterpayClearpay) describes `tokenize()` as the provider-popup interaction. Native provider behavior remains outside these mocked diagnostics.

## Live orders and confirmation delays

The inspected rolling 24-hour database snapshot contained **31 orders: 10 paid, 18 canceled, and 3 pending**. Every order in that window was a guest order. These counts describe attempts/orders, not unique customers.

- All **10 succeeded attempts** are now attached to paid orders. No succeeded attempt remained on a non-paid/non-refunded order in the check.
- The first succeeded attempt-history timestamp preceded reservation consumption by approximately **3 minutes 39 seconds to 28 minutes 19 seconds** across those ten paid orders. Reservation consumption is evidence of the paid projection; it is not the payment-provider completion timestamp.
- All ten projections exceeded the UI's **60-second** automatic observation window. A customer could therefore receive the delayed/unconfirmed screen even though the payment succeeded and the order later became paid.
- All ten successful attempts were created before the currently deployed prompt-reconciliation repair. The production build contains that repair, and Square now reports the existing subscription **enabled**, last updated at **6:05:52 p.m. Eastern**. No successful new payment after that restoration was available in this snapshot to establish the repaired end-to-end latency.
- All **16 Afterpay attempts** in the window were canceled with `expiry_not_dispatched`; none had `dispatched_at` set. Fifteen were shipping and one was pickup. These records locate the failure/abandonment before the server payment dispatch, but do not prove that every one had the same browser cause.

There were five stored Square receipts in the window. One was processed and matched a local provider order. Four were in evidence-conflict review and did not match local provider orders; these must not be presented as four failed customer payments without further correlation.

## Three declined orders still hold five units

| Order ID                               | Attempt           | Provider payment retrieved through order tender       | Active held units |
| -------------------------------------- | ----------------- | ----------------------------------------------------- | ----------------- |
| `63a724fc-71c0-4c37-91c4-750f0f41d3c4` | Cash App declined | `FAILED`, attempt and provider-order references match | 2                 |
| `167d23ae-5d41-4f84-8118-3d05e5770fd8` | Card declined     | `FAILED`, attempt and provider-order references match | 1                 |
| `5af05832-c708-4d34-b8b1-eae47bb8e605` | Cash App declined | `FAILED`, attempt and provider-order references match | 2                 |

The application still labels these orders pending hours after their reservations expired. Their recovery jobs had approximately 25–49 attempts in the earlier snapshot, with `dependency_busy` and `recovery_unavailable` reasons. Read-only provider checks found failed payments for the matching tenders, not successful payments for these attempts.

Two deployed barriers explain the stuck recovery:

1. The direct decline can be stored without a provider payment ID. Later inquiry discovers the same failed payment, but the installed outcome function rejects fresh corroborating evidence for a terminal attempt. Its terminal-outcome guard prevents binding that evidence.
2. The deployed expiration adapter refuses to cancel an open Square order containing any tender, including a verified failed tender. It can keep retrying without releasing stock.

The deployed worker also runs four lanes against a configured two-slot Square budget, allowing capacity-denied jobs to consume retry attempts. The lease snapshot itself showed no permanently occupied slots.

Main already contains terminal-negative-evidence, verified-negative-tender cancellation, worker-concurrency, and bounded-diagnostic changes. Production's migration history still topped out at `20261127134000`; a read of the installed function confirmed that its corroborating terminal-evidence branch was absent. The later recovery migrations therefore were **not installed** at the time of inspection. These existing repairs need their release gates and live verification; they should not be duplicated or replaced by manual stock/order edits.

## Vercel error evidence

The rolling 24-hour application-log query grouped **281 matching records** under `/api/cron/expire-checkouts`, **11** under `/api/cron/checkout-health`, and one each under preparation and quote. These are matching log records, not counts of failed customer checkouts or HTTP invocations.

- **2:36:47 p.m. Eastern:** `/api/checkout/prepare` logged `application_error`, request `c1ab0d26-5437-4da5-b442-726e82c8264c`.
- **3:35:06 p.m. Eastern:** `/api/checkout/quote` logged `application_error`, request `be99e40a-bc09-4b80-b6c6-561603886bd9`.
- Repeated recovery retries and `overdue_hold` alerts correlate with the orders listed above. There were also earlier `missing_heartbeat` alerts.
- `refresh_token_not_found` appeared twice per request on two distinct storefront requests, around **10:44 a.m.** and **2:12 p.m.**. Those logs are not a trace of the reported guest Afterpay checkout. The six recently created Auth sessions had no explicit `not_after` deadline; this does not establish production idle-session settings.
- The deployed logger discards the original exception, and its lifecycle sanitizer omits arbitrary messages/stacks. The two generic checkout errors cannot be attributed to a particular dependency from those logs alone. Main's bounded diagnostic changes are relevant to closing this gap.

Absence of payment/order-route application logs is not evidence that those routes received no requests. This connector query reads emitted application output, not a complete HTTP access trace.

## Reproduction artifacts and next repair sequence

### Incomplete and canceled admin orders

The follow-up scope includes the stalled transition from an expired pending checkout to a safely closed checkout, and clear admin explanations of automatic expiration versus a payment decline or customer cancellation. `OrdersRepository.listAdminOrders` implements the Incomplete filter as `status = pending` with `expires_at` in the past. It does not itself close a checkout or release inventory.

For the recently inspected expired unpaid checkouts, Incomplete and Canceled can represent stages before and after cleanup. This is not a universal equivalence: an expired pending checkout can still require payment reconciliation before its stock can be released. Preserve that distinction. The automatic expiration of an unpaid reservation remains expected behavior; the repair targets shoppers getting blocked before payment, failed cleanup, and unclear admin status/reason presentation. This report adds that scope; no admin labels or behavior have been implemented by this investigation.

The standalone harness is saved at `test-results/checkout-investigation-2026-11-27/browser-reproductions.mjs`. From this repository on this machine:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\dsrus\AppData\Local\ms-playwright'
node --test test-results/checkout-investigation-2026-11-27/browser-reproductions.mjs
```

Observed result: **six diagnostics, five passing, one failing**. The failing assertion is intentional evidence that accepted-address preparation should reach authorization after same-owner revalidation. The other diagnostics establish working controls, retention of an expiring permit, and absent recovery from an unsettled provider. They do not establish hosted Square/Afterpay success.

Repair priorities:

1. Preserve and release the already merged declined-order recovery repairs, then verify the three orders, five held units, job completion, and new diagnostic fields in production.
2. Fix the address-continuation comparison using the accepted address's verified quote; retain the failing diagnostic as regression coverage alongside the controls.
3. Correct the permit issuance timing and add safe recovery for long/unsettled Afterpay approval and terminal session-verification states.
4. Verify guest shipping and pickup with native Afterpay on staging, including accepting a suggestion, unchanged/changed totals, tab visibility changes, approval exceeding two minutes, cancellation, late callbacks, and original-order recovery. Then measure actual dispatch-to-receipt latency after release.
5. Clarify admin order status and expiration reasons, including expired pending orders awaiting reconciliation and automatically expired unpaid orders, without treating elapsed time alone as proof of a failed payment.

No application source, database state, provider settings, or deployments were changed by this investigation. The new repository artifact is this report; standalone diagnostics and screenshots are under the ignored test-results directory.

## Implementation follow-up

The subsequent approved implementation, final verification results, released-stock checks, and 10:35 p.m. ET production log refresh are recorded in [the implementation report](checkout-final-payment-implementation-2026-11-27.md). That report distinguishes the recovery fixes already deployed from this feature branch's undeployed checkout changes. The final log refresh also identified storefront product-cache fetch failures whose connection to checkout remains unproven.
