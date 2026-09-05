# Shipping Checkout and Shippo Integration Design

**Date:** 2026-09-05
**Status:** Approved
**Scope:** Shipping configuration, category-based checkout pricing, carrier availability, Square address synchronization, and Shippo label fulfillment

## Objective

Use the existing four shipping categories as the single source of truth for customer shipping charges and package defaults. Square remains authoritative for payment and tax, while Shippo supplies pre-negotiated carrier rates and label fulfillment after an order has been paid.

The implementation must remove the duplicate checkout flat-rate setting, repair carrier selection, and prevent labels from being purchased for disabled carriers or orders that are not ready for fulfillment.

## Decisions

1. The supported shipping categories are sneakers, clothing, accessories, and electronics.
2. Each category's configured shipping price, dimensions, and weight are authoritative.
3. A shipped cart is charged the highest applicable category shipping price exactly once.
4. Quantity does not multiply the customer shipping charge. Pickup has no shipping charge.
5. Product-level shipping-price overrides will no longer affect checkout and will be removed from administrative forms.
6. Staff selects the actual carrier and service internally after the order is paid; customers do not select a carrier during checkout.
7. Carrier enablement is a provider allowlist for Shippo's pre-negotiated rates. The store does not manage its own connected carrier accounts.
8. Square's final shipping address must be synchronized to the local order before Shippo fulfillment.

## Alternatives Considered

### Category price with internal Shippo selection — selected

This keeps the customer-facing charge predictable and preserves a clean boundary: category configuration controls what the customer pays, while Shippo controls the real label cost and available services. Staff can select the appropriate service after packing the order.

### Live Shippo price during customer checkout — rejected

Live rating would require collecting and validating the final delivery address before creating the Square Payment Link. Because Square's hosted page can collect or change that address, the application would also need repricing, address locking, or another reconciliation step. That complexity is unnecessary for the selected flat category pricing model.

### Carrier activation only in the Shippo Dashboard — rejected

This would be operationally simple but would leave the website's enabled-carrier setting without authority. The application needs a server-enforced provider allowlist so staff only sees and purchases services intentionally offered by the store.

## Configuration Model

The existing category shipping-default records become the only active configuration for:

- customer shipping price in cents;
- default parcel length, width, and height;
- default item weight;
- category identity.

The separate public-checkout flat-rate control and its API usage will be removed. Existing checkout-settings storage may remain dormant during this change to avoid a destructive database migration. It must no longer participate in runtime pricing.

Existing product shipping-price data may also remain in the database for compatibility, but application forms will stop offering the field and checkout pricing will ignore it. Removing dormant schema can be considered separately after production stability is demonstrated.

## Checkout Pricing

For pickup fulfillment, `shippingCents` is zero.

For shipping fulfillment:

1. Resolve the category for every purchasable cart line on the server.
2. Load shipping defaults for the distinct represented categories.
3. Fail closed if any represented category lacks a valid shipping-price configuration.
4. Set `shippingCents` to the maximum configured category price.
5. Send this value to Square as the Payment Link shipping fee.

The calculation is server-authoritative. Client-submitted totals, category names, or shipping prices are never trusted. Square continues to calculate tax through its configured tax rules, including the intended treatment of the shipping fee.

Examples:

| Cart | Category rates | Customer shipping charge |
| --- | --- | --- |
| One pair of sneakers | Sneakers $15 | $15 |
| Three pairs of sneakers | Sneakers $15 | $15 |
| Sneakers and clothing | Sneakers $15, clothing $9 | $15 |
| Pickup order | Any categories | $0 |

## Carrier Availability

The administrative carrier controls will use explicit selectable buttons rather than the currently non-mutating custom checkboxes. Stored provider values must use a single canonical representation:

- `UPS`
- `USPS`
- `FEDEX`

The API will validate incoming values against that allowlist, remove duplicates, and return values in a stable order. The UI will replace its state from the saved server response so a save-and-refresh round trip proves persistence.

When staff requests label rates, the server asks Shippo for its available pre-negotiated rates and normalizes each returned provider name to the canonical representation. Only rates from enabled providers are returned to the administrative UI.

Carrier enforcement must also occur during label purchase. A client must not be able to purchase a disabled carrier's rate merely by submitting a Shippo rate identifier obtained earlier or outside the UI. The server must retrieve or retain trustworthy rate metadata and verify the provider immediately before purchasing the label.

If no carriers are enabled, or Shippo returns no rates from enabled carriers, the UI presents a configuration-specific message instead of a generic label error.

## Square-to-Shippo Fulfillment Flow

1. Checkout calculates the customer shipping charge from category settings and creates a Square hosted Payment Link with shipping-address collection enabled for shipped orders.
2. Square processes payment, tax, and payment-risk evaluation.
3. A verified, idempotent Square webhook updates the local payment state.
4. For a successfully paid shipment, the application retrieves authoritative Square payment or order details and persists the final shipping recipient and address locally.
5. Staff opens the paid order, verifies or adjusts the package, requests allowed Shippo rates, selects a service, and purchases the label.

Label creation is blocked when an order is unpaid, canceled, refunded, under risk review, missing a synchronized shipping address, or already labeled. Webhook processing and Square-detail retrieval must remain idempotent so retries cannot duplicate fulfillment state.

The category package values provide a starting point for Shippo:

- item weights are multiplied by quantity and summed;
- the largest configured length, width, and height are used as initial dimensions;
- staff can correct the final packed dimensions and weight before requesting rates.

Shippo's returned rate is an operational fulfillment cost. It does not alter the amount the customer already paid.

## Error Handling and Observability

Checkout pricing failures use stable internal error codes and do not expose secrets or provider payloads. A missing category configuration identifies the affected category in administrative logs while returning a safe customer-facing unavailable message.

Carrier-setting requests reject unknown values. Shippo rating errors distinguish provider unavailability from an empty enabled-carrier set. Label-purchase authorization failures identify whether the order state, risk state, address synchronization, carrier allowlist, or duplicate-label guard caused the rejection.

Square webhook address synchronization logs the request ID, Square event ID, local order identifier, and synchronization outcome. Personal address details must not be written to general application logs.

## Testing Strategy

Automated tests will cover:

1. Category shipping calculation for single-category, repeated-quantity, mixed-category, pickup, and missing-configuration carts.
2. Removal of product override influence and removal of the duplicate checkout setting from runtime pricing.
3. Carrier control interaction, API validation, persistence, stable ordering, and `FedEx`/`FEDEX` normalization.
4. Shippo rate filtering plus server-side rejection of a disabled-carrier rate during purchase.
5. Square final-address synchronization and label blocking for unpaid, review, missing-address, and already-labeled orders.

The relevant unit and integration suites, TypeScript checking, and a production-equivalent local build must pass before the implementation is considered complete. Manual validation will confirm that carrier buttons visibly change state, survive refresh after saving, and that staff can purchase an allowed Shippo label for a paid test order.

## Rollout Constraints

The public checkout remains subject to the existing launch controls. Schema deletion is explicitly excluded from this implementation. Production enablement requires configured category records, at least one enabled carrier, successful Square webhook/address synchronization, and a staffed end-to-end low-value purchase and label test.
