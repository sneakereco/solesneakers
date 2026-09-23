# Phase A browser measurement (Sole staging)

This branch adds a disabled-by-default PostHog foundation for four explicit behavioral events. It does not emit payment, order, revenue, or identity events. Cloudflare remains the traffic/edge layer; PostHog is only the intentional product funnel layer.

## Configuration

The staging GitHub Actions build accepts these optional environment **names** from `stg` environment variables:

| Name                                  | Required to enable                    | Purpose                                                        |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT` | yes; workflow fixes this to `staging` | Prevent a production build from activating this Phase A client |
| `NEXT_PUBLIC_POSTHOG_ENABLED`         | yes; literal `true`                   | Explicit opt-in; unset/anything else remains off               |
| `NEXT_PUBLIC_POSTHOG_PROJECT_KEY`     | yes                                   | Public PostHog Cloud project token                             |
| `NEXT_PUBLIC_POSTHOG_HOST`            | yes                                   | Approved US or EU Cloud ingestion host                         |

No PostHog configuration is supplied in this branch. The SDK does not initialize when any gate is absent or invalid, or when the browser is not on the verified `soles-stg.vercel.app` alias. Do not enable until the project, region, privacy settings, and staging validation plan are confirmed. Sole's Doppler-to-Vercel integration is not required for this disabled staging PR; the current GitHub workflow builds the Vercel artifact.

## Capture boundary

`instrumentation-client.ts` initializes the SDK only when enabled. Autocapture, automatic pageview/pageleave, dead/rage clicks, replay, surveys, exceptions, heatmaps, performance capture, feature-flag requests, and person profiles are disabled. SDK referrer/campaign persistence and URL-hash capture are disabled. The app calls typed helpers in `src/lib/measurement/client.ts`; PostHog is not imported by storefront components directly. `before_send` revalidates every outgoing event and strips SDK-added URL/referrer fields plus all properties outside the allowlist. It preserves only the exact configured public ingestion key and UUID-shaped anonymous `distinct_id` and `$session_id` required for delivery and session correlation. Unrecognized events, mismatched keys, and invalid correlation identifiers are dropped.

Allowed common properties: `storefront=sole`, `environment=staging`, `schema_version=1`, a restricted pathname, and optional sanitized `landing_pathname`, `referrer_host`, and five named UTM fields. Product events allow UUID product/variant IDs and a unit quantity. No names, email, address, payment data, raw URL, query string, or arbitrary metadata are accepted. Attribution is stored for this browser session only after sanitization. PostHog's anonymous ID provides session correlation; the app never calls `identify`.

Operator-ratified triggers:

| Event                   | Trigger                                                                                      | Duplicate/invalid-state guard                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `storefront_viewed`     | Entry into `/store`, including direct entry                                                  | The persistent store shell tracks the prior pathname; `/` and same-path updates do not fire             |
| `product_viewed`        | Valid product detail component mounts                                                        | Once per mounted product ID                                                                             |
| `product_added_to_cart` | Persisted quantity rises after `CartService.addItem`                                         | Stock rejection or storage failure does not count                                                       |
| `checkout_started`      | Unlocked `CheckoutClient` has a ready, nonempty cart and is showing the usable checkout form | Once per mount; locked/unavailable page branches, empty/loading cart, and payment redirect do not count |

## Validation before any staging enablement

Run the focused measurement/security tests, lint, typecheck, and build. In an authorized staging session, verify one event per intended interaction, no event on denied cart add or locked/unavailable checkout, and no PostHog request when disabled. Inspect a received event for absence of `$current_url`, `$referrer`, raw query strings, and customer/payment data. Confirm the selected Cloud host is permitted by the CSP and that the project does not remotely override the disabled product features. Do not interpret these events as paid orders.
