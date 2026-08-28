# Checkout Security Monitoring

## Launch alerts

| Severity | Condition                                                                  | First action                                                                              |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Warning  | Checkout `403` or `429` rate exceeds 10% for 15 minutes                    | Inspect Vercel BotID/WAF traffic and false positives                                      |
| Critical | More than 20 payment-link attempts share one IP or JA4 in 10 minutes       | Enable kill switch if Square objects are being created; preserve evidence                 |
| Critical | More than 5 invalid Square signatures occur in 10 minutes                  | Confirm configured notification URL/key; investigate spoofing without exposing signatures |
| Critical | Payment-link creation grows 3x without a corresponding paid-order increase | Enable kill switch and inspect card-testing signals                                       |
| Warning  | Checkout protection returns `503` for 5 consecutive minutes                | Check BotID, Upstash, Supabase, Square, tax provider, and required configuration          |
| Critical | Any expiration job failure                                                 | Confirm the Square link remains inactive before manually releasing stock                  |
| Critical | Any paid order enters `review`                                             | Block fulfillment and investigate amount, risk, or late-payment reason                    |

## Review cadence

Review daily for the first 14 launch days and weekly through day 60:

- BotID decisions, WAF challenges/limits, client-IP and JA4 concentrations, and reported false positives.
- New-link-to-paid conversion, Square declines, Risk Manager decisions, 3DS results, AVS/CVV failures, disputes, refunds, and confirmed card testing.
- Upstash usage, Vercel firewall usage, Square API errors, cron failures, and spend alerts.
- Pending reservations older than 20 minutes, links marked deleted without released stock, and released stock whose order later received payment.

Do not interpret one signal as proof of fraud. Tune thresholds only from recorded attack and false-positive evidence.

## Incident sequence

1. Enable the persisted checkout kill switch if Square is actively being abused.
2. Preserve Vercel request evidence, application request IDs, Square event/payment/order IDs, and the relevant database state. Never copy PAN, CVV, access tokens, webhook keys, or authorization headers.
3. Tighten only the exact checkout WAF rules.
4. Temporarily enable Vercel Attack Challenge Mode for a broad attack.
5. Confirm Square and Shippo signed webhooks still deliver.
6. Confirm the expiration cron is still retiring links before releasing inventory.
7. Restore normal mode only after traffic and Square object creation stabilize.

Do not enable the Cloudflare HTTP proxy during an incident. That changes the security boundary and client identity while diagnosis is in progress.

## Evidence and retention

Supabase or protected object storage—not Vercel runtime logs—is the seven-year evidence system for checkout consent, protection decisions, product and price snapshots, tax calculation IDs, addresses, inventory reservations, Square link/order/payment IDs, sanitized webhook records and payload hashes, risk review, fulfillment, delivery, refunds, and disputes.

Restrict evidence access by job role, require MFA, log administrative access, encrypt backups, test restoration, and define a litigation-hold process. Retention deletion must be automated and suspended by a hold.

## Step-up rule

BotID Deep Analysis or Cloudflare Turnstile may be proposed only when evidence shows Basic BotID plus Vercel IP/JA4 and application identity quotas are being bypassed. The change request must include attack evidence, false-positive risk, expected monthly cost, exact protected route, rollout observation window, and rollback procedure.

True Verifi/Ethoca pre-dispute alerts remain deferred. A Square `dispute.created` notification is a standard dispute notification and must not be reported as an early-alert program.
