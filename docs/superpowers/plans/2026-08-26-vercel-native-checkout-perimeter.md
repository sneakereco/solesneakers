# Vercel-Native Checkout Perimeter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Vercel as the sole HTTP security edge, keep Cloudflare DNS-only, and ensure that only a bot-checked, tightly limited application endpoint can create Square-hosted checkout links.

**Architecture:** Cloudflare answers DNS but does not proxy storefront HTTP traffic. Vercel supplies DDoS mitigation, WAF controls, and BotID Basic; the application supplies identity-aware quotas, idempotency, inventory safety, and the checkout kill switch before creating a Square Payment Link. Exact webhook routes bypass browser challenges but authenticate every delivery cryptographically.

**Tech Stack:** Next.js 16, TypeScript 5.9, Vercel Pro Firewall/BotID, Upstash Redis, Supabase/PostgreSQL, Square Payment Links and Webhooks, Jest 30, Playwright

**Spec:** `docs/superpowers/specs/2026-08-26-vercel-native-checkout-perimeter-design.md`

## Global Constraints

- Cloudflare remains authoritative DNS, with the production storefront records set to DNS-only.
- Vercel is the only HTTP proxy/CDN/WAF in front of the application.
- Cloudflare Turnstile is deferred and must not be added as a launch dependency.
- Vercel BotID uses the free `basic` check level at launch; Deep Analysis requires a separate cost decision.
- The storefront and `/checkout` stay public; `checkout_lock_enabled` is an emergency payment kill switch and defaults to `false`.
- All card entry occurs on Square-hosted pages; the application must never accept or log PAN or CVV data.
- US shipping and pickup only at launch.
- Checkout-specific protection fails closed before any Square API call.
- Square webhooks, not browser redirects, authorize paid-order state and fulfillment.
- Vercel owns short-window IP and JA4 rate limits; Upstash must not duplicate those counters.
- Upstash owns 24-hour email/account and device/session quotas only.
- Square Risk Manager and 3DS must be verified for API-created Payment Links; Afterpay and tipping are disabled at launch.
- Expired inventory reservations deactivate their Square Payment Links before inventory is released.
- Seven-year evidence storage must not depend on Vercel runtime logs.
- PCI SAQ A eligibility, annual SAQ ownership, and quarterly ASV scans are launch gates.
- True Verifi/Ethoca-style pre-dispute alerts remain deferred.
- Existing unrelated worktree changes must be preserved.

---

### Task 1: Record and Verify the DNS-Only Edge Boundary

**Files:**

- Create: `docs/operations/vercel-cloudflare-edge.md`
- Modify: `README.md`
- Test: Manual DNS and response-header verification recorded in `docs/operations/vercel-cloudflare-edge.md`

**Interfaces:**

- Consumes: Cloudflare DNS zone, Vercel project's production-domain configuration
- Produces: A reproducible operator checklist proving that Cloudflare is DNS-only and Vercel sees requests directly

- [ ] **Step 1: Write the operations document with the required state**

Add this decision table:

```markdown
| Control                                  | Required production state              |
| ---------------------------------------- | -------------------------------------- |
| Cloudflare apex record                   | DNS only (gray cloud), Vercel target   |
| Cloudflare `www` record                  | DNS only (gray cloud), Vercel target   |
| Cloudflare DNSSEC                        | Active after registrar DS confirmation |
| Cloudflare HTTP proxy/WAF/Bot Fight Mode | Not used for this Vercel site          |
| Vercel reverse-proxy warning             | Absent                                 |
| Vercel production custom domain          | Valid and serving                      |
```

Include rollback instructions: restore the last known-good DNS record values; do not orange-cloud the records as an incident workaround.

- [ ] **Step 2: Link the runbook from the README operations section**

Add exactly one link labeled `Vercel/Cloudflare edge boundary` so future operators do not infer that the Cloudflare Free proxy is part of the runtime path.

- [ ] **Step 3: Verify DNS resolution from two public resolvers**

Run:

```powershell
Resolve-DnsName <production-domain> -Server 1.1.1.1
Resolve-DnsName <production-domain> -Server 8.8.8.8
```

Expected: both resolvers return the Vercel-configured target/result, and the Cloudflare dashboard shows gray-cloud status.

- [ ] **Step 4: Verify the live response reaches Vercel directly**

Run:

