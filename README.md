# Sole Sneakers

Sole Sneakers is a Next.js App Router storefront and administration console backed by Supabase.

## Current Capabilities

- Responsive storefront, product discovery, cart, account, and policy pages
- Supabase authentication, customer profiles, addresses, and order history
- First-party product, variant, inventory, catalog, customer, fulfillment, pickup, and tax administration
- Shippo shipping rates, labels, tracking, and webhook processing
- Amazon SES transactional email
- Role-based admin access and audit history

Checkout is intentionally unavailable until a replacement payment and tax implementation is selected. The application does not create unpaid orders as a fallback.

## Development

```bash
npm install
npm run dev
```

Common validation commands:

```bash
npm run typecheck
npm run lint
npm run test:jest:unit -- --runInBand
npm run build
```

Environment variables are validated in `src/config/env.ts`. Database changes are forward-only Supabase migrations in `supabase/migrations`.

## Operations

- [Vercel/Cloudflare edge boundary](docs/operations/vercel-cloudflare-edge.md)
- [Checkout security monitoring](docs/operations/checkout-security-monitoring.md)
- [Square checkout launch gates](docs/operations/square-checkout-launch-gates.md)
