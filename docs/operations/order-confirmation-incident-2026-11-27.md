# Order confirmation and email investigation — November 27, 2026

Investigated production project `sneakereco/soles-pro`, deployment `dpl_8gd9UwEjbGQbjQThSpzrE7n1m837`, source `760b84f0160dbd834f9a03054d53f285d40376e3`. The local checkout is `codex/store-opening-hotfix`; the payment/email files investigated matched that production revision before this repair. The local Vercel link points to staging, so all Vercel production queries used explicit project and team IDs.

Production evidence was collected using Vercel runtime logs, read-only PostgreSQL transactions against the production Supabase project, a read-only Square payment retrieval, and AWS SES/CloudWatch checks after the user refreshed AWS authentication. No customer messages, payments, order changes, or notification retries were initiated by this investigation.

## Customer order 75489207

Full ID: `75489207-de0e-4887-bc2a-13a508140884`. One Cash App payment attempt, total **USD 1,122.80**. Square currently reports the matching payment `COMPLETED`, with the same amount and provider order. The local order is `paid`, its attempt is `succeeded`, and it has no financial review flag.

Times below are Eastern Standard Time on November 27, 2026.

| Evidence                                                               | Time             |
| ---------------------------------------------------------------------- | ---------------- |
| Order created                                                          | 2:43:41.091 p.m. |
| Payment dispatched                                                     | 2:43:45.263 p.m. |
| Verified successful payment outcome committed                          | 2:43:47.695 p.m. |
| Vercel recovery worker logged `retry` for this order                   | 2:45:06.513 p.m. |
| Order projected to `paid`; confirmation/reseller notifications created | 2:50:07.132 p.m. |
| Reseller notification completed                                        | 2:50:10.238 p.m. |
| Customer confirmation send event recorded after SMTP acceptance        | 2:52:11.014 p.m. |
| Customer confirmation outbox row completed                             | 2:52:11.337 p.m. |

The customer's confirmation has a `sent` email audit record with a nonempty RFC message ID and a matching `sent` outbox record. The send event occurs only after the email service successfully returns. This supports SMTP acceptance, not inbox delivery. The audit row's `sent_at` defaults to its initial insertion time; use the later send event/outbox completion for this timeline.

There was no matching stored webhook receipt for this payment. The first recovery retry's exact dependency failure is not retained after the job later completes; the available log establishes `retry`, not its underlying cause.