```powershell
curl.exe -sS -D - -o NUL https://<production-domain>/api/healthz
```

Expected: `200`, Vercel response headers are present, and the Vercel project does not display a reverse-proxy warning.

- [ ] **Step 5: Commit the documentation**

```powershell
git add docs/operations/vercel-cloudflare-edge.md README.md
git commit -m "docs: define Vercel checkout security boundary"
```

---

### Task 2: Add BotID Basic to the Checkout-Link Route Contract

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.ts`
- Create: `instrumentation-client.ts`
- Create: `src/lib/security/checkout-bot.ts`
- Create: `tests/unit/checkout-bot.test.ts`

**Interfaces:**

- Consumes: `botid` package APIs `initBotId()` and `checkBotId()`
- Produces: `verifyCheckoutBrowser(): Promise<{ allowed: boolean; reason: "passed" | "bot" | "unavailable" }>`

- [ ] **Step 1: Install the official BotID package**

Run:

```powershell
npm install botid
```

Expected: `botid` appears in `dependencies` and the lockfile updates without peer-dependency errors.

- [ ] **Step 2: Write failing unit tests for the checkout verdict adapter**

Create tests that mock `botid/server` and assert:

```ts
await expect(verifyCheckoutBrowser()).resolves.toEqual({
  allowed: true,
  reason: "passed",
});

await expect(verifyCheckoutBrowser()).resolves.toEqual({
  allowed: false,
  reason: "bot",
});

await expect(verifyCheckoutBrowser()).resolves.toEqual({
  allowed: false,
  reason: "unavailable",
});
```

The third case must mock `checkBotId()` rejecting; checkout protection fails closed.

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-bot.test.ts
```

Expected: FAIL because `src/lib/security/checkout-bot.ts` does not exist.

- [ ] **Step 4: Configure BotID's same-origin rewrites**

Wrap the existing Next.js config without changing its image, header, or compiler settings:

```ts
import { withBotId } from "botid/next/config";

// existing nextConfig object remains unchanged
export default withBotId(nextConfig);
```

- [ ] **Step 5: Register only the browser-facing checkout-link endpoint**

Create `instrumentation-client.ts`:

```ts
import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/checkout/payment-link",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
  ],
});
```

Do not register Square or Shippo webhook routes.

- [ ] **Step 6: Implement the server adapter**

Create `src/lib/security/checkout-bot.ts`:

```ts
import { checkBotId } from "botid/server";

export type CheckoutBotVerdict = {
  allowed: boolean;
  reason: "passed" | "bot" | "unavailable";
};

export async function verifyCheckoutBrowser(): Promise<CheckoutBotVerdict> {
  try {
    const result = await checkBotId({
      advancedOptions: { checkLevel: "basic" },
    });

    return result.isBot
      ? { allowed: false, reason: "bot" }
      : { allowed: true, reason: "passed" };
  } catch {
    return { allowed: false, reason: "unavailable" };
  }
}
```

- [ ] **Step 7: Run focused tests and static checks**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-bot.test.ts
npm run typecheck
npm run lint
```

Expected: all commands pass.

- [ ] **Step 8: Commit BotID integration**

```powershell
git add package.json package-lock.json next.config.ts instrumentation-client.ts src/lib/security/checkout-bot.ts tests/unit/checkout-bot.test.ts
git commit -m "feat: add Vercel BotID checkout guard"
```

---

### Task 3: Trust Vercel Client Identity Without Duplicating Edge Limits

**Files:**

- Modify: `src/config/security.ts`
- Modify: `src/proxy/rate-limit.ts`
- Create: `src/lib/http/client-ip.ts`
- Create: `tests/unit/client-ip.test.ts`
- Create: `tests/unit/checkout-rate-limit.test.ts`

**Interfaces:**

- Consumes: Vercel's `x-vercel-forwarded-for` request header and Upstash Redis
- Produces: `getTrustedClientIp(request: NextRequest): string | null` and an explicit absence of an Upstash short-window IP policy for payment-link creation

- [ ] **Step 1: Write failing tests for trusted client-IP precedence**

Cover these exact cases:

```ts
expect(
  getTrustedClientIp(
    requestWith({
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-forwarded-for": "198.51.100.99",
    }),
  ),
).toBe("203.0.113.10");

