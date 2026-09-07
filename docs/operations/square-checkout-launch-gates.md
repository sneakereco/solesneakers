# Square Checkout Launch Gates

Checkout is publicly reachable and embeds Square Web Payments SDK fields when the emergency checkout lock is disabled. Keep that lock enabled in production until every required gate below has an owner and dated evidence. The prepare API also fails closed until the tenant flat shipping rate has been explicitly saved.

## Locked pricing decisions

- Square is authoritative for checkout tax. The application sends itemized, server-priced order lines with `autoApplyTaxes` enabled and persists only the tax and total returned by Square.
- Shipping uses one tenant-level flat rate stored in `tenant_checkout_settings.flat_shipping_cents`. It is charged once for shipping and never for pickup. There is no implicit default; `$0.00` must be saved explicitly when free shipping is intended.
- Confirm the production Square location, its pickup jurisdiction, and its Catalog taxes before checkout is enabled.
- For the ad hoc order lines used by this integration, every intended Square Catalog tax must be enabled and configured to apply to custom amounts. Otherwise Square can validly return zero tax.
- Obtain written approval from the business's tax professional for nexus/enrollments, product and shipping taxability, pickup sourcing, filing jurisdictions, exemption handling, and refund treatment.

The code intentionally contains no homemade tax-rate table or production tax estimate. Square's returned order is the pricing evidence. Square documents destination-aware automatic rates for Square Online/Online Ordering, while the Orders API documents Catalog-configured automatic taxes; therefore, sandbox and production evidence for every supported fulfillment/jurisdiction is a launch gate rather than an assumption.

## Square production controls

- Create separate sandbox and production credentials; store tokens and webhook signature keys only in Vercel encrypted environment variables.
- Configure the exact production notification URL ending in `/api/webhooks/square`. Subscribe to `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `dispute.created`, and `dispute.state.updated`; other event types fail validation and return `400`.
- Confirm Risk Manager rules apply to Web Payments SDK transactions for the production location.
- During the initial 60 days, require 3DS for every eligible online card payment and configure the approved high-risk, velocity, AVS, CVV, prepaid-card, and international-card actions.
- Enable Afterpay/Clearpay only after Square approves it for the production account and test both shipping and pickup eligibility. Tipping, customer-entered amounts, coupons, and loyalty redemption remain disabled.
- Complete sandbox evidence for successful, declined, duplicate, altered-amount, high-risk, expired, late, and repeated-webhook cases.
- Complete Square tax evidence for pickup and shipping addresses in every nexus state, including whether the flat shipping charge is taxable. Verify that the Square order tax, direct payment amount, and persisted local total match.
- Define the human review and refund procedure for `review` orders. No `review` order may be fulfilled.
- Verify the notification cron sends one order confirmation after a paid webhook and one refund confirmation after each completed Square refund; replaying the same event must not duplicate either notification.

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
| `TURNSTILE_SECRET_KEY`            | Server verification for strict guest checkout challenges              |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`  | Public Turnstile widget site key                                      |
| `SQUARE_ENVIRONMENT`              | Must be `production` only in production                               |
| `SQUARE_APPLICATION_ID`           | Public Square application identifier supplied to the Web Payments SDK |
| `SQUARE_ACCESS_TOKEN`             | Square server API credential                                          |
| `SQUARE_LOCATION_ID`              | Approved production selling location                                  |
| `SQUARE_WEBHOOK_SIGNATURE_KEY`    | Verifies Square webhook signatures                                    |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | Exact HTTPS `/api/webhooks/square` URL used in signature verification |

Only the Turnstile site key is intentionally public. The Square application and location IDs are non-secret identifiers returned by the prepare endpoint. Never expose access tokens, HMAC secrets, Turnstile secret keys, or webhook signature keys through `NEXT_PUBLIC_*`, logs, support tickets, screenshots, or client bundles.

## Enablement sequence

1. Complete all business, Square, security, and compliance gates in sandbox/staging.
2. Save the checkout flat shipping rate and validate Square Catalog tax plus Afterpay configuration.
3. Deploy with the checkout kill switch still enabled.
4. Validate signed Square webhooks and the expiration cron in production.
5. Publish and observe Vercel bot/WAF rules.
6. Disable the checkout kill switch during a staffed launch window.
7. Monitor continuously and be ready to re-enable the switch without blocking webhooks.
