# Checkout contracts during single-store retirement

This is the reader compatibility release of the [approved design](../superpowers/specs/2026-11-23-single-store-retirement-design.md). Production still issues legacy permits, v1 address confirmations and v3 cart hashes. Future artifacts are constructed only in tests. No flag enables new production writers.

The bounded adapter lives in `src/Modules/Checkout/Source/Features/ContractCompatibility`; its tests live in `src/Modules/Checkout/Tests/Features/ContractCompatibility`. Remove legacy handling after the observed contraction gates, keeping the final tenant-free contracts.

## Payment permits

Opaque tokens retain the Redis key `rdk:checkout:payment-permit:<token>`, 120-second expiration, and atomic GET+DEL consumption. Serialized JSON and decoded objects are supported.

Both formats require `orderId`, `cartHash`, positive integer `totalCents`, `method`, `deviceSessionId`, `normalizedEmailHash`, and a UUID `squareIdempotencyKey`. Methods remain card, Afterpay, Apple Pay and Cash App Pay, using the existing wire enum values.

- Legacy: additionally requires `tenantId`; no `version` property.
- Future: additionally requires numeric `version: 2`; no `tenantId` property.

Objects are strict: mixed versions, unknown properties, missing fields and unknown versions fail closed. The production issuer continues to reject future payloads. Malformed consumed data cannot be reused.

The payment handler validates the loaded order, cart, amount, device, pending status, expiry, Square order and billing data. Legacy tenant equality remains enforced. The consumed permit supplies authorized method and payment idempotency. Future permits use the validated order for legacy decline-counter identity. Existing protected issuance, guest/customer ownership, cart-bound buyer email, pickup/shipping validation and ambiguous-payment handling remain in place.

## Address confirmations

Legacy token: `<13-digit-expiry-ms>.<64-lowercase-hex-HMAC>`.

Future token: `v2.<13-digit-expiry-ms>.<64-lowercase-hex-HMAC>`.

Sign UTF-8 `JSON.stringify` of these arrays with SHA-256 HMAC and the existing secret:

```text
v1: ["shipping-address-confirmation-v1", tenantId, deviceSessionId,
     normalizedEmailHash, paymentMethod, shippingAddressKey(address), expires]
v2: ["shipping-address-confirmation-v2", deviceSessionId,
     normalizedEmailHash, paymentMethod, shippingAddressKey(address), expires]
```

Expiration is strictly after now and at most ten minutes ahead. Comparison remains timing-safe. Prefix and signing domain must agree; stripping a future prefix does not yield a valid legacy token.

The existing address key covers line1, line2, city, state, postal code and country, with its existing null/whitespace/case normalization. Recipient-name and phone semantics remain unchanged. Production issuance remains byte-compatible with frozen old-code fixtures.

## Persisted cart hashes

Both versions remain lowercase 64-character SHA-256 hex strings. Version is inside the hashed canonical JSON, with no textual prefix or SQL column widening.

Canonical object field order:

```text
v3: version:3, tenantId, buyerEmail, fulfillment, paymentMethod,
    shippingAddress, billingAddress, pickupContact, items
v4: version:4, buyerEmail, fulfillment, paymentMethod,
    shippingAddress, billingAddress, pickupContact, items
```

Address, contact and item serialization and item sorting retain existing behavior. The v4 computation is private to comparison; no production future hash generator is exported. Frozen, independently calculated v3/v4 fixtures protect these bytes.

Preparation recognizes either stored identity for idempotent reuse. Reuse preserves the stored hash, order snapshots and Square identity, without another reservation or Square order. Mismatched identities, expired/nonpending orders and changed authoritative totals retain existing rejection behavior.

## Rollout and evidence

Deploy these readers everywhere before enabling future producers. Once future artifacts exist, this reader release is the oldest compatible application rollback. The original application is then incompatible with future artifacts.

The subsequent producer release still needs verified application/environment Redis separation, atomic old/new protection-counter continuity, pending-purchase recovery and observed compatibility exit evidence. This release changes no counter namespace.

Local verification: 543 unit tests and 21 integration tests passed; TypeScript, focused lint/formatting and cyclomatic complexity at most 10 for the three new production adapter files passed. Three isolated browser checks passed for checkout progress, shipping review and token-based receipt recovery. Redis behavior is tested through an in-memory provider adapter; the integration suites include SQL-text checks. These counts do not prove live Redis, deployed authorization, staging or Square behavior.
