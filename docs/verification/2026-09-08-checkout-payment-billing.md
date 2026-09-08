# Checkout Payment and Billing Verification

**Date:** 2026-09-08
**Branch:** `stg`

## Automated Evidence

| Check | Result |
| --- | --- |
| Checkout-focused Jest run | 9 suites, 45 tests passed |
| Full Jest unit run | 80 suites, 290 tests passed |
| Full Jest integration run | 3 suites, 20 tests passed |
| TypeScript | `npm run typecheck` passed |
| ESLint | `npm run lint` passed |
| Production build | `npm run build` passed; 97 routes generated |
| Diff whitespace | `git diff --check` passed |

The full unit suite emitted expected warning/error logs from tests that intentionally exercise Shippo, CSRF, bot, and Square webhook failure paths. No test failed.

## Behaviors Covered

- Card is the default regular payment method and Afterpay is the only alternate regular method.
- Visa, Mastercard, American Express, and `+5` accepted-brand indicators render in the Card row.
- Shop Pay, PayPal, and Klarna do not render.
- Shipping defaults to using the shipping address for billing.
- Separate billing fields normalize and validate United States addresses.
- Pickup requires the separate billing form.
- Card tokenization receives the cardholder name and resolved billing contact.
- Afterpay's Square PaymentRequest receives the resolved billing contact.
- Card/Afterpay prepare requests require billing while express wallets retain wallet-owned contact collection.
- Billing and payment method participate in checkout idempotency identity.
- The service-role reservation RPC inserts `order_billing` in the order/inventory transaction.
- Checkout inputs suppress the legacy global red focus outline and retain the black/zinc focus border.

## Local Browser Result

The isolated local browser successfully loaded the development storefront and `/checkout`. Its cart was empty and the local catalog reported zero products, so the checkout form could not be reached through normal customer UI actions. No fake local-storage cart or temporary production route was injected.

Visual hierarchy is covered by server-rendered component tests. Provider iframe appearance and interactive payment selection still require a staging browser after deployment.

## Staging Checks

1. Apply `20260908120000_square_checkout_billing_snapshot.sql` before deploying application code.
2. Open a product checkout and verify desktop plus mobile Card layout, billing toggle, pickup billing, and focus state.
3. Complete one Square Sandbox Card payment and confirm exactly one matching `order_billing` row.
4. With an eligible exact quote, select Afterpay and confirm the redirect copy, billing choice, and Afterpay handoff.
5. Confirm ineligible payment methods produce one safe `Square payment method unavailable` warning without disabling Card.