expect(getTrustedClientIp(requestWith({ "x-vercel-forwarded-for": "" }))).toBeNull();
```

Permit `x-forwarded-for` only in a test/local-development branch so production callers cannot select their own rate-limit identity.

- [ ] **Step 2: Write failing tests that prevent duplicate checkout IP limiting**

Assert that the proxy policy does not assign an Upstash IP bucket to `POST /api/checkout/payment-link`:

```ts
expect(getPolicyForRequest("/api/checkout/payment-link", "POST")).toBeNull();
```

The application-level email/account/device quota added in Task 5 remains fail closed. Existing general browsing policies retain their current availability behavior.

- [ ] **Step 3: Run both focused tests and confirm failure**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/client-ip.test.ts tests/unit/checkout-rate-limit.test.ts
```

Expected: FAIL because the trusted-IP helper and checkout fail-closed policy do not exist.

- [ ] **Step 4: Implement trusted Vercel IP extraction**

Create `src/lib/http/client-ip.ts` with this public contract:

```ts
import type { NextRequest } from "next/server";

export function getTrustedClientIp(request: NextRequest): string | null {
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for");
  const firstVercelIp = vercelForwardedFor?.split(",")[0]?.trim();
  if (firstVercelIp) return firstVercelIp;

  const hostname = request.nextUrl.hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  if (!isLocal) return null;

  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
```

- [ ] **Step 5: Remove the broad checkout proxy policy**

Place this exact match before the general API read/write branches:

```ts
if (pathname === "/api/checkout/payment-link" && method.toUpperCase() === "POST") {
  return null;
}
```

Remove the old `60 per 1m` checkout default. Vercel owns the IP/JA4 burst control, while Task 5 owns fail-closed identity quotas.

- [ ] **Step 6: Use the trusted IP for evidence, not a second rate counter**

The payment-link route records the masked trusted IP in its audit event. If the Vercel header is missing in production, return:

```ts
NextResponse.json(
  { error: "Checkout protection is temporarily unavailable", requestId },
  { status: 503, headers: { "Cache-Control": "no-store" } },
);
```

The response path must execute before a Square client is invoked. Do not call Upstash for a second IP or JA4 limit.

- [ ] **Step 7: Run tests and static checks**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/client-ip.test.ts tests/unit/checkout-rate-limit.test.ts
npm run typecheck
npm run lint
```

Expected: all commands pass.

- [ ] **Step 8: Commit the rate-limit boundary**

```powershell
git add src/config/security.ts src/proxy/rate-limit.ts src/lib/http/client-ip.ts tests/unit/client-ip.test.ts tests/unit/checkout-rate-limit.test.ts
git commit -m "fix: fail closed on abusive checkout creation"
```

---

### Task 4: Enforce the Checkout Kill Switch Inside Payment-Link Creation

**Files:**

- Create: `src/lib/checkout/checkout-access.ts`
- Create: `tests/unit/checkout-access.test.ts`
- Modify: `app/api/checkout/payment-link/route.ts`
- Modify: `app/checkout/page.tsx`
- Modify: `app/checkout/start/page.tsx`

**Interfaces:**

- Consumes: `StoreAccessSettingsService.getSettings(tenantId)` and `isCheckoutLocked(settings)`
- Produces: `assertCheckoutOpen(tenantId: string): Promise<{ open: true } | { open: false; message: string }>`

- [ ] **Step 1: Write failing access-decision tests**

Test the persisted settings cases:

```ts
await expect(assertCheckoutOpen("tenant-1")).resolves.toEqual({ open: true });

await expect(assertCheckoutOpen("tenant-1")).resolves.toEqual({
  open: false,
  message: "Online checkout is temporarily unavailable.",
});
```

Also assert that a settings lookup failure returns `{ open: false, message: "Online checkout is temporarily unavailable." }`; payment creation must fail closed.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-access.test.ts
```

Expected: FAIL because the checkout access adapter does not exist.

- [ ] **Step 3: Implement the checkout access adapter**

Use the existing tenant lookup and service-role patterns. Return the configured lock message when locked, the generic message when configuration cannot be loaded, and `{ open: true }` only for an explicit unlocked decision.

- [ ] **Step 4: Put the guard at the beginning of the payment-link route**

The route's required order is:

```ts
const access = await assertCheckoutOpen(tenantId);
if (!access.open) {
  return NextResponse.json(
    { error: access.message },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

const bot = await verifyCheckoutBrowser();
if (!bot.allowed) {
  return NextResponse.json(
    { error: "Checkout verification failed" },
    { status: bot.reason === "bot" ? 403 : 503 },
  );
}
```

