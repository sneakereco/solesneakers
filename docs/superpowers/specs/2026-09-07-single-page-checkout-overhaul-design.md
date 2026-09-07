# Single-Page Checkout Overhaul Design

**Status:** Approved  
**Date:** 2026-09-07  
**Extends:** `2026-09-06-square-web-payments-strict-guest-security-design.md`

## Decision

Replace the current prepare-then-reveal checkout with a complete checkout that is visible as soon as `/checkout` renders. The page will closely follow the supplied two-column reference while retaining Sole Sneakers branding, Square-hosted payment fields, server-authoritative prices, inventory controls, and payment-abuse protections.

The browser must not create a local reservation or persistent Square Order merely to display the checkout. A new quote boundary will preview Square pricing without reserving inventory. The existing protected prepare and payment boundaries remain authoritative when the customer submits payment.

## Initial Customer Experience

On the initial desktop render, the page shows:

- a left checkout column containing express wallets, Contact, Delivery, the applicable address/contact fields, Payment, and one final Pay button;
- a right order-summary column containing only purchased products and subtotal, shipping, tax, and total;
- Shipping selected by default, with the complete shipping form visible;
- Square card fields mounted and usable immediately;
- Apple Pay, Google Pay, Cash App Pay, and Afterpay containers in their final positions, with methods enabled only after Square reports them eligible and an exact quote exists.

There is no intermediate `Continue to secure payment` or `Update order` action. There are no newsletter or SMS consent controls, selectable shipping-speed section, saved-information promotion, reassurance-icon strip, discount entry, shipping insurance, product recommendations, or other upsells.

On mobile, the same information becomes one column. The compact order summary appears before the form so the customer can verify the cart without opening a separate view. All required checkout sections remain on the page.

## Form Behavior

Contact email is required. Signed-in customers receive their account email and saved `shipping_profiles` values as initial form values. Account email and profile name are fallbacks when a saved shipping field is absent. Guest fields start empty.

The `/checkout` server component supplies the client with the public Square application ID, location ID, environment, authenticated profile defaults, and checkout-access result. Secret Square credentials never cross this boundary.

Shipping requires full name, phone, country, street address, optional second address line, city, state, and postal code. Pickup removes only irrelevant street-address fields and shows the pickup contact and location information. Changing fulfillment or an address field invalidates the prior quote but does not unmount the card fields or hide any checkout section.

Native HTML autocomplete and validation attributes remain the baseline. Validation errors appear beside their field or section and focus the first invalid field after submission.

## Order Summary and Quotes

The client cart provides the immediate product rows and display-only subtotal. The server remains authoritative for item availability and every amount used for payment.

Before a complete shipping address exists, the summary shows:

- server-configured flat shipping when available;
- `Calculated after address` for tax;
- an explicitly estimated total.

On initial render, the client requests a preliminary server quote containing authoritative cart subtotal and flat shipping but no tax. Pickup can request an exact quote immediately. Once the shipping fields are complete, the client requests an exact quote after a short debounce. A new `POST /api/checkout/quote` endpoint will:

1. apply checkout access, bot, request-shape, and rate-limit protections appropriate to a non-mutating pricing request;
2. resolve the cart from current server product and inventory data;
3. resolve the configured category flat shipping charge;
4. return a preliminary subtotal, shipping, estimated total, and incomplete status when shipping destination fields are absent;
5. otherwise call Square `CalculateOrder` with the complete proposed order;
6. return server-calculated subtotal, shipping, tax, total, completeness status, and a quote fingerprint without creating an order or inventory reservation.

The quote response uses `Cache-Control: no-store`. Stale responses cannot replace a newer form state. Quote failure leaves payment disabled and provides a retry action without clearing entered customer or card data.

## Shared Square Order Construction

Extract one pure Square order payload builder used by both `CalculateOrder` and `CreateOrder`. It receives server-resolved items, fulfillment, shipping amount, buyer contact, and shipping address. This is the only implementation of line items, shipping service charge, fulfillment details, and automatic-tax options.

The quote path reads totals from the calculated order. The final prepare path creates a persistent order from the same normalized inputs and rejects any mismatch among the current cart, quote fingerprint, created Square Order, and local reservation amounts.

Square `CalculateOrder` is a preview only. It cannot reserve inventory, create local orders, issue guest-access tokens, or make the cart fulfillment-ready.

## Payment Methods

The regular Payment section supports Card and eligible Afterpay/Clearpay. The express section supports the Square Web Payments SDK methods available for this US storefront:

- Apple Pay;
- Google Pay;
- Cash App Pay.

Unsupported methods are hidden after Square/browser capability detection. Shop Pay, PayPal, Venmo, and Klarna are not part of this Square integration. ACH and Square Gift Cards are outside this overhaul because they are not requested express-wallet methods.

Card creation and attachment require only Square's public application and location configuration, so the secure card fields mount during initial checkout setup. Wallets and Afterpay require an exact amount; their page positions render immediately, but their actionable SDK instances are created or updated only from the current exact quote.