Read-only Square configuration checks found **no enabled subscriptions**. Including disabled subscriptions returned exactly one: `wbhk_fbd3c9092e514f85aa92c23dcf96c4be`, with `enabled: false`, targeting `https://www.solesneakersnc.com/api/webhooks/square`. It subscribes to `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, `dispute.created`, and `dispute.state.updated`. Square reports creation on September 15 and last update on September 28, 2026. Retrieving its signature key and comparing it in memory against production Doppler's `SQUARE_WEBHOOK_SIGNATURE_KEY` returned **no match**. No keys were printed or changed. Vercel's sensitive deployed value is not readable through the connector, so the comparison establishes a mismatch with the production configuration source, not an independently decrypted deployment value.

Square's [subscription reference](https://developer.squareup.com/reference/square/webhook-subscriptions-api/ListWebhookSubscriptions) documents that the default list includes enabled subscriptions and `include_disabled=true` adds disabled subscriptions. Its [setup guide](https://developer.squareup.com/docs/webhooks/webhook-subscriptions-api) documents the empty `{}` response for no subscriptions. The production endpoint returned HTTP 200 in both checks, with no further cursor.

Vercel evidence: [production deployment](https://vercel.com/sneakereco/soles-pro/8gd9UwEjbGQbjQThSpzrE7n1m837), [production logs](https://vercel.com/sneakereco/soles-pro/logs). The relevant recovery request is `5slxv-1795808705104-0a27a512cd04`, around `2026-11-27T19:45:06Z`.

## Root cause of delayed confirmation

Before the repair, `createDirectPaymentDependencies` persisted the verified payment attempt and provider payment ID but did not prompt `SquareFinancialInquiry.recoverAttempt`. Only the financial inquiry applies the verified financial fact, consumes eligible inventory holds, marks the order paid, and queues confirmations. Signed webhook receipts have prompt processing; the direct payment outcome lacked the equivalent prompt.

The disabled webhook makes direct payments depend on recovery processing. Without a processed webhook or a prompt direct-payment inquiry, the five-minute recovery cron supplies that missing work. `pollOrder` stops automatic observation after 60 seconds and displays the delayed message. In this incident, order confirmation lagged the committed successful payment outcome by 6 minutes 19 seconds; the customer email completed about 8 minutes 23 seconds after that outcome. The delayed screen was consistent with the still-pending order projection even though the payment had succeeded.

The repair prompts the same verified inquiry after committed succeeded/pending/unknown payment outcomes, using Next.js `after`, existing dependency limits, and the existing ten-second inquiry deadline. It does not submit payments or bypass provider, inventory, fraud/review, or notification checks. Scheduling, capacity, or provider failures preserve durable cron recovery. Definitive declines are not prompted. The existing browser deadline remains; an unresolved provider outcome can still truthfully show the delayed screen.

## Customer-facing email findings

Production snapshot around 3:35 p.m. Eastern; aggregate order-email queries covered the preceding seven days.

| Email path                                                | Live evidence                                                                                                                 | Conclusion                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Order confirmations                                       | 8 audit records, all `sent` with message IDs; 8 matching completed outbox rows                                                | SMTP acceptance verified for observed sends                                                            |
| Pickup instructions                                       | 2 audit records, both `sent` with message IDs; 2 matching completed outbox rows                                               | SMTP acceptance verified for observed sends                                                            |
| Reseller order notices                                    | 8 accepted sends and completed outbox rows                                                                                    | Internal notification path also working                                                                |
| Shipping label / in transit / delivered / refund messages | No audit rows in the inspected window                                                                                         | Shared audited send/error path verified in code; no recent live sends available to prove these types   |
| Signup confirmation                                       | Supabase Auth recorded 7 confirmation-send timestamps and 5 email confirmations in the preceding 24 hours                     | Some successful account verification is established; this is separate from the order-email SMTP path   |
| Password reset                                            | No recent recovery-send timestamps in the inspected 24 hours                                                                  | No recent live-send evidence                                                                           |
| Password-change notice                                    | Sends directly through the app mailer; failures are logged while the password change remains successful                       | No durable email audit/retry for this notice; delivery cannot be inferred from password-update success |
| Contact form                                              | Saves the customer's message, then sends an internal support email; email failure is logged without undoing the saved message | Successful form submission proves message persistence, not email delivery                              |

Across the outbox, **zero `sent` rows lacked a matching accepted email audit with a message ID**. The confirmation timeline event is written after successful SMTP completion and audit persistence, so no false sent record was found for this customer's order or in that consistency check. Unknown SMTP handoffs are retained for review instead of counted as delivered.

The deployed receipt does not claim that a confirmation email was sent. Its pickup guidance tells the customer to check email for instructions. The separate order-status timeline can display `order_confirmation_sent`, backed by the audited send described above.

Vercel logs also contain signup `Error sending confirmation email` failures on November 26 around 3:32–3:48 p.m. Eastern. Later signup metadata demonstrates some subsequent successful confirmations, but does not explain those earlier failures. November 27 OTP `Signups not allowed for otp` failures are requests rejected by Auth, not proof of an SMTP delivery failure. The sign-in OTP flow intentionally requests existing users only.

## AWS SES follow-up after refreshed sign-in

The user refreshed AWS CLI authentication, and the follow-up successfully inspected account `923516173036` in `us-east-1`. A read-only STS access-key account lookup confirmed that production Doppler's `SES_SMTP_USER` belongs to this same account. The SMTP credential and customer address were not printed.

- SES sending is enabled, production access is granted, and enforcement status is `HEALTHY`.
- The `solesneakersnc.com` sending identity is verified, with DKIM signing enabled and status `SUCCESS`.
- The affected customer's address is **not on the account-level suppression list**.
- CloudWatch recorded **32 `Send` events and 32 `Delivery` events** in the window `2026-11-26T20:55:57.550Z` through `2026-11-27T20:55:57.550Z`. There were no published `Bounce`, `Complaint`, or `Reject` datapoints in that window; SES send statistics also reported zero for those failure categories.
- One-minute CloudWatch delivery data recorded four deliveries in the 2:50 p.m. Eastern minute and one in the **2:52 p.m.** minute, consistent with the affected customer's confirmation acceptance at 2:52:11 p.m. The metrics contain no message/order identifiers, so this timing correlation is supporting evidence rather than a recipient-specific receipt.
- The application audit snapshot remains eight accepted order confirmations, two accepted pickup emails, and eight accepted reseller notices, each with a message ID.

AWS defines `Delivery` as successful delivery to the recipient's **mail server**; this is stronger than SMTP submission to SES, but it does not prove inbox placement or that the customer read the email. These are shared-account metrics, not an order-specific or per-template delivery report. See [AWS sending-event definitions](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity.html).

Per-message tracking remains a gap. SES returned no `VdmAttributes`; the sole existing configuration set, `my-first-configuration-set`, has no event destinations. The domain has feedback forwarding enabled, but no SNS delivery/bounce/complaint topics were configured in its notification attributes. Its identity response has no default configuration set. The app mailer also does not select a configuration set.

The mailer currently returns Nodemailer's local RFC `messageId`, and the audit stores that value. It discards SMTP `response`, which contains the SES-assigned message identifier in a successful `250 Ok ...` response. This prevents a direct provider-message lookup from the existing audit IDs. See [AWS SMTP response documentation](https://docs.aws.amazon.com/ses/latest/dg/troubleshoot-smtp.html) and [GetMessageInsights](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetMessageInsights.html).

The follow-up establishes that this SES account is actually delivering mail to receiving servers, with no observed failure signals in the checked window. It does not establish delivery for every customer-facing email type or conclusively identify this customer's message in provider event history. Durable per-message delivery/bounce feedback and retention of SES's provider ID would be needed to make those claims directly. No SES settings, paid tracking features, suppression entries, or message statuses were changed.

## Limits and follow-up

- Restore the existing Square webhook deliberately: reconcile the subscription's current signing key with production Doppler, synchronize the Vercel environment, pass the normal staging/production release gates, then enable the existing subscription and verify a signed test receipt through Vercel and the stored receipt/recovery job. Preserve its exact URL and the six existing event types. Do not rotate keys or create a duplicate subscription unnecessarily. No provider configuration change or deployment was made in this investigation.
- All inspected order-email `delivered_at` values are null. AWS account-level delivery metrics are now verified, but there is no message-level provider receipt tied to these audit rows. The stored RFC message ID is not itself an SES delivery receipt.
- The initial AWS authentication failure was resolved by the user's refreshed login. The remaining provider-verification limitation is absent per-message tracking, rather than lack of AWS access.
- Vercel logs, SMTP acceptance, and shared-account delivery totals cannot prove that every customer-facing email type reaches recipients. Recent shipping/refund/password sends were unavailable, and Supabase Auth needs its own provider/log evidence.
- The payment prompt repair is a local change until it passes the staging and production release gates. A local regression test does not establish production behavior after deployment.

## Validation

The initial new regression failed for succeeded/pending/unknown outcomes because no background reconciliation was registered. After the repair:

- Nine focused payment, outcome, recovery, and email suites: **129 tests passed**, including eight new prompt-recovery regressions.
- All four repository Jest integration suites: **36 tests passed**.
- TypeScript `tsc --noEmit`, ESLint for the changed TypeScript files, Prettier for all five changed/added files, and `git diff --check`: passed.
- Independent read-only review found no actionable correctness issues. The reviewer checked shared provider capacity, concurrent idempotent projection, and installed Next.js support for nested `after` callbacks.
- The broader unit sweep was deliberately interrupted after an unrelated analytics visitors test took approximately 279 seconds. No complete full-unit-suite pass is claimed. The complete focused suites were rerun and passed afterward.

The new tests exercise the real payment dependency factory, committed-attempt validation, `after` registration, and dependency lease handling; they substitute the financial inquiry at its external-provider boundary. Existing verified-inquiry tests cover provider binding and projection behavior. These are local checks, not a hosted real-payment/email test of the changed code.

## Authorized repair and release progress

After the investigation, the user authorized the repair and production restoration. The hotfix is isolated on the current production release, `v1.0.0-beta.10`, to avoid including unrelated unreleased reporting changes. Production Doppler now matches the existing Square subscription signing key; Vercel integration metadata confirms that the protected production variable was updated. The subscription stays disabled until the corrected application deployment is verified. No key was rotated and no subscription was duplicated.

The existing staging deployment was blocked by its analytics pairing check comparing Vercel private `[SENSITIVE]` placeholders with the original secret values. This repair includes the independently reviewed gate-only extraction from commit `0a5d9d7f`: private placeholders are permitted at build preparation, then both staging and production verify authenticated hashes of the running private configuration and compiled public settings after deployment. The authenticated inspection does not drain jobs or return credentials. Public settings, forbidden operator secrets, project scope, and deployment pairing checks remain enforced. No database migration or unrelated checkout recovery changes are included. A runtime mismatch fails verification after publication; the workflows do not automatically roll back.

New failing coverage reproduced both the private-placeholder rejection and the absent protected inspection path before the gate correction. Release and hosted verification results will be recorded below when observed.

The first staging deployment of the repair passed validation, migration history and deployment, then its new runtime check failed because the immutable deployment URL returned a Vercel SSO redirect (HTTP 302). The canonical staging URL returned HTTP 200 with matching private/runtime and compiled-public fingerprints. The pinned Vercel CLI, authenticated with the existing CI token, then verified those same fingerprints on the exact immutable deployment. The release check now uses that protected-access path, retains application bearer authentication, disables redirects, and discards provider process diagnostics that might contain credentials. Both verification jobs install the same pinned CLI used for deployment. No Deployment Protection or Trusted Sources rule is disabled or broadened.