No Square API call, inventory reservation, or new order creation may appear above these guards.

- [ ] **Step 5: Replace the static unavailable pages only when the Square route is ready**

`app/checkout/page.tsx` and `app/checkout/start/page.tsx` currently render `CheckoutUnavailable` unconditionally. In the Square checkout implementation task, replace that static state with the real flow and render `CheckoutLockedNotice` only when `checkout_lock_enabled` is true.

- [ ] **Step 6: Run tests and static checks**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-access.test.ts tests/unit/checkout-page.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands pass and the page test no longer describes the public route as locked.

- [ ] **Step 7: Commit the kill-switch enforcement with the Square route implementation**

```powershell
git add src/lib/checkout/checkout-access.ts tests/unit/checkout-access.test.ts app/api/checkout/payment-link/route.ts app/checkout/page.tsx app/checkout/start/page.tsx tests/unit/checkout-page.test.tsx
git commit -m "feat: enforce checkout kill switch before Square"
```

---

### Task 5: Add Identity-Aware Daily Checkout Quotas and Link Reuse

**Files:**

- Create: `src/lib/checkout/checkout-attempt-limit.ts`
- Create: `src/lib/checkout/checkout-identity.ts`
- Create: `tests/unit/checkout-attempt-limit.test.ts`
- Modify: `app/api/checkout/payment-link/route.ts`
- Modify: `src/lib/checkout/idempotency.ts`

**Interfaces:**

- Consumes: Upstash Redis, trusted client IP, normalized buyer email, authenticated user ID when present, opaque device/session ID, checkout idempotency key
- Produces: `checkCheckoutAttempt(input: CheckoutAttemptIdentity): Promise<{ allowed: boolean; retryAfterSeconds: number | null }>` and `findReusableCheckout(idempotencyKey: string)`

- [ ] **Step 1: Define the identity contract in a failing test**

Use this exact type:

```ts
export type CheckoutAttemptIdentity = {
  tenantId: string;
  clientIp: string;
  userId: string | null;
  normalizedEmailHash: string;
  deviceSessionId: string;
};
```

Assert a maximum of 5 new payment links per email/account per 24 hours and 10 per device/session per 24 hours. Store only a keyed HMAC of normalized email, never the raw email in a Redis key.

- [ ] **Step 2: Add idempotency reuse tests**

Assert that an existing unexpired checkout for the same tenant and idempotency key returns its existing Square URL and does not call quota increment, reserve inventory again, or call Square again.

- [ ] **Step 3: Run the focused test and confirm failure**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-attempt-limit.test.ts
```

Expected: FAIL because the identity limiter does not exist.

- [ ] **Step 4: Implement atomic Upstash quota checks**

Use separate namespaced sliding-window buckets:

```text
rdk:checkout:tenant:<tenantId>:email:<emailHmac>
rdk:checkout:tenant:<tenantId>:user:<userId>
rdk:checkout:tenant:<tenantId>:device:<deviceSessionId>
```

Return `allowed: false` if any required limit rejects. On Redis/configuration errors, throw `checkout_protection_unavailable`; the API maps it to `503` before Square is called.

- [ ] **Step 5: Integrate reuse before quota consumption**

The payment-link route sequence must be:

```text
kill switch -> BotID -> input validation -> reusable-link lookup -> quotas ->
server cart validation -> inventory reservation -> local pending order -> Square link
```

Only a genuinely new Square link consumes the daily quota.

When a reusable link expires, deactivate/delete it at Square before releasing inventory. A late payment against an expired checkout enters `review` and cannot authorize fulfillment.

- [ ] **Step 6: Run tests and static checks**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-attempt-limit.test.ts
npm run typecheck
npm run lint
```

Expected: all commands pass.

- [ ] **Step 7: Commit identity-aware limiting**

```powershell
git add src/lib/checkout/checkout-attempt-limit.ts src/lib/checkout/checkout-identity.ts src/lib/checkout/idempotency.ts tests/unit/checkout-attempt-limit.test.ts app/api/checkout/payment-link/route.ts
git commit -m "feat: limit and reuse hosted checkout attempts"
```

---

### Task 6: Authenticate Square Webhooks Without Browser Challenges

**Files:**

