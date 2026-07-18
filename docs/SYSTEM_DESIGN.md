# System Design

## Request Flow

1. A page or client component calls an App Router API boundary.
2. The route authenticates the caller and validates input.
3. A service applies business rules.
4. A repository performs typed database operations.
5. The route returns a minimal response with a request ID on errors.

## Storefront

Product discovery reads first-party products and variants from Supabase. Cart state is validated against current product availability before display or restoration.

## Administration

The admin console is divided into inventory, catalog, customer, order, fulfillment, shipping, tax, storefront-settings, and access-management capabilities. Navigation should expose only active capabilities.

## External Boundaries

Shippo is isolated to shipping services and webhook routes. Amazon SES is isolated to email helpers and order-email services. HERE Maps is isolated to map and address validation.

Checkout has no active external processor and remains unavailable by design.
