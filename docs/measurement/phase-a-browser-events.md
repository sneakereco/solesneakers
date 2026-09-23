# Phase A browser measurement (Sole staging; production-capable gate)

The client captures four explicit behavioral events. It does not emit payment, order, revenue, or identity events. Cloudflare remains the traffic/edge layer; PostHog is only the intentional product funnel layer. The production path is inert until a separately approved production tag and complete production configuration are released.

## Configuration

The staging workflow receives these values from the staging Doppler CI token and passes them to the remote Vercel build. The production workflow uses its production-environment Doppler token and passes the same four values only when all are present; otherwise it explicitly builds with measurement disabled. The production token's Doppler config binding must be confirmed before release.

| Name                                  | Required to enable             | Purpose                                          |
| ------------------------------------- | ------------------------------ | ------------------------------------------------ |
| `NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT` | yes; `staging` or `production` | Must match the exact browser hostname gate       |
| `NEXT_PUBLIC_POSTHOG_ENABLED`         | yes; literal `true`            | Explicit opt-in; unset/anything else remains off |
| `NEXT_PUBLIC_POSTHOG_PROJECT_KEY`     | yes                            | Public PostHog Cloud project token               |
| `NEXT_PUBLIC_POSTHOG_HOST`            | yes                            | Approved US or EU Cloud ingestion host           |

The SDK does not initialize when any gate is absent or invalid. Staging accepts only `soles-stg.vercel.app` with `environment=staging`. Production accepts only the Vercel-assigned `shopsolesneakers.com` and `soles-pro-rose.vercel.app` with `environment=production`. `www.shopsolesneakers.com` is not currently assigned. Preview and unique deployment URLs are rejected; no hostname wildcard is used. Staging is already enabled through CI build-time injection. Production remains off until a separate release decision.

## Capture boundary

`instrumentation-client.ts` initializes the SDK only when enabled. Autocapture, automatic pageview/pageleave, dead/rage clicks, replay, surveys, exceptions, heatmaps, performance capture, feature-flag requests, and person profiles are disabled. SDK referrer/campaign persistence and URL-hash capture are disabled. The app calls typed helpers in `src/lib/measurement/client.ts`; PostHog is not imported by storefront components directly. `before_send` revalidates every outgoing event and strips SDK-added URL/referrer fields plus all properties outside the allowlist. It preserves only the exact configured public ingestion key and UUID-shaped anonymous `distinct_id` and `$session_id` required for delivery and session correlation. Unrecognized events, mismatched keys, and invalid correlation identifiers are dropped.

Allowed common properties: `storefront=sole`, `environment=staging|production`, `schema_version=1`, a restricted pathname, `$geoip_disable=true`, and optional sanitized `landing_pathname`, `referrer_host`, and five named UTM fields. The contract forces `$geoip_disable=true` even if an input supplies `false`, opting out of PostHog's server-side GeoIP enrichment. This is an application-owned processing control; the three-field exception for SDK-added ingestion/correlation properties is unchanged. Product events allow UUID product/variant IDs and a unit quantity. No names, email, address, payment data, raw URL, query string, or arbitrary metadata are accepted. Attribution is stored for this browser session only after sanitization. PostHog's anonymous ID provides session correlation; the app never calls `identify`.

Operator-ratified triggers:

| Event                   | Trigger                                                                                      | Duplicate/invalid-state guard                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `storefront_viewed`     | Entry into `/store`, including direct entry                                                  | The persistent store shell tracks the prior pathname; `/` and same-path updates do not fire             |
| `product_viewed`        | Valid product detail component mounts                                                        | Once per mounted product ID                                                                             |
| `product_added_to_cart` | Persisted quantity rises after `CartService.addItem`                                         | Stock rejection or storage failure does not count                                                       |
| `checkout_started`      | Unlocked `CheckoutClient` has a ready, nonempty cart and is showing the usable checkout form | Once per mount; locked/unavailable page branches, empty/loading cart, and payment redirect do not count |

## Validation before production release

Run the focused measurement/security tests, lint, typecheck, and build. Revalidate staging after the GeoIP change, including a newly stored PostHog event with no GeoIP location fields. Confirm the selected production Cloud host is permitted by CSP, the production Doppler token's config binding and dedicated PostHog project, and that hosted settings do not remotely override disabled product features. Verify production DNS and the full tag-to-main release impact before tagging; the production workflow applies migrations before deployment. Do not interpret these events as paid orders.
