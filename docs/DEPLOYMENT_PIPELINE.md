# Deployment Pipeline

This document reflects the current CI and deployment flow defined in:

- `.github/workflows/staging.yml`
- `.github/workflows/production.yml`

## Environments

- `staging`: GitHub Actions workflow on the `stg` branch
- `production`: GitHub Actions workflow on version tags (`vMAJOR.MINOR.PATCH`)

## Staging workflow (validate-and-deploy)

Single job: `validate-and-deploy`

Steps:

1. Checkout
2. Setup Node + `npm ci`
3. Install Supabase CLI
4. Validate migrations locally:
   - `supabase db push --db-url $LOCAL_SUPABASE_DB_URL`
   - `supabase db lint --db-url $LOCAL_SUPABASE_DB_URL`
5. Lint and typecheck:
   - `npm run lint`
   - `npm run typecheck`
6. Push migrations to staging database:
   - `supabase db push --db-url $SUPABASE_DB_URL`
7. Seed and verify staging reference data:
   - `psql -v ON_ERROR_STOP=1 "$SUPABASE_DB_URL" -f supabase/seed.sql`
8. Build:
   - `npm run build`
9. Deploy to Vercel via CLI:
   - `vercel pull --environment=production`
   - `vercel build --prod`
   - `vercel deploy --prebuilt --prod`
10. Health check:

- `GET https://rdk-staging.vercel.app/api/healthz`

## Production workflow (validate-and-deploy)

Single job: `validate-and-deploy`

Steps:

1. Checkout
2. Setup Node + `npm ci`
3. Install Supabase CLI
4. Validate migrations locally:
   - `supabase db push --db-url $LOCAL_SUPABASE_DB_URL`
   - `supabase db lint --db-url $LOCAL_SUPABASE_DB_URL`
5. Lint and typecheck:
   - `npm run lint`
   - `npm run typecheck`
6. Push migrations to production database:
   - `supabase db push --db-url $SUPABASE_DB_URL`
7. Seed and verify production reference data:
   - `psql -v ON_ERROR_STOP=1 "$SUPABASE_DB_URL" -f supabase/seed.sql`
8. Build:
   - `npm run build`
9. Deploy to Vercel via CLI:
   - `vercel pull --environment=production`
   - `vercel build --prod`
   - `vercel deploy --prebuilt --prod`
10. Health check:

- `GET $DEPLOYMENT_URL/api/healthz` (from deploy output)

## Required secrets

- See `src/config/ci-env.ts` for CI-required variables.
- Staging and production also require environment-specific secrets defined in the workflow files.
