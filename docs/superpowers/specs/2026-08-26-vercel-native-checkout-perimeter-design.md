# Vercel-Native Checkout Perimeter Design

**Status:** Approved adjustment to the Square checkout/security plan  
**Date:** 2026-08-26

## Decision

Sole Sneakers will use one HTTP security perimeter: Vercel. Cloudflare remains the authoritative DNS provider, but the storefront records that resolve to Vercel stay DNS-only (gray cloud). Cloudflare will not reverse-proxy the production storefront at launch.

The production request path is:

```text
Customer -> Cloudflare authoritative DNS -> Vercel CDN/WAF/BotID -> Sole Sneakers
                                                               -> Square-hosted checkout
Square webhook ------------------------------------------------> Sole Sneakers
```

This replaces the earlier idea of combining Cloudflare proxy/WAF controls with Vercel controls. A double proxy reduces Vercel's traffic visibility, complicates bot classification, caching, TLS, and incident diagnosis, and is not required for this launch.

## Platform Responsibilities

| Layer           | Owns                                                                                                                                       | Does not own                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Cloudflare Free | Authoritative DNS, DNSSEC, registrar/account protection                                                                                    | Storefront HTTP proxy, WAF, Bot Fight Mode, HTTP rate limiting, caching |
| Vercel Pro      | CDN, automatic DDoS mitigation, custom WAF rules, Bot Protection, BotID Basic, short-window edge rate limits, firewall observability       | Customer/email/account daily quotas or payment authorization            |
| Sole Sneakers   | Server-side cart validation, inventory reservation, order state, identity/device quotas, idempotency, audit evidence, checkout kill switch | Card-data collection                                                    |
| Square          | Hosted card-entry page, payment authorization, processor risk signals, payment lifecycle                                                   | Sole Sneakers inventory truth or fulfillment authorization              |

## Cloudflare Configuration

- Keep Cloudflare nameservers and DNS management.
- Enable DNSSEC after confirming the registrar supports the Cloudflare DS record.
- Require phishing-resistant MFA or, at minimum, TOTP MFA on every Cloudflare administrator account.
- Set the production apex and `www` records that target Vercel to **DNS only**.
- Do not enable the orange-cloud proxy, Cloudflare WAF rules, Bot Fight Mode, HTTP rate limiting, cache rules, Workers routes, or Transform Rules for the production storefront.
- Cloudflare Turnstile is not a launch dependency. It remains an optional step-up control if post-launch evidence shows that Vercel BotID Basic is insufficient.

## Vercel Configuration

- Vercel is the only public HTTP edge for the storefront.
- Enable automatic DDoS mitigation and retain Attack Challenge Mode as a time-limited incident response control.
- Configure Bot Protection in log mode first, validate legitimate traffic, add scoped exclusions, and then change it to challenge mode.
- Protect `POST /api/checkout/payment-link` with BotID Basic in application code.
- Apply fixed-window WAF rate limits to `POST /api/checkout/payment-link` using both IP and JA4 signals where the dashboard permits separate rules.
- Challenge checkout-link creation from outside the United States because the initial shipping and pickup market is US-only. Do not country-block ordinary catalog browsing.
- Bypass browser/bot challenges only for exact webhook paths. A bypass must not disable signature verification or broadly exempt `/api/webhooks/*`.
- Keep Square, Shippo, and future trusted webhooks on distinct exact routes.

## Application Controls

`POST /api/checkout/payment-link` is the only browser-facing operation allowed to create a Square-hosted checkout. It must perform these checks in order before calling Square:

1. Reject the request if the checkout kill switch is enabled.
2. Require a valid BotID Basic verdict in production.
3. Enforce application limits by trusted Vercel client IP, authenticated account when present, normalized email hash, and device/session identifier.
4. Validate the cart using current server-side product prices and inventory; ignore client-supplied totals.
5. Reuse an unexpired payment link for the same order/cart idempotency key instead of creating another Square object.
6. Atomically reserve inventory with a short expiration.
7. Create the pending local order and audit event.
8. Create the dynamic Square Payment Link and return only its hosted URL.

Checkout-specific application limiting fails closed: if BotID, Upstash, inventory reservation, or required configuration is unavailable, the route returns `503` and does not contact Square. General catalog browsing may continue.

Initial application thresholds:

- 3 payment-link creation attempts per trusted client IP per 10 minutes at Vercel.
- 5 payment-link creation attempts per normalized email/account per 24 hours in Upstash.
- 10 payment-link creation attempts per device/session per 24 hours in Upstash.
- Do not duplicate Vercel's short-window IP or JA4 counters in Upstash.
- Repeated requests using the same valid idempotency key return the existing unexpired link and do not increment the count as new payment attempts.

Thresholds are launch defaults, not permanent fraud conclusions. Review Vercel, application, and Square evidence weekly during the first 60 days and tune them based on false positives and attack patterns.

## Checkout and Kill-Switch Semantics

The storefront and `/checkout` route are public. They are not access-locked.

