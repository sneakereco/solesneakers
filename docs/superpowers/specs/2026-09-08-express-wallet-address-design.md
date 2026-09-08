# Express Wallet Address Design

**Status:** Approved
**Date:** 2026-09-08
**Extends:** `2026-09-07-single-page-checkout-overhaul-design.md`

## Decision

Eligible Apple Pay and Google Pay methods initialize from the current preliminary or exact server quote. For shipping, the Square payment request asks the wallet for its stored shipping contact. Because Square can redact that pre-authorization contact, the application uses only its US state and postal code to request the tax and shipping quote returned to the wallet.

After authorization, Square returns the full shipping contact in the token result. The application validates that address with the existing checkout contract, requests a final exact quote, requires its total to match the amount approved in the wallet, updates the visible contact/address and totals, and only then enters prepare.

Cash App Pay and Afterpay remain exact-quote methods because their current integration does not provide the same pre-tokenization shipping-contact contract. Card checkout continues to use the visible form.

## Security Boundary

A preliminary quote can display a wallet but cannot authorize payment. Wallet tokenization may proceed only while the wallet sheet is obtaining the address; final prepare requires the exact quote fingerprint and the same normalized wallet address. Existing Turnstile, payment-permit, inventory reservation, idempotency, webhook, and reconciliation controls remain unchanged.

## Failure Behavior

An invalid redacted destination, incomplete full token address, non-US address, failed exact quote, or changed final total returns an inline wallet error and never reaches prepare. Unsupported methods stay hidden, with a safe method name and error class written to the browser console for diagnosis.

## Testing

- A preliminary quote creates Apple Pay and Google Pay payment requests.
- A redacted wallet destination is quoted for the wallet and the full token address is separately validated and requoted before prepare.
- A preliminary quote cannot prepare or pay without the exact wallet quote.
- Pickup and already-complete shipping continue to use the existing exact quote.
