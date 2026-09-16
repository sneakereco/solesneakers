# Checkout repair validation

Branch: `codex/checkout-cohesion`. Approved scope: September 15, 2026.

## What changed

Pickup name and phone now travel from checkout through the reservation, order, Square recipient, and staff pickup view. Buyer email remains authoritative for signed-in customers. Wallets can collect missing contact/billing details and continue with the existing token. Shipping wallets may complete recipient name/phone; the physical destination must still be supplied by the wallet. Normal card, Afterpay, and Cash App address validation remains intact.

Confirmation and pickup instructions are separate outbox jobs. Successful payment persistence schedules a prompt order-scoped attempt; the existing five-minute cron retries failures. Each kind has its own audit linkage and retry state. SMTP acceptance is not proof of inbox delivery.

Afterpay accepts equivalent state names and five-digit/ZIP+4 formatting, preserves full destination checks and exact totals, and recreates its request when fulfillment changes. Pickup uses `requestShippingContact: false`; optional provider pickup-location contact is omitted because pickup is by appointment and no fixed public street address is configured.

Emails share a quieter neutral design. Customer-visible legacy branding is replaced; historical migration text and internal storage/rate-limit identifiers remain unchanged for compatibility.

## Local evidence

| Check                           | Observed result                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit suite                      | 98 suites, 402 tests passed before final saved-message normalization; focused follow-up recorded below                                         |
| Integration suite               | 3 suites, 20 tests passed                                                                                                                      |
| Browser harness                 | All four suites passed; missing-shipping-phone continuation and missing-destination rejection subsequently passed in `shipping-validation.mjs` |
| Notification SQL rollback check | Passed: distinct jobs, replay, independent failure/retry, disjoint scoped/fallback claims, permissions                                         |
| Pickup SQL rollback check       | Passed: pickup/shipping for all five methods, contact persistence, reuse/conflict, validation, permissions                                     |
| TypeScript/build                | Next.js 16.3.3 build passed, including TypeScript and 97 static pages                                                                          |
| ESLint                          | No errors; 9 existing warnings                                                                                                                 |
| Email visual review             | Shipping confirmation and separate pickup instructions inspected at desktop and 390px mobile widths                                            |

Commands:

```powershell
npm run test:jest
npm run test:e2e
node scripts/test-checkout-notification-delivery.mjs
node scripts/test-checkout-pickup-contact.mjs
npm run typecheck
npm run lint
npm run format:check
doppler run --project solesneakers --config stg_ci -- node node_modules/next/dist/bin/next build
```

SQL scripts reject remote database URLs and roll back all test data/schema changes. Browser harnesses use real application components with mocked provider responses; they do not prove provider checkout completion.

## Live Sandbox matrix

Verified target: Vercel project `soles-stg`, `https://soles-stg.vercel.app`, Square Sandbox. Approved email recipient: `dsrush13@gmail.com`.

| Method       | Pickup               | Shipping             | Additional gate                                                   |
| ------------ | -------------------- | -------------------- | ----------------------------------------------------------------- |
| Credit card  | Blocked before quote | Blocked before quote | Test all seven card brands below                                  |
| Google Pay   | Blocked before quote | Blocked before quote | Native wallet account/payment sheet required                      |
| Apple Pay    | Not run live         | Not run live         | Compatible Apple device/browser required; current host is Windows |
| Cash App Pay | Blocked before quote | Blocked before quote | Complete Sandbox provider approval                                |
| Afterpay     | Blocked before quote | Blocked before quote | Verify native select-shipping and pickup screens                  |

The deployed baseline (`86e5c5b`) displayed **Checkout verification failed** before returning a quote in the controlled browser. Square Sandbox card fields loaded, but no payment or test email was submitted. Security controls were not disabled to force a result. Updated deployment outcomes must be recorded below before calling any live scenario passed.

For **both** pickup and shipping, test Visa, Mastercard, American Express, Discover, Diners Club, JCB, and UnionPay using the [official Square Sandbox card values](https://developer.squareup.com/docs/devtools/sandbox/payments). Every brand is currently unverified end to end. Also exercise invalid CVV, invalid postal code, expiration failure, generic decline, and supported SCA challenges using that same reference. Do not use real payment-card details.

## Edge-case coverage

| Behavior                                                                               | Evidence                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Missing pickup recipient/email/billing, separate recipient vs cardholder, cancellation | Schema/API tests and wallet browser continuation                            |
| Missing shipping phone, incomplete provider street address                             | Same-token continuation / fail-closed browser regression                    |
| Address corrections, edits, cancel, changed totals                                     | Browser checks preserve suggestion confirmation and payment reauthorization |
| Afterpay same ZIP but different street/apartment; ZIP+4; state names; pickup           | Helper tests and browser callback assertions; native provider unverified    |
| Duplicate clicks, idempotency, stock, payment permit, retries                          | Existing and added unit, browser and SQL checks                             |
| Confirmation plus pickup instructions, independent retry, sent-audit deduplication     | Worker/event tests and SQL rollback check; live SMTP/inbox pending          |

## Coordinated staging rollout

The two migrations and this application build form one release. Build the staging deployment before switching its stable domain. Pause new checkouts and notification cron execution, drain in-flight payments/reservations, apply `20260916090000_checkout_notification_delivery.sql` and `20260916091000_checkout_pickup_contact.sql`, then switch to the matching application and resume traffic/cron. Verify fresh shipping and pickup orders, saved contact, separate notification jobs, prompt SMTP acceptance, and retry after a controlled send failure.

Older application builds are incompatible with the required pickup RPC contact and new notification kind. Rollback requires a compatible application or a separately reviewed schema-and-code rollback; do not simply promote the old build. Existing pickup reservations without contact must expire/restart before payment. Static Supabase auth templates require their own staging configuration update; a Vercel deployment does not publish them.

No production migration or deployment is authorized by this work.

## Final staging outcome

Pending completion of the coordinated staging checks. Do not treat local checks as live payment, SMTP acceptance, or inbox-delivery evidence.
