# Checkout reliability and cohesion

Approved in conversation on September 15, 2026. The user explicitly approved implementation, correcting the proposal to keep pickup instructions in a separate email.

## Required behavior

1. Pickup requires a name, email, and phone before charging. Capture the actual pickup contact separately from billing, persist it, show it to staff, and provide it to Square pickup fulfillment. Reuse wallet contact values where available; missing information continues the same payment attempt without another Pay click.
2. Fix Afterpay's strict ZIP versus ZIP+4 comparison without accepting a different destination or discarding address validation. Handle pickup explicitly using Square's pickup support and authoritative totals.
3. Confirmation and pickup instructions are separate, durable notifications. Try delivery promptly after confirmed payment, retain scheduled retries and audit records, and prevent ordinary webhook replay or queue completion retry from sending duplicate emails. Failed email never converts a completed payment into a payment failure.
4. Keep one checkout page with consistent loading/error presentation. Preserve native provider screens, express completion, normal address suggestions, changed-total review, billing checks, payment permits, idempotency, stock reservation, rate limits, and bot verification.
5. Align transactional email styling with the softer site design; retain useful order, fulfillment, support, and required legal details while removing slogans/repeated metadata. Replace customer-visible Realdealkickzsc branding and old links. Preserve storage/cache compatibility where changing internal keys would lose carts or weaken limits.

## Evidence

The current pickup form collects name and phone but the prepare payload has no pickup contact. Billing data exists on inspected staging pickup orders; pickup admin reads shipping names. Square pickup payload has scheduling but no recipient. The email cron runs every five minutes and claims three jobs; observed staging sends took 174–250 seconds. Pickup instructions are reachable only via admin resend. The actual Afterpay callback rejected a five-digit ZIP when the confirmed address used ZIP+4. Existing browser tests mock Square's external SDK boundary and cannot prove live-provider completion.

## Verification and release boundary

Use focused regression tests, local database transaction/rollback checks, complete unit/integration tests, lint/typecheck/build, and browser flow checks. Staging matrix covers both fulfillment modes, guest/account, five enabled payment methods, seven documented card brands, provider rejection/cancel/SCA scenarios, missing contact, address review, total changes, retries, duplicate clicks, inventory, and email lifecycle. Label native-wallet or provider cases blocked when the environment cannot complete them. Use Square Sandbox only and designated test data. Do not loosen security to force tests through. Production credentials currently point to an empty older database; verify deployment mapping before any production change. No production migration or deployment is part of this implementation.
