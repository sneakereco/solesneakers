# Monitoring Guide

## Health

- `/api/healthz` verifies the application process is responsive.
- `/api/readyz` verifies required dependencies are ready.

## Operational Signals

Monitor structured server errors by route, request ID, and status code. Alert on sustained increases in authentication failures, order API failures, shipping webhook failures, email delivery failures, and database latency.

## Shipping Webhooks

Shipping webhook failures should include a request ID and provider event identifier. Confirm signature validation, inspect the associated order, and replay only when the handler is idempotent.

## Releases

Each release should pass type checking, changed-file lint, unit tests, and a production build. Database migration failures block deployment.
