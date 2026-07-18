# Infrastructure Guide

## Runtime

- Next.js hosts the storefront, admin console, and API routes.
- Supabase provides PostgreSQL, authentication, row-level security, and storage.
- Shippo provides shipping rates, labels, tracking, and webhooks.
- Amazon SES provides transactional email.
- HERE Maps supports address and map validation where configured.

## Configuration

Server environment validation is defined in `src/config/env.ts`. Browser-safe configuration is defined in `src/config/client-env.ts`. CI defaults are defined in `src/config/ci-env.ts` and the Jest configuration files.

Secrets must be supplied by the deployment environment and must never use a `NEXT_PUBLIC_` prefix.

## Database Changes

All schema changes must be forward-only migrations in `supabase/migrations`. Never rewrite a migration that may have been applied to a shared environment. Regenerate or update `src/types/db/database.types.ts` whenever the deployed schema changes.
