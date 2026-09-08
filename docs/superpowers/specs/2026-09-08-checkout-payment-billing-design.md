# Checkout Payment and Billing Design

**Status:** Approved
**Date:** 2026-09-08
**Extends:** `2026-09-07-single-page-checkout-overhaul-design.md`

## Decision

Replace the detached card and Afterpay buttons with one cohesive Payment panel. Credit card is selected by default. Afterpay is a second selectable method inside the same panel, not an express-checkout method. The panel collects a verified billing contact for Card and Afterpay, passes it to Square where the SDK supports it, and stores one immutable `order_billing` snapshot with the reserved order.

Apple Pay, Google Pay, and Cash App Pay remain in Express checkout. Shop Pay, PayPal, and Klarna remain excluded.

## Payment Panel

The Payment heading and the copy `All transactions are secure and encrypted.` appear above a rounded, bordered method panel.

The first row is Credit card and is selected initially. It contains Visa, Mastercard, American Express, and `+5` accepted-card indicators. These indicators are local decorative brand marks with accessible labels; they do not claim that a specific card has been detected.

When Credit card is selected, the expanded area contains:

- the Square-hosted card entry form;
- a required application-owned `Name on card` field;
- `Use shipping address as billing address` for shipping orders, checked initially;
- the complete billing form when that control is unchecked.

Square owns card number, expiration, security code, and any issuer-dependent postal-code input. The application styles the supported Square card selectors to match the approved white fields, rounded borders, neutral error treatment, and blue/black focus treatment. The application never renders, reads, or stores raw card data.

The second method row is Afterpay and is rendered only when Square successfully initializes the method for the current exact quote. It uses Square's custom-button attachment mode so the application can present the approved selectable row while Square remains the payment-method authority. Selecting it collapses card fields and displays `You'll be redirected to Afterpay to complete your purchase.` The final payment button remains the only submission action.

## Billing Behavior

Billing data has this normalized shape:

```ts
type CheckoutBillingAddress = {
  givenName: string;
  familyName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};
```

For shipping checkout, billing defaults to the validated shipping address. The shipping full name is split into given and family names for Square; the separately entered cardholder name is used as the Card billing-contact name. Unchecking the default reveals separate billing fields for country, first name, last name, address, optional apartment, city, state, ZIP code, and optional phone.

For pickup checkout there is no shipping address to reuse. The separate billing form is immediately visible and required. The unavailable `same as shipping` choice is not shown as actionable.

Afterpay uses the same billing choice. For shipping it shows `Same as shipping address` and `Use a different billing address`; for pickup it requires the different-address form. The normalized billing contact is included in the Afterpay PaymentRequest before the Afterpay instance is created.

Changing fulfillment from shipping to pickup immediately invalidates the `same as shipping` selection and exposes the billing form. Returning to shipping restores the default only when the customer has not intentionally entered a separate billing address during the current checkout.

## Request and Persistence Boundary

`POST /api/checkout/prepare` receives the selected payment method and a normalized billing address for Card and Afterpay. The server validates every billing field. Express wallet methods retain their wallet-owned contact flow and are not forced through the visible billing form.

The billing address participates in the checkout idempotency/cart hash for Card and Afterpay. Reusing an idempotency key with a different billing address fails closed instead of silently changing the order snapshot.

The reservation RPC accepts `p_billing_address jsonb`. In the same database transaction that creates the order and reserves inventory, it inserts one `order_billing` row. A reused reservation may return the existing matching snapshot but cannot overwrite it. No checkout path calls `upsertUserBillingAddress`; billing is never automatically saved to the customer profile.

If atomic billing persistence fails, the reservation statement fails and inventory/order creation rolls back. A billing snapshot is not allowed to be best-effort data written after reservation.

## Square Integration

Card tokenization receives the authoritative prepared total and a `billingContact` assembled from the selected billing address, buyer email, optional phone, and required cardholder name. This provides Square with buyer information used during payment authentication.

Afterpay's PaymentRequest receives `billingContact`, current exact total, and the existing shipping-contact behavior. Selecting Afterpay invokes `AfterpayClearpay.tokenize()` from the final payment button. Unsupported or ineligible Afterpay remains hidden without affecting Card.

Square card styling is supplied when calling `payments.card({ style })`. Only documented Square selectors and properties are used. The application shell cannot override CSS inside Square's iframe.

## Validation and Errors

The final payment button validates the visible payment method only. Card requires the cardholder name and resolved billing address. Afterpay requires a resolved billing address. The first invalid application-owned field receives focus, with its native or inline validation message visible.

Checkout fields suppress the legacy global red focus outline and use the approved checkout focus border/ring. Error styles remain distinguishable without moving or clearing existing form data.

Provider errors remain sanitized for customers. Safe diagnostics record the method name and Square error class at warning level so production console stripping does not remove method-availability evidence.

## Accessibility and Responsive Behavior

Payment methods use a semantic radio group. Selected rows have both a radio state and a visual state. Brand marks include accessible text while decorative artwork is hidden from assistive technology.

The panel preserves logical keyboard order: method row, expanded fields, billing choice, billing fields, next method row, and final payment action. On narrow screens, card indicators stay within the method row and the billing name/city/state/ZIP grids collapse without horizontal scrolling.

## Testing

Automated tests prove:

- Card is selected by default and Afterpay is below it rather than in Express checkout;
- the Card panel renders Square fields, cardholder name, brand indicators, and the default shipping-as-billing control;
- unchecking the control and choosing pickup expose required billing fields;
- selecting Afterpay collapses Card, displays redirect copy, and retains billing controls;
- Card tokenization receives the resolved billing contact and Afterpay's PaymentRequest receives billing contact;
- malformed or missing Card/Afterpay billing data is rejected before reservation;
- billing changes alter idempotency identity;
- the reservation RPC stores `order_billing` atomically and cannot overwrite it on reuse;
- Shop Pay, PayPal, and Klarna remain absent;
- the legacy red checkout focus outline is absent.

## Non-Goals

- Saving billing addresses to `user_billing_addresses`.
- Storing cards or raw card fields.
- Adding Shop Pay, PayPal, Klarna, ACH, or gift cards.
- Faking unavailable Square methods or bypassing Square eligibility.
- Replacing the existing Express checkout wallet flow.

## Primary References

- Square card payments: https://developer.squareup.com/docs/web-payments/take-card-payment
- Square card styling: https://developer.squareup.com/docs/web-payments/customize-styles
- Square Afterpay/Clearpay reference: https://developer.squareup.com/reference/sdks/web/payments/afterpay-clearpay
- Square Afterpay custom button options: https://developer.squareup.com/reference/sdks/web/payments/objects/AfterpayButtonOptions
