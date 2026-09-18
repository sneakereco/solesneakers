# Checkout repair validation

## September 18 repairs (local, not deployed)

Apple Pay shipping updates now replace the native sheet's total at the top level and clear its pending flag. Checkout allows provider popups through its COOP header; both cart entry points use document navigation so this header actually takes effect. The menu initially focuses its container while keyboard navigation retains a visible focus indicator. Processing copy and the shipping policy have been updated.

Payment metadata is recorded from direct payments, signed webhooks, and reconciliation. The selected checkout method supplies Apple Pay/Google Pay labels when Square reports only a card; card brand alone never establishes wallet identity. The admin list and detail page read the same persisted metadata. Historical payments are not automatically backfilled, and old card payments without a recorded wallet method cannot reliably be relabeled.

Apply `20260918140000_square_payment_details.sql` **before deploying the application**, because the admin queries require its new columns. The migration is additive and compatible with the prior application. No remote migration, deployment, or historical backfill has been performed. Run `doppler run --config dev -- node scripts/test-square-payment-details.mjs` for a local rollback check of replay safety, amounts, and permissions. Native Apple Pay shipping totals and Google Pay popup behavior still require real-device testing after deployment.

The reported missing emails were traced to successful SMTP handoff for the two supplied staging orders. The user confirmed they had checked the wrong inbox and withdrew that issue; no email behavior was changed.

Branch: `codex/checkout-cohesion`. Approved scope: September 15, 2026.

## What changed

Pickup name and phone now travel from checkout through the reservation, order, Square recipient, and staff pickup view. Buyer email remains authoritative for signed-in customers. Wallets can collect missing contact/billing details and continue with the existing token. Shipping wallets may complete recipient name/phone; the physical destination must still be supplied by the wallet. Normal card, Afterpay, and Cash App address validation remains intact.

Confirmation and pickup instructions are separate outbox jobs. Successful payment persistence schedules a prompt order-scoped attempt; the existing five-minute cron retries failures. Each kind has its own audit linkage and retry state. SMTP acceptance is not proof of inbox delivery.

Afterpay accepts equivalent state names and five-digit/ZIP+4 formatting, preserves full destination checks and exact totals, and recreates its request when fulfillment changes. Pickup uses `requestShippingContact: false`; optional provider pickup-location contact is omitted because pickup is by appointment and no fixed public street address is configured.

Emails share a quieter neutral design. Customer-visible legacy branding is replaced; historical migration text and internal storage/rate-limit identifiers remain unchanged for compatibility.

## Local evidence

| Check                           | Observed result                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit suite                      | 98 suites, 404 tests passed on the final application source                                                                                    |
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

Both the baseline (`86e5c5b`) and updated build (`c945d5e`) displayed **Checkout verification failed** before returning a quote in the controlled browser. Vercel request logs show HTTP 403 for `/api/checkout/quote`. The user confirmed the updated checkout calculates pickup totals in their normal browser. This distinguishes the automation block from the normal-browser behavior; it does not prove a completed payment. Security controls were not disabled to force a result.

Square's live Sandbox fields displayed the correct brand for Visa, Mastercard, American Express, Discover, Diners Club, JCB, and UnionPay using the [official Square Sandbox card values](https://developer.squareup.com/docs/devtools/sandbox/payments). This verifies field loading and brand recognition only. Every brand is still unverified end to end for **both** pickup and shipping. Also pending: invalid CVV, invalid postal code, expiration failure, generic decline, and supported SCA challenges using that same reference. Do not use real payment-card details.

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

On September 15, 2026 (EDT), deployed application commit `c945d5e438b6da7852ccb0a11a74102bcd9c044e` to Vercel project **soles-stg**. Deployment `dpl_33sa67ZmLgoLAXKW6cUBAimMB46t` / `https://soles-fibw26maj-sneakereco.vercel.app` is active at `https://soles-stg.vercel.app`. The deployment target is named `production` inside this staging-only Vercel project; the actual production project was not changed.

The application was built before migration. Checkout and cron were paused, zero in-flight payments/unexpired reservations were confirmed, both migrations were applied, and the matching build was promoted. Remote schema and service-role-only claim permissions were verified. Checkout is unlocked and cron is enabled against the new deployment. An older expired reservation was left untouched.

Readiness returned HTTP 200, `ready: true`, with the existing degraded-latency flag at 541ms. The check used the descriptive user agent `Solesneakers staging readiness verification/1.0`; the short default Node user agent was rejected by the existing proxy policy. No protection settings were changed.

Supabase project **soles-stg** (`byskzklzdgquamwzrljt`) received exactly three auth configuration updates: confirmation, magic-link, and recovery HTML bodies. A minimal temporary config preserved all undeclared settings; the CLI reported only those three changed properties. Their live inbox rendering remains unverified.

No test order/payment was created and no test email was sent in this session. The approved inbox remains `dsrush13@gmail.com`. The automated-browser block and Windows native-wallet limitations leave the live matrix, prompt SMTP timing, and inbox receipt pending. Next manual verification: complete one Sandbox pickup order in the normal browser, then inspect its saved contact and the separate confirmation/pickup outbox and audit records.

## September 16 loading follow-up (local only)

Checkout now retains one payment dialog in its shared layout through submission, cart clearing, client-side navigation, order polling, and receipt loading. Progress consistently reads “Processing your payment” with instructions to keep the page open and avoid submitting another payment. Provider approval can take focus without replacing the spinner; required contact, address, total, and error decisions remain explicit. Confirmation, cancellation, and checkout errors dismiss the retained dialog.

All five browser harnesses passed, including a regression that checks the same spinner DOM node survives route handoffs and an acceptance check across card, Afterpay, Cash App, and Google Pay. Native provider responses remain mocked. Unit checks passed after updating router mocks (97 suites passed in the initial full run; the corrected checkout-client suite and payment-method suite passed in the targeted rerun). Next.js build and formatting passed; lint reports zero errors and the same nine warnings. This follow-up has not been deployed to staging; the deployment above still serves the earlier implementation.
