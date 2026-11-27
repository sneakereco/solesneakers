# Store opening incident — 2026-11-27

## Evidence and scope

The supplied `Pasted text.txt` contains **150 runtime records**, with 150 distinct log IDs and Vercel request IDs. All identify deployment `dpl_2XWBj89S99QAqQr5KfiuApF7Wyrx` (the coordinator identified this as `b893a31d`, beta.8). Their timestamps span **14:15:23.383–14:25:24.971 UTC**, or **9:15:23–9:25:24 AM Eastern**. This is a paginated sample within the selected **13:56–14:26 UTC** window; it does not establish the window's complete request or error population. Non-record wrapper text was excluded. Attachment contents were treated as data.

All records have source `function`: **139 error-level and 11 warning-level**, **137 GET and 13 POST**. These are log levels and methods, not HTTP failure counts. Of the 133 structured application messages, **132 have null status and all 133 have null latency**. The remaining 17 messages are unstructured. Consequently the sample cannot establish HTTP error rates, request duration percentiles, concurrency, or customer counts. Vercel also distinguishes an observed request path from a framework route template. [Vercel runtime log documentation](https://vercel.com/docs/logs/runtime)

## Sample classification

Times below are UTC on November 27. Request paths are the observed `requestPath` values.

| Category                                                  | Records | Observed paths                                                                                                                           | First–last        |
| --------------------------------------------------------- | ------: | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `public_store_access_lookup_failed` / `Request timed out` |      69 | `/`: 65; `/store`: 4                                                                                                                     | 14:15:23–14:24:41 |
| `catalog_read` / `Catalog read timed out`                 |      49 | `/store`: 49                                                                                                                             | 14:15:28–14:24:51 |
| Product-cache revalidation / `TypeError: fetch failed`    |       9 | `/`: 2; `/store`: 2; `/shipping`: 1; four product request paths below: 1 each                                                            | 14:22:11–14:25:24 |
| `AUTH_ERROR`                                              |      12 | `/api/auth/2fa/challenge/verify`: 12                                                                                                     | 14:20:11–14:24:52 |
| Supabase warning about trusting `getSession()` user data  |       8 | `/admin/settings/store-access`: 3; `/api/admin/store-access`: 2; `/admin/featured-items`, `/admin/inventory`, `/admin/dashboard`: 1 each | 14:16:24–14:24:24 |
| `admin_guard`                                             |       2 | `/admin`: one missing admin cookie; one missing user session                                                                             | 14:19:57–14:21:42 |
| `bot_mitigation` / `bot_block_suspect_agent`              |       1 | `/store`; explicitly logged status 403                                                                                                   | 14:18:51          |

The four product request paths were `/store/37b09aa5-8e63-4529-b603-cd26086a5ba2`, `/store/59c63a94-fff8-4c34-b6ef-9568984f36f7`, `/store/f47e5ca0-5bb7-4037-b8a2-8fde8a0a0b6e`, and `/store/2eec8e92-ddf3-455e-9d33-c13123bc19a9`. A background revalidation's cache key can identify a different product from the request path; the path alone does not identify the failing cache target.

Representative Vercel request IDs for provider correlation:

| Event                      | UTC          | Request ID                         |
| -------------------------- | ------------ | ---------------------------------- |
| Store access timeout       | 14:24:41.995 | `9w9zc-1795789454406-bcb03e47fcdb` |
| Catalog timeout            | 14:24:51.030 | `k57hk-1795789464384-1e4468930cc9` |
| Cache fetch failure        | 14:25:24.971 | `mqwp8-1795789519898-64faaaff21e2` |
| Admin authentication error | 14:24:52.939 | `gzxkh-1795789492904-00b3c4208c77` |

## Relationship to the opening fix

[PR #57](https://github.com/sneakereco/solesneakers/pull/57) removes repeated timer navigation/refresh and replaces sequential store-access reads with a joined, abortable request. Explicit public reads share an in-flight request and a two-second raw-configuration snapshot; scheduled opening time is recomputed on each call. Existing mutation callers remain fresh by default. Sources: [unlock timer](../../src/app/locked/unlock-timer.tsx), [access helper](../../src/lib/store-access/get-store-access-settings.ts), [joined repository query](../../src/repositories/store-access-settings-repo.ts). These changes directly address the access-timeout path and request amplification. This sample comes from the older deployment and cannot prove the fix's live effect.

Two additional failure paths remain relevant:

- The catalog's [15-second wrapper](../../src/app/%28store%29/store/page.tsx) races its reads against a timer without cancelling their underlying HTTP work. All 49 `catalog_read` records match that explicit application error. Opening-storm relief may reduce pressure, but the sample does not prove the catalog path recovered.
- [Admin authentication](../../src/services/admin-auth-service.ts) converts an error returned by `supabase.auth.getUser()` into `AUTH_ERROR` before factor selection or OTP verification. The [2FA route](../../src/app/api/auth/2fa/challenge/verify/route.ts) maps that thrown error to HTTP 500. This is a source-based interpretation; the supplied records have null HTTP status and omit the original provider cause. They do not demonstrate incorrect OTPs or a diagnosed Supabase outage.

The nine cache errors contain `fetch failed` without a usable network cause code. The eight session warnings and two guard warnings do not establish an authentication bypass. No specialty eligibility/claim records appear in this sample.

## Dashboard context and release decision

The coordinator's transcription of the supplied screenshots reports approximately **77K CDN requests and 41K function invocations over the last 12 hours**, not simultaneous users. It also reports uncached root 12K, auth/login 10K, product 8.7K, store 4.8K, locked 4.8K and index 4.7K; approximate P75 duration of root/index/locked 15 seconds, store seven seconds and product 20 milliseconds. Specialty eligibility shows 658 invocations, 69.9% errors and approximately 13 seconds. Preserve those dashboard labels separately from this file's observed request paths.

CPU P75 of approximately 45 ms, memory 269 MB of 2.05 GB, 10% throttling and 0.1% cold starts do not establish memory exhaustion or a platform-wide outage. The sample's explicit application timeouts support investigating dependency waits and request amplification; attribution beyond that remains unproven.

**No newly diagnosed defect in this sample requires a speculative application change before consolidating the release.** Staging acceptance still needs bounded catalog, product, admin sign-in/MFA and specialty eligibility/claim checks, followed by deployment-specific timeout/error observation. Passing build, unit or migration checks does not demonstrate live recovery. Investigate any continuing failures using their provider request IDs and original error causes.

At this checkpoint the enabled Vercel plugin exposes no callable Vercel tools. A separate, bounded read-only retrieval with the documented CLI remains follow-up work; no additional provider records are claimed here. The official CLI documents time bounds, deployment filters and JSON output, with behavior varying by CLI version. [Vercel CLI logs](https://vercel.com/docs/cli/logs)

This report contains aggregate counts, public product identifiers and request correlation IDs only. No raw logs, credentials, cookies, customer identifiers or provider mutations were included.
