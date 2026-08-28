# Square Checkout Launch Gates

Checkout remains publicly reachable but displays the unavailable state until every required gate below has an owner and dated evidence. The payment-link API also fails closed while the pricing gateway is unconfigured.

## Business decisions still required

- Select the tax calculation/provider approach and obtain written approval from the business's tax professional for nexus, product taxability, shipping taxability, pickup sourcing, filing jurisdictions, exemption handling, and refund treatment.
- Select the shipping price rule. Do not infer a flat rate from legacy product/category values without business approval.
- Confirm the pickup location and its tax jurisdiction.

The code intentionally contains no homemade tax-rate table or production zero-tax fallback.

## Square production controls

- Create separate sandbox and production credentials; store tokens and webhook signature keys only in Vercel encrypted environment variables.
- Configure the exact production notification URL ending in `/api/webhooks/square` and subscribe only to supported payment events until additional event processors are implemented.
- Confirm Risk Manager rules apply to API-created Payment Links for the production location.
- During the initial 60 days, require 3DS for every eligible online card payment and configure the approved high-risk, velocity, AVS, CVV, prepaid-card, and international-card actions.
- Keep Afterpay/Clearpay and tipping disabled. The implementation also disables customer-entered amounts, coupons, and loyalty redemption.
- Complete sandbox evidence for successful, declined, duplicate, altered-amount, high-risk, expired, late, and repeated-webhook cases.
- Define the human review and refund procedure for `review` orders. No `review` order may be fulfilled.

## Security and compliance gates

- Confirm SAQ A eligibility with Square/acquirer and name the annual SAQ owner.
- Contract a PCI SSC Approved Scanning Vendor and record the quarterly scan schedule and remediation owner.
- Enable phishing-resistant MFA where supported for Vercel, Cloudflare, Square, Supabase, Upstash, domain registrar, GitHub, and email administrators.
- Enable Vercel and Upstash spend alerts and test behavior at quota exhaustion.
- Apply the database migration in a staging Supabase project and run concurrent reservation, expiry, webhook replay, and late-payment tests against PostgreSQL.
- Verify seven-year evidence retention and restoration independently of Vercel runtime logs.
- Publish the Vercel firewall rule inventory and complete the DNS/direct-edge verification.
- Assign incident, dispute, refund, tax-filing, and security-patch owners.

## Required production secrets

| Variable                          | Purpose                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| `CHECKOUT_IDENTITY_HMAC_SECRET`   | Keyed email identity hashes for Upstash quotas                        |
| `CRON_SECRET`                     | Authenticates Vercel expiration invocations                           |
| `SQUARE_ENVIRONMENT`              | Must be `production` only in production                               |
| `SQUARE_ACCESS_TOKEN`             | Square server API credential                                          |
| `SQUARE_LOCATION_ID`              | Approved production selling location                                  |
| `SQUARE_WEBHOOK_SIGNATURE_KEY`    | Verifies Square webhook signatures                                    |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Exact HTTPS `/api/webhooks/square` URL used in signature verification |

Never expose these values through `NEXT_PUBLIC_*`, logs, support tickets, screenshots, or client bundles.

## Enablement sequence

1. Complete all business, Square, security, and compliance gates in sandbox/staging.
2. Implement and test the selected pricing gateway.
3. Deploy with the checkout kill switch still enabled.
4. Validate signed Square webhooks and the expiration cron in production.
5. Publish and observe Vercel bot/WAF rules.
6. Disable the checkout kill switch during a staffed launch window.
7. Monitor continuously and be ready to re-enable the switch without blocking webhooks.