Today, `app/checkout/page.tsx` and `app/checkout/start/page.tsx` render `CheckoutUnavailable` unconditionally because no active provider flow is wired into those pages. The `tenant_store_access_settings.checkout_lock_enabled` value defaults to `false` and will remain an independently controlled emergency payment kill switch.

When Square checkout is implemented:

- An unlocked checkout renders the real pre-checkout flow.
- A locked checkout renders `CheckoutLockedNotice` with the configured message.
- The API independently checks the kill switch; hiding or changing the page can never bypass it.
- Enabling the checkout lock stops new payment links but does not stop signed Square webhooks from completing already-started payments.

## Webhooks

- `POST /api/webhooks/square` is not protected by BotID, CSRF, or a browser challenge.
- It must verify Square's webhook signature against the exact production notification URL and raw request body before parsing or mutating state.
- It must persist the Square event ID under a uniqueness constraint before applying state transitions so retries are idempotent.
- Webhook success, not the customer redirect, is authoritative for marking an order paid and permitting fulfillment.
- Invalid signatures return `401`; already-processed events return `200`; transient internal failures return a retryable `5xx`.

## Square Risk and Payment-Link Lifecycle

- Enable Square Risk Manager for the production location and verify in that account that its rules apply to API-created Payment Links.
- During the first 60 days, invoke 3DS for every eligible online card payment and decline configured high-risk, AVS-mismatch, invalid-CVV, velocity, prepaid-card, and international-card cases according to the approved launch rules.
- Disable Afterpay at launch because Square Risk Manager does not cover Afterpay transactions.
- Disable tipping and customer-entered amounts; every link must contain the server-calculated order amount.
- Risk-alerted payments enter `review` and cannot be fulfilled until explicitly cleared.
- When an inventory reservation expires, deactivate/delete its Square Payment Link before releasing inventory. A payment arriving after expiration must enter `review` and trigger the late-payment refund/exception workflow rather than decrementing already-released inventory.

## Compliance and Evidence

- Confirm SAQ A eligibility with Square/acquirer, complete the applicable annual SAQ, and arrange quarterly external vulnerability scans with a PCI SSC Approved Scanning Vendor before launch.
- Store checkout, consent, payment, webhook, risk-review, fulfillment, delivery, refund, and dispute evidence in Supabase or protected object storage for seven years. Vercel's runtime-log retention is troubleshooting data and is not the evidence system.
- Apply critical security patches within one month and document the dependency/security review cadence.
- Square `dispute.created` notifications are standard dispute notifications, not confirmed Verifi/Ethoca pre-dispute alerts. True pre-dispute alert coverage remains explicitly deferred and requires a separate provider decision.
- Configure Vercel and Upstash spend alerts before enabling production checkout. Upstash is a separate service and its quota exhaustion behavior must be tested.

## Monitoring and Incident Response

- Review the Vercel Firewall dashboard and BotID verdicts daily for the first 14 launch days, then weekly.
- Alert on spikes in payment-link attempts, `403`, `429`, or checkout-specific `503` responses; repeated payment failures; and webhook signature failures.
- During an active broad attack, enable Vercel Attack Challenge Mode temporarily, confirm webhook exclusions still work, and disable it after traffic normalizes.
- Do not respond to an attack by turning on Cloudflare proxying. Changing the edge during an incident would change client-IP semantics and complicate diagnosis.

## Deferred Options

- Cloudflare Turnstile may be introduced as a targeted step-up challenge only after an observed need. It can operate without Cloudflare proxying.
- Vercel BotID Deep Analysis may be enabled on `POST /api/checkout/payment-link` after a measured cost/benefit review; it is not assumed to be included in the monthly Pro platform fee.
- Cloudflare proxy/WAF adoption requires a separate architecture review and would replace, not casually stack with, the Vercel edge strategy.

## Launch Acceptance Criteria

- Public DNS resolves directly to the Vercel-configured target and Cloudflare shows gray-cloud status for the storefront records.
- Vercel receives the original client signals and reports no reverse-proxy warning.
- Automated requests cannot create a Square payment link without passing BotID and both edge/application limits.
- Square and Shippo webhook test deliveries succeed while browser-bot challenges are enabled.
- Invalid webhook signatures cannot mutate orders or inventory.
- The checkout kill switch blocks new payment links without blocking existing payment webhooks.
- No card number, CVV, or full payment credential enters Sole Sneakers logs, database, analytics, or browser code.
- Square Risk Manager, 3DS rules, AVS/CVV rules, and alert delivery are verified on the production location; Afterpay and tipping are disabled.
- Expiring a reservation deactivates its Square Payment Link before inventory is released, and a late payment cannot authorize fulfillment.
- SAQ A eligibility, annual SAQ ownership, and quarterly ASV scanning are recorded.
- Vercel and Upstash spend alerts are active, and seven-year evidence storage does not depend on Vercel runtime-log retention.

## Primary References

- Vercel, “Should I use Cloudflare in front of Vercel?”: https://vercel.com/kb/guide/cloudflare-with-vercel
- Vercel Firewall: https://vercel.com/docs/vercel-firewall
- Vercel BotID: https://vercel.com/docs/botid
- Cloudflare proxy status: https://developers.cloudflare.com/dns/proxy-status/
- Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