- Create: `app/api/webhooks/square/route.ts`
- Create: `src/lib/square/webhook.ts`
- Create: `tests/unit/square-webhook.test.ts`
- Modify: `src/config/security.ts`
- Modify: `tests/unit/csrf.test.ts`
- Create in Square payment plan: Supabase migration adding a unique Square webhook event ID

**Interfaces:**

- Consumes: raw request body, `x-square-hmacsha256-signature`, exact configured notification URL, Square webhook signature key
- Produces: `verifySquareWebhookSignature(input: { rawBody: string; signature: string; notificationUrl: string }): boolean`

- [ ] **Step 1: Write signature and idempotency tests**

Cover:

- valid fixture signature returns `200` and persists the event once;
- altered body returns `401` and performs no writes;
- wrong notification URL returns `401` and performs no writes;
- duplicate Square event ID returns `200` without repeating an order transition;
- transient database error returns `500` so Square can retry.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/square-webhook.test.ts
```

Expected: FAIL because the Square webhook verifier and route do not exist.

- [ ] **Step 3: Implement verification against the raw body**

Read the body exactly once with `await request.text()`. Verify the signature before `JSON.parse(rawBody)`, logging, database writes, or order state transitions. Never include the signature key or full payload in logs.

- [ ] **Step 4: Add only the exact CSRF bypass**

Extend the existing list to:

```ts
bypassPrefixes: [
  "/api/webhooks/shippo",
  "/api/webhooks/square",
  "/api/auth/2fa/challenge/verify",
],
```

Do not add `/api/webhooks` as a broad bypass.

- [ ] **Step 5: Persist before applying transitions**

Insert the Square event ID into the webhook-event table under a unique constraint. If the insert reports a uniqueness conflict, return `200`. Otherwise apply the payment transition transactionally and acknowledge only after it commits.

- [ ] **Step 6: Run tests and static checks**

Run:

```powershell
npm run test:jest:unit -- --runTestsByPath tests/unit/square-webhook.test.ts tests/unit/csrf.test.ts
npm run typecheck
npm run lint
```

Expected: all commands pass.

- [ ] **Step 7: Commit webhook authentication**

```powershell
git add app/api/webhooks/square/route.ts src/lib/square/webhook.ts src/config/security.ts tests/unit/square-webhook.test.ts tests/unit/csrf.test.ts supabase/migrations
git commit -m "feat: verify and deduplicate Square webhooks"
```

---

### Task 7: Configure and Prove the Vercel Firewall Policy

**Files:**

- Modify: `docs/operations/vercel-cloudflare-edge.md`
- Create: `tests/e2e/checkout-perimeter.spec.ts`

**Interfaces:**

- Consumes: deployed preview/production application, Vercel Firewall dashboard
- Produces: a versioned firewall rule inventory and end-to-end evidence that browsers can create at most bounded checkout links while webhooks remain reachable

- [ ] **Step 1: Publish exact webhook browser-challenge exclusions**

Create the narrow exclusions before enabling challenges:

```text
Request Path equals /api/webhooks/square -> bypass Bot Protection only
Request Path equals /api/webhooks/shippo -> bypass Bot Protection only
```

Do not bypass platform DDoS mitigation, all custom rules, or the whole `/api/webhooks` prefix.

- [ ] **Step 2: Publish checkout WAF rules**

Configure:

```text
POST /api/checkout/payment-link, key IP, fixed window 3 requests / 10 minutes -> rate limit
POST /api/checkout/payment-link, key JA4 Digest, fixed window 5 requests / 10 minutes -> rate limit
POST /api/checkout/payment-link, country not US -> challenge
```

If the dashboard cannot combine method and exact path in the desired rule, match the exact path and rely on the application to reject non-POST methods with `405`.

- [ ] **Step 3: Observe Bot Protection before challenging**

Enable Bot Protection in log mode for at least one normal business-day traffic sample. Confirm the Vercel dashboard records storefront browsing, checkout, search-engine verified bots, Square webhooks, Shippo webhooks, and uptime checks correctly.

- [ ] **Step 4: Change Bot Protection to challenge mode**

Publish challenge mode only after Step 3 shows that webhook bypasses and legitimate customer flows work. Record the publication time and previous firewall revision in the operations document so instant rollback is possible.

- [ ] **Step 5: Write the E2E perimeter assertions**

The Playwright test must verify:

```ts
test("public checkout is reachable and payment creation is protected", async ({
  page,
}) => {
  await page.goto("/checkout");
  await expect(page).not.toHaveURL(/\/locked/);
  // Complete the pre-checkout form with Square sandbox data.
  // Assert the returned navigation host is Square's configured sandbox host.
});
```

Add API-context assertions for `403` on failed BotID classification, `429` after the edge/application threshold in an isolated test environment, and `503` when the checkout kill switch is enabled.

- [ ] **Step 6: Send signed Square and Shippo sandbox webhook tests**

Expected: both exact webhook routes reach the application while Bot Protection challenge mode is active. Invalid signatures still return `401`.

- [ ] **Step 7: Run the complete verification suite**

Run:

```powershell
npm run ci-env:check
npm run check:env-case
npm run check:file-case
npm run lint
npm run typecheck
npm run test:jest
npm run test:e2e -- tests/e2e/checkout-perimeter.spec.ts
npm run build
```

Expected: all commands pass against Square sandbox and the deployed Vercel test environment.

- [ ] **Step 8: Record the verified rule inventory and commit**

Document each Vercel rule name, match expression, action, ordering, publication date, owner, and rollback revision. Do not store secrets or copied webhook payloads.

```powershell
git add docs/operations/vercel-cloudflare-edge.md tests/e2e/checkout-perimeter.spec.ts
git commit -m "test: verify Vercel checkout perimeter"
```

---

### Task 8: Launch Monitoring and 60-Day Tuning

**Files:**

- Create: `docs/operations/checkout-security-monitoring.md`
- Modify: `docs/operations/vercel-cloudflare-edge.md`

**Interfaces:**

- Consumes: Vercel Firewall/BotID telemetry, application checkout events, Square payment and dispute data
- Produces: explicit alert thresholds, daily/weekly review cadence, and incident actions that do not change the edge architecture

- [ ] **Step 1: Define launch alerts**

Record these initial conditions:

```text
WARN: checkout 403 or 429 rate > 10% over 15 minutes
CRITICAL: more than 20 payment-link attempts from one IP or JA4 in 10 minutes
CRITICAL: more than 5 invalid Square webhook signatures in 10 minutes
CRITICAL: payment-link creations increase 3x while paid orders do not increase
WARN: checkout protection returns any 503 for 5 consecutive minutes
```

- [ ] **Step 2: Define the review cadence**

Review daily for the first 14 days and weekly through day 60. Record BotID blocks, WAF limits, false-positive customer reports, payment-link-to-paid conversion, Square declines, disputes, and confirmed card-testing patterns.

- [ ] **Step 3: Define incident actions**

Use this order:

```text
1. Enable the checkout kill switch if Square is actively being abused.
2. Preserve logs and Square event IDs.
3. Tighten the exact checkout WAF rules.
4. Temporarily enable Vercel Attack Challenge Mode for a broad attack.
5. Confirm Square/Shippo webhooks still deliver.
6. Restore normal mode after traffic stabilizes.
```

Explicitly prohibit enabling the Cloudflare proxy during an incident.

- [ ] **Step 4: Add the step-up decision rule**

Turnstile or BotID Deep Analysis may be proposed only when data shows Basic BotID plus rate limits are being bypassed. The change request must include attack evidence, false-positive risk, expected monthly cost, exact protected route, and rollback procedure.

- [ ] **Step 5: Record compliance, cost, and payment-risk launch gates**

Document annual SAQ ownership, quarterly PCI ASV scanning, Vercel and Upstash spend alerts, seven-year evidence retention, production Risk Manager/3DS validation, disabled Afterpay/tipping, Payment Link expiration, and the explicit deferral of Verifi/Ethoca-style pre-dispute alerts.

- [ ] **Step 6: Commit the monitoring runbook**

```powershell
git add docs/operations/checkout-security-monitoring.md docs/operations/vercel-cloudflare-edge.md
git commit -m "docs: add checkout security monitoring runbook"
```

## Final Acceptance Gate

Before production checkout is enabled, the release owner must record evidence for every criterion in the design spec's Launch Acceptance Criteria, confirm Square sandbox-to-production credential separation, confirm the tax-professional launch gate, and run the complete verification suite from Task 7. The static `CheckoutUnavailable` page may be removed only in the same reviewed release that makes the guarded Square payment-link endpoint and verified Square webhook handler production-ready.
