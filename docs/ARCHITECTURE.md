# Architecture

## Application Boundaries

- `app/(store)` and public App Router pages render the storefront.
- `app/admin` contains role-protected operational tools.
- `app/api` exposes authenticated server boundaries and public storefront endpoints.
- `src/components` owns reusable presentation and interactive UI.
- `src/services` owns business workflows.
- `src/repositories` owns database access.
- `src/types/db` contains generated-compatible database types.
- `supabase/migrations` is the source of truth for schema evolution.

UI components must not query Supabase directly when a service or repository boundary exists. API routes authenticate and validate requests before invoking services.

## Inventory

Products and variants are managed directly in the application database. Create, edit, archive, restore, delete, filter, paginate, and export operations use first-party product services and repositories. No external inventory synchronization boundary is active.

## Orders And Fulfillment

Existing orders remain available to customer and admin views. Shipping labels and tracking are handled through Shippo. Transactional order email is sent through Amazon SES.

No payment or external tax processor is active. Checkout routes render an unavailable state and must remain fail-closed until a replacement implementation can atomically calculate totals, authorize payment, create the order, and decrement inventory.

## Cross-Cutting Concerns

- Supabase Auth supplies sessions and role claims.
- Zod validates request payloads and environment configuration.
- Structured server logging carries request IDs.
- CSRF, CSP, rate limiting, and role checks are enforced at application boundaries.
