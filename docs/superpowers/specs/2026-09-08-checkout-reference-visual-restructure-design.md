# Checkout Reference Visual Restructure Design

**Status:** Approved
**Date:** 2026-09-08
**Extends:** `2026-09-07-single-page-checkout-overhaul-design.md`, `2026-09-08-checkout-payment-billing-design.md`, and `2026-09-08-express-wallet-address-design.md`
**Supersedes:** The earlier checkout composition and decorative card-brand-mark decisions where they conflict with this document.

## Decision

Restructure the checkout into focused modules and reproduce the supplied reference checkout as closely as possible while retaining Sole Sneakers branding, Square-hosted payment controls, server-authoritative pricing, existing fulfillment rules, and all payment-abuse protections.

The visual target is pixel-equivalent outside Square-owned secure iframes. Inside the Card iframe, the application uses only Square-supported selectors and properties and accepts Square's provider-controlled field arrangement and responsive behavior.

## Page Composition

The desktop checkout has a full-width, non-sticky header followed by a centered two-column checkout body. The header appears only at the top of the document; it does not remain fixed while scrolling. It uses the existing Sole Sneakers logo and a cart control that navigates directly to `/cart` rather than opening the storefront cart drawer.

The left column contains, in order:

1. Express checkout;
2. Contact;
3. Delivery;
4. Payment;
5. the final payment action.

The right column contains only the products already in the cart and the subtotal, flat shipping, tax, and total. It does not contain recommendations, upsells, insurance, shipping-progress messaging, protection controls, or a discount-code field.

On mobile, the order summary appears before the checkout form. All content becomes one column without horizontal scrolling. The document header remains in normal flow.

## Explicit Exclusions

Do not render:

- location, customer-count, or review-count marketing claims;
- additional-product or "Other Also Bought" content;
- free-shipping progress, shipping insurance, or protection coverage;
- email or SMS marketing consent, saved-information promotion, reassurance icons, or discount entry;
- a customer-selectable shipping-method section.

The configured flat shipping price remains visible in totals, but the seller chooses the carrier/service outside checkout.

## Modular Architecture

Preserve the existing server page-data, quote, prepare, reservation, permit, payment, webhook, cart, authentication, shipping, pickup, and tax boundaries. Do not duplicate authoritative pricing or fulfillment logic in the browser.

Split presentation and provider behavior into focused checkout modules:

- checkout header and responsive page shell;
- contact, delivery, and order-summary sections;
- express wallet area with one independent adapter/state per Square method;
- payment-method panel, Square Card host, and billing-address controls;
- shared provider diagnostics and availability state.

`CheckoutClient` remains the form and payment-pipeline coordinator, but it no longer owns large blocks of unrelated markup. Square method creation, attachment, teardown, availability, and failure state are isolated so one optional method cannot prevent another method or Card from loading.

## Contact and Authentication

Contact contains a required email field and no marketing checkbox.

For a guest, the section includes a Sign in link. For an authenticated customer, the link is absent and the account email is prefilled. Existing profile defaults remain available for fulfillment fields. Authentication status is supplied by the server page-data boundary and is not inferred in the browser.

## Delivery

Delivery retains the Ship/Pickup segmented control and matches the supplied spacing, borders, typography, and selected states.

Shipping shows country, first name, last name, address, optional apartment/suite, city, state, ZIP code, and phone. It does not show a selectable shipping method because Sole Sneakers uses the configured flat rate and selects fulfillment service operationally.

Pickup shows the available pickup location and readiness information using existing authoritative location data. It omits shipping-only address fields.

## Express Checkout

Express checkout supports Apple Pay, Google Pay, and Cash App Pay. Each button renders only after the corresponding Square SDK method initializes successfully for the current browser, account, location, and quote state. Unsupported or unavailable methods stay hidden without disabling other methods or Card.

Google Pay and Cash App Pay attach to their provider containers. Apple Pay uses the required immediate-click tokenization path and Square-supported custom button presentation. The application must not display inactive imitations of unavailable wallet buttons.

Apple Pay remains externally gated by HTTPS, supported Safari/device conditions, the Square domain association file, and separate Sandbox/Production domain registration.