All methods use the same final payment pipeline:

```text
validated visible form + current exact quote
  -> prepare and reserve server-authoritative order
  -> obtain matching one-use payment permit
  -> Square tokenization and buyer verification
  -> CreatePayment
  -> signed webhook settlement
```

Payment submission revalidates the cart and quote before tokenization. A stale quote triggers an inline refresh rather than charging a changed amount. Card fields remain mounted during quoting and preparation.

## Security and Provider Configuration

The checkout Content Security Policy will allow only the documented origins required by the Square production and sandbox SDKs. The policy must cover Square scripts, frames, connections, stylesheets, and fonts, including Square's documented telemetry connection. Tests must assert each directive rather than merely checking whether a hostname appears somewhere in the policy.

Cloudflare Turnstile remains mandatory for guest payment permits. Client error `110200` is a non-retryable hostname configuration failure. The UI shows one actionable verification error instead of allowing repeated retry noise. Separately, the Turnstile widget must authorize `soles-stg.vercel.app` in Cloudflare Hostname Management; code cannot repair that external setting.

Add a real `app/favicon.ico` derived from the existing Sole Sneakers brand asset. Generic `c.js` console messages do not justify removing BotID or analytics. Browser validation will identify their owning script and confirm whether they affect checkout before any security control is changed.

## Error Presentation

Errors are owned by the affected boundary:

| Boundary                | Customer behavior                                                                 |
| ----------------------- | --------------------------------------------------------------------------------- |
| Profile prefill         | Keep checkout usable with blank editable fields                                   |
| Quote                   | Preserve input, mark totals unavailable, disable payment, offer retry             |
| Unsupported wallet      | Hide that wallet without affecting Card                                           |
| Square field loading    | Keep entered non-card data and show a Payment retry                               |
| Turnstile configuration | Disable guest payment and show a configuration/support message                    |
| Validation              | Mark the relevant fields and focus the first invalid field                        |
| Prepare or payment      | Preserve safe input, show sanitized retry/decline state, prevent duplicate charge |

Provider details, card-validation specifics, secrets, and fraud-rule outcomes are never exposed to the customer.

## Accessibility and Responsive Requirements

Delivery choices and payment choices use semantic controls with visible focus states, labels, and selected state. Status updates use restrained live regions. The two-column boundary must not alter logical keyboard order. Error text is associated with its field or section.

At desktop width, the order summary remains visible alongside the form without obscuring the final Pay action. At mobile width, content does not horizontally scroll, wallet buttons wrap cleanly, Square fields retain their supported minimum width, and the summary/form order remains predictable.

## Testing

Automated coverage must prove:

- the complete checkout skeleton, order summary, card container, and payment choices render before any customer click;
- signed-in profile prefill and guest blank-state behavior;
- fulfillment changes update relevant fields and invalidate quotes without unmounting card fields;
- late quote responses cannot overwrite newer state;
- quote calls never reserve inventory or create persistent Square Orders;
- CalculateOrder and CreateOrder receive payloads from the same builder;
- stale or mismatched quotes cannot reach tokenization or `CreatePayment`;
- every payment method uses the existing permit and payment protections;
- CSP directives contain the exact documented Square origins;
- desktop and mobile layouts match the approved information hierarchy.

Focused unit and integration tests run before the complete lint, typecheck, Jest, production-build, and browser suites.

## External Validation and Launch Gates

Staging validation requires:

1. add `soles-stg.vercel.app` to the Turnstile widget hostnames and confirm guest token issuance;
2. register the staging Apple Pay domain and later register the production domain separately;
3. validate shipping and pickup quote/order total equality in Square Sandbox;
4. validate Card, eligible Afterpay, Apple Pay, Google Pay, and Cash App Pay on supported real browsers/devices;
5. complete one staffed low-value production purchase and refund only after all existing launch controls are ready.

Rendering a wallet button is not payment proof. Each method remains gated until tokenization, payment, webhook settlement, receipt behavior, and refund evidence are recorded.

## Non-Goals

- Shop Pay, PayPal, Venmo, Klarna, ACH, or gift-card integration.
- Customer card storage or a Sole Sneakers fast-checkout account feature.
- Promotional consent, discount codes, insurance, recommendations, or checkout upsells.
- Replacing Square as payment authority or calculating authoritative prices in the browser.
- Weakening BotID, Turnstile, velocity limits, one-use permits, idempotency, webhook authority, or inventory reservation controls.

## Primary References

- Square Web Payments SDK: https://developer.squareup.com/reference/sdks/web/payments
- Square CalculateOrder: https://developer.squareup.com/reference/square/orders-api/calculate-order
- Square payment options: https://developer.squareup.com/docs/online-payment-options
- Square CSP requirements: https://developer.squareup.com/docs/web-payments/content-security-policy
- Square Apple Pay: https://developer.squareup.com/docs/web-payments/apple-pay
- Cloudflare Turnstile client errors: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
