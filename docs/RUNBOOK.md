# Runbook

## Storefront Or Admin Failure

1. Check `/api/healthz` and `/api/readyz`.
2. Review the latest deployment and structured logs by request ID.
3. Confirm Supabase availability and connection configuration.
4. Reproduce against the affected route with the correct role.
5. Roll back the application release if the failure is release-specific and no migration makes rollback unsafe.

## Inventory Failure

1. Confirm the admin session and role.
2. Inspect product and variant rows in Supabase.
3. Check API validation errors and request IDs.
4. Do not repair stock with client-side writes; use an audited server or database operation.

## Shipping Failure

1. Confirm the order shipping address and fulfillment state.
2. Check Shippo availability and credentials.
3. Inspect label or webhook logs by request ID.
4. Replay webhook delivery only after confirming idempotency.

## Checkout Requests

Checkout is intentionally unavailable. Do not bypass this state by creating pending orders without an atomic payment, tax, total-validation, and inventory-decrement workflow.

## Database Migration Failure

1. Stop the deployment.
2. Identify whether the migration partially applied.
3. Create a new forward repair migration.
4. Never edit an already applied migration in place.