## Payment Panel

Credit card is selected initially. Eligible Afterpay appears as a separate selectable row below Card, not in Express checkout. Selecting Afterpay collapses the Card area and shows the approved redirect explanation.

The Card panel contains:

- the Square-hosted Card control;
- the application-owned required `Name on card` input;
- `Use shipping address as billing address`, checked initially for shipping;
- the complete billing-address form when a different address is required.

Pickup has no shipping address to reuse and therefore requires the billing form. Existing normalized billing, immutable order snapshot, idempotency, and Square billing-contact behavior remain unchanged.

Accepted-card artwork must use genuine supplied assets. Do not construct payment logos from CSS shapes or arbitrary text. Until approved assets are available, preserve layout space or omit the artwork without misrepresenting accepted brands.

## Square Card Styling Boundary

Pass style configuration through `payments.card({ style })` using documented Square selectors such as `.input-container`, focus/error variants, `input`, placeholder variants, and message selectors. Use only properties allowed for each selector.

The visual target uses white inputs, restrained neutral borders, the approved corner radius, reference typography, and clear focus/error states. Unsupported properties such as `boxShadow` must not be sent to the Card SDK. Application CSS must not attempt to pierce or override the Square iframe.

Square controls secure-field order, grouping, placeholder behavior, internal spacing, and responsive layout. These provider-owned details are exempt from literal pixel equality.

## Provider State and Error Handling

Each payment method has independent `loading`, `ready`, `unavailable`, and `failed` states.

Card initialization failure preserves all non-card input and presents an actionable retry. Optional wallet or Afterpay failure hides only that option. A failed Card style or attachment must not be silently reduced to an untraceable generic error: sanitized diagnostics record the method, phase, error class, and safe message without exposing secrets, card data, or fraud decisions.

The final payment action remains disabled until required visible fields are valid, the quote is exact, and the selected method is ready. A stale quote refreshes inline and cannot authorize a changed total.

## Accessibility

Delivery and payment choices use semantic controls with visible keyboard focus and programmatic selected state. Labels and errors remain associated with their controls. Status announcements are restrained and do not repeat provider noise.

Genuine card-brand assets receive accessible labels only when they communicate accepted methods; purely decorative copies are hidden from assistive technology. Logical keyboard order follows the visible document order on desktop and mobile.

## Verification

Automated and browser verification must cover:

- guest Sign in visibility, authenticated email prefill, and marketing-control absence;
- shipping/pickup switching, flat-rate totals, and absence of a shipping-method chooser;
- Card load/retry, same/different billing address, and provider-failure isolation;
- eligible Apple Pay, Google Pay, Cash App Pay, and Afterpay behavior without fake fallbacks;
- desktop/mobile visual comparison against the supplied reference, with explicit Square iframe exemptions.

The focused checkout suites run before full lint, typecheck, Jest, and production build. Staging browser evidence must confirm the deployed Square SDK, CSP, supported wallet environments, Apple Pay domain setup, and Afterpay account/amount eligibility.

## Non-Goals

- Adding Shop Pay, PayPal, Venmo, Klarna, ACH, or gift cards.
- Saving cards or automatically saving billing addresses.
- Replacing Square-controlled secure-field layout.
- Weakening Turnstile, BotID, rate limits, permits, idempotency, webhook authority, inventory reservation, or server-authoritative totals.
- Adding recommendations, checkout upsells, insurance, discounts, marketing opt-ins, or selectable shipping services.

## Primary References

- Square Card styling: https://developer.squareup.com/docs/web-payments/customize-styles
- Square Card selectors: https://developer.squareup.com/reference/sdks/web/payments/objects/CardClassSelectors
- Square Google Pay: https://developer.squareup.com/docs/web-payments/google-pay
- Square Apple Pay: https://developer.squareup.com/docs/web-payments/apple-pay
- Square Afterpay/Clearpay: https://developer.squareup.com/reference/sdks/web/payments/afterpay-clearpay
- Square Web Payments exception handling: https://developer.squareup.com/docs/web-payments/exception-handling
