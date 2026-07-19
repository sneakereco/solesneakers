# API Overview

The route implementations under `app/api` are authoritative. This document records the supported route groups rather than duplicating every request schema.

## Public And Account APIs

- `/api/auth/*`: registration, login, logout, verification, password recovery, OTP, and two-factor authentication
- `/api/account/*`: addresses, password changes, shipping details, and order history
- `/api/store/products`: products filtered by canonical `brandIds`, `modelIds`, and `sizeIds`
- `/api/store/taxonomy`: active canonical brand and size options for storefront navigation
- `/api/cart/*`: cart validation, snapshot, and restoration
- `/api/contact`: contact form delivery
- `/api/email/*`: subscriber and confirmation flows
- `/api/orders/[orderId]`: authorized order status access
- `/api/webhooks/shippo`: verified shipping webhook intake

## Admin APIs

- `/api/admin/products/*`: first-party inventory CRUD, duplication, and export
- `/api/admin/tags/*`: canonical brands, models, aliases, candidates, sizes, and title parsing
- `/api/admin/customers/*`: customer listing and detail
- `/api/admin/orders/*`: order listing, fulfillment, pickup, and email resend
- `/api/admin/transactions/*`: order transaction history
- `/api/admin/shipping/*`: origins, defaults, carriers, rates, and labels
- `/api/admin/nexus/*` and `/api/admin/tax-settings`: nexus records and store tax settings
- `/api/admin/store-access`: storefront access settings
- `/api/admin/featured-items/*`: featured product management
- `/api/admin/profile` and `/api/admin/invites`: admin identity and invitation management

## Checkout

No checkout mutation API is active. `/checkout` and `/checkout/start` fail closed with an unavailable state until a replacement payment and tax workflow is implemented.

## Product Taxonomy Contract

Product writes require `brand_id`, allow `model_id`, and require `size_id` on every variant. Product reads expose joined `{ id, label }` references for `brand`, optional `model`, and variant `size`. Generic product tags, copied product brand/model strings, and copied variant size labels are not supported. Order items retain text snapshots for historical display.
