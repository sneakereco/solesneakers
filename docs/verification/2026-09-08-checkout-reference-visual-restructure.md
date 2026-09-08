# Checkout Reference Visual Restructure Verification

**Date:** 2026-09-08  
**Branch:** `stg`  
**Scope:** Checkout composition, Square Card initialization, payment-method availability isolation, billing-address behavior, and reference styling.

## Automated Evidence

| Check | Result |
| --- | --- |
| Focused checkout suites | PASS — 11 suites, 33 tests |
| `npm run lint` | PASS — exit 0 |
| `npm run typecheck` | PASS — exit 0 |
| `npm run test:jest:unit` | PASS — 86 suites, 302 tests |
| `npm run test:jest:integration` | PASS — 3 suites, 20 tests |
| `npm run build` | PASS — exit 0; Next.js 16.3.3 compiled, typechecked, and generated 97 static pages |
| `git diff --check` | PASS |

The warning and error lines printed by the full Jest run are assertions from intentional error-path tests; Jest reported zero failed suites and zero failed tests.

## Verified Implementation Boundaries

- Square Card receives only the supported selector/property styling set; the unsupported `boxShadow` property that prevented Card attachment is absent.
- Square `Payments` is retained before Card initialization, so a Card create/attach failure does not prevent independent wallet capability checks.
- Apple Pay, Google Pay, Cash App Pay, and Afterpay each remain hidden until that Square method initializes successfully. One optional-method failure does not hide other ready methods.
- Card is the default regular method. Shipping can reuse its address for billing; separate shipping billing and all pickup payments require a complete billing address.
- The page includes the Sole header/direct cart link, Contact, Ship/Pickup Delivery, Payment, cart items, and totals. The explicitly excluded upsells, marketing controls, shipping-method chooser, protection, discount, free-shipping claim, saved-information prompt, and reassurance strip are absent.

## Browser Evidence Status

Local browser rendering reached `/checkout`, but the local data set contained no products and therefore no cart that could exercise checkout. No fake cart state or database seed was introduced. Reference screenshots at 1440px and 390px remain a deployed-staging evidence gate, including Card, separate billing, Pickup, and eligible Afterpay states.

Square owns the secure Card iframe's internal field arrangement and eligible-method rendering. Pixel comparison applies to application-owned layout outside those controls.

## Deployed Provider Gates

1. Card: confirm the Square iframe attaches on staging, no customer-facing load error appears, and a Sandbox tokenization reaches the payment flow.
2. Apple Pay: validate in supported Safari/device conditions after the Square domain association file and Sandbox/Production domain registrations are confirmed.
3. Google Pay and Cash App Pay: record availability and tokenization on supported browser/device/account combinations with an exact quote.
4. Afterpay: record seller/location eligibility, amount eligibility, exact quote/address behavior, redirect, and payment result.
5. Visuals: capture top, Delivery, Card, separate billing, Pickup, and eligible Afterpay states at desktop and mobile widths; add genuine card-brand assets only after the user supplies approved files.

No deployed-provider or pixel-equivalence claim is made until these staging checks are recorded.
