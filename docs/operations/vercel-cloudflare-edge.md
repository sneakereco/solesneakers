# Vercel/Cloudflare Edge Boundary

## Required production state

Cloudflare is the authoritative DNS provider only. Vercel is the sole storefront HTTP proxy, CDN, WAF, DDoS, and bot-protection layer.

| Control                                  | Required production state                        |
| ---------------------------------------- | ------------------------------------------------ |
| Cloudflare apex record                   | DNS only (gray cloud), Vercel target             |
| Cloudflare `www` record                  | DNS only (gray cloud), Vercel target             |
| Cloudflare DNSSEC                        | Active after registrar DS confirmation           |
| Cloudflare administrator access          | Passkey/security key preferred; TOTP MFA minimum |
| Cloudflare HTTP proxy/WAF/Bot Fight Mode | Not used for this Vercel site                    |
| Vercel reverse-proxy warning             | Absent                                           |
| Vercel production custom domain          | Valid and serving                                |

Do not orange-cloud the storefront records during an incident. A second reverse proxy obscures the client and TLS signals used by Vercel Bot Protection and JA4 controls.

## Vercel firewall rollout

Create the following rules in the Vercel project and record their rule IDs, ordering, publication time, owner, and rollback revision below.

1. Configure exact webhook exclusions from browser bot challenges for `/api/webhooks/square` and `/api/webhooks/shippo`. Do not bypass DDoS protection or all custom WAF rules, and do not exempt the `/api/webhooks/*` prefix.
2. Log, then rate-limit `POST /api/checkout/prepare` by IP at 3 requests per 30 minutes and `POST /api/checkout/payment-permit` by IP at 10 requests per hour.
3. Log, then apply the same exact route-specific limits by JA4 Digest. Protect `POST /api/checkout/pay` with BotID while its one-use permit prevents unauthenticated payment attempts.
4. Challenge checkout POST requests when the request country is not the United States. Do not country-block catalog browsing.
5. Enable the Bot Protection managed ruleset in log mode for at least one representative business day. Confirm legitimate shoppers, verified search bots, Square, Shippo, uptime checks, and the expiration cron behave as expected.
6. Change Bot Protection to challenge mode only after the observed traffic is classified correctly.

Upstash does not repeat either IP or JA4 window. It owns only the 24-hour email/account and device quotas implemented by the application.

### Published rule inventory

| Rule                                       | Match                             | Action                       | Order | Rule/revision ID | Published at | Owner |
| ------------------------------------------ | --------------------------------- | ---------------------------- | ----- | ---------------- | ------------ | ----- |
| Square webhook browser-challenge exclusion | Exact path `/api/webhooks/square` | Bot challenge exclusion only | TBD   | TBD              | TBD          | TBD   |
| Shippo webhook browser-challenge exclusion | Exact path `/api/webhooks/shippo` | Bot challenge exclusion only | TBD   | TBD              | TBD          | TBD   |
| Checkout IP limits                         | Prepare 3/30m; permit 10/hour     | Rate limit                   | TBD   | TBD              | TBD          | TBD   |
| Checkout JA4 limits                        | Same exact POST route limits      | Rate limit                   | TBD   | TBD              | TBD          | TBD   |
| Non-US checkout writes                     | Exact checkout paths and POST     | Challenge                    | TBD   | TBD              | TBD          | TBD   |

`TBD` entries are launch blockers, not optional documentation.

## Cron configuration

The production deployment invokes `GET /api/cron/expire-checkouts` and `GET /api/cron/checkout-notifications` every five minutes from `vercel.json`. The second schedule is offset by two minutes. Set `CRON_SECRET` to a randomly generated value of at least 32 characters in every Vercel environment that runs the jobs. Vercel sends it as `Authorization: Bearer <secret>`; both endpoints compare it in constant time.

Vercel does not immediately retry a failed cron invocation. A checkout whose legacy link or direct Square order could not be canceled remains pending with inventory reserved and is retried by the next scheduled run. Failed customer notifications use the database outbox and are also reclaimed by the next scheduled run. Alert on any failed invocation.

## Verification

Replace `<production-domain>` and record the dated output in the release evidence store.

```powershell
Resolve-DnsName <production-domain> -Server 1.1.1.1
Resolve-DnsName <production-domain> -Server 8.8.8.8
curl.exe -sS -D - -o NUL https://<production-domain>/api/healthz
```

Confirm both public resolvers reach the Vercel-configured target, Cloudflare shows gray-cloud status, Vercel response headers are present, and the Vercel project displays no reverse-proxy warning.

Then verify in a sandbox deployment:

- Invalid Square webhook signatures return `401` without creating durable events.
- Valid Square webhook test deliveries return `200` while browser challenges are enabled.
- The checkout kill switch returns `503` before BotID, Upstash, inventory, or Square.
- Requests without a trusted Vercel client IP return `503` before Upstash, inventory, or Square.
- Repeating an idempotency key for the same unexpired checkout returns the existing local order without consuming a new quota.
- A guest cannot obtain a permit without valid Turnstile evidence, and a permit cannot be reused.
- The expiration job cancels the direct Square order before stock is released.

## Rollback

For DNS mistakes, restore the last known-good DNS-only record values. Do not enable Cloudflare proxying as a workaround.

For a bad Vercel firewall change, roll back to the recorded previous firewall revision. Keep exact webhook exclusions intact and test signed webhook delivery immediately.

For active card testing, enable the persisted checkout kill switch first. Existing signed Square webhooks must remain reachable so already-started payments can settle safely.

## References

- [Vercel Bot Management](https://vercel.com/docs/bot-management)
- [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
- [Vercel Firewall rule configuration](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration)
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
