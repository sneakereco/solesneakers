# Single-Page Checkout Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gated checkout with a responsive, single-page `/checkout` that immediately shows fulfillment, contact/address, order totals, card fields, eligible Square wallets, Afterpay, and the final payment action while preserving fail-closed inventory, tax, bot, and payment controls.

**Architecture:** The browser requests a non-mutating authoritative quote whenever the cart or fulfillment changes and requests an exact Square `CalculateOrder` quote once a shippable address exists. A shared pure Square order builder feeds both `CalculateOrder` and the existing final `CreateOrder` path, and `/api/checkout/prepare` verifies the exact quote fingerprint before reserving inventory. The page server-loads only safe checkout defaults and public Square configuration; payment tokenization remains inside Square Web Payments SDK fields.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS, Zod 4, Square Node SDK 45.1, Square Web Payments SDK, Supabase, Jest 30, React Testing Library.

**Approved design:** [2026-09-07-single-page-checkout-overhaul-design.md](../specs/2026-09-07-single-page-checkout-overhaul-design.md)

## Global Constraints

- `/checkout` renders the order summary, delivery controls, contact fields, card field container, express-payment region, Afterpay region, and final payment action on first paint. Exact-quote-dependent methods may be visibly pending, but no section may be hidden behind a Continue or Update Order button.
- Shipping is selected initially. Shipping has one server-configured category flat rate and no customer-facing shipping-method selector. Pickup uses Square `scheduleType: "ASAP"` and `prepTimeDuration: "PT0S"`.
- Logged-in customers receive server-provided email, name, phone, and shipping-address defaults when available. Guests receive empty fields. Never send Square access tokens or service-role credentials to the browser.
- The right column contains only purchased items and subtotal, shipping, tax, and total. Do not add recommendations, insurance, discount entry, marketing opt-ins, save-information prompts, or reassurance icon rows.
- Square-native methods in scope are Card, Apple Pay, Google Pay, Cash App Pay, and Afterpay. Hide a wallet when SDK construction reports it unavailable. Shop Pay, PayPal, Venmo, Klarna, ACH, and Square gift cards are out of scope.
- Quote responses are `Cache-Control: no-store`. Preliminary shipping quotes have no payment-authorizing fingerprint. Only an exact, current quote can enter prepare/payment.
- Preserve existing checkout access, browser verification, CSRF, rate limiting, idempotency, reservation, payment-permit, payment, webhook, and reconciliation controls.

## Planned File Map

| File                                               | Responsibility                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/lib/checkout/checkout-request.ts`             | Quote/prepare request schemas and shared checkout transport types             |
| `src/lib/checkout/checkout-quote.ts`               | Quote handler, response contract, canonical fingerprint                       |
| `src/lib/checkout/checkout-quote-dependencies.ts`  | Production dependencies for the quote route                                   |
| `app/api/checkout/quote/route.ts`                  | Thin POST route adapter                                                       |
| `src/lib/square/checkout-order-payload.ts`         | Pure validated Square `Order` payload builder and total parser                |
| `src/lib/square/checkout-orders.ts`                | `CalculateOrder`, `CreateOrder`, and cancellation gateway calls               |
| `src/lib/checkout/checkout-page-data.ts`           | Safe server-side profile defaults and public Square configuration             |
| `app/checkout/page.tsx`                            | Access gate plus checkout page-data loading                                   |
| `src/components/checkout/CheckoutClient.tsx`       | One-page layout, form state, quote orchestration, final prepare callback      |
| `src/components/checkout/CheckoutOrderSummary.tsx` | Purchased items and four-row totals only                                      |
| `src/components/checkout/SquarePaymentMethods.tsx` | Always-mounted card, eligible wallets, Afterpay, Turnstile, pay orchestration |
| `src/lib/square/web-payments.ts`                   | Typed Square browser SDK surface for all approved methods                     |
| `src/config/security.ts`                           | Exact Square CSP allowances                                                   |
| `app/icon.png`                                     | Brand favicon served by Next.js metadata routing                              |

## Task 1: Define the Quote Contract and Staleness Fingerprint

**Files:**

- Modify: `src/lib/checkout/checkout-request.ts`
- Create: `src/lib/checkout/checkout-quote-fingerprint.ts`
- Modify: `tests/unit/checkout-request.test.ts`
- Create: `tests/unit/checkout-quote-fingerprint.test.ts`

- [ ] **Step 1: Write failing request-contract tests**

Add cases proving that a shipping quote may omit its address, a pickup quote rejects an address, duplicate variants remain invalid, and final prepare requires an exact quote fingerprint:

```ts
expect(
  checkoutQuoteRequestSchema.parse({
    items: [ITEM],
    fulfillment: "ship",
    shippingAddress: null,
  }),
).toMatchObject({ fulfillment: "ship", shippingAddress: null });

expect(() =>
  checkoutQuoteRequestSchema.parse({
    items: [ITEM],
    fulfillment: "pickup",
    shippingAddress: ADDRESS,
  }),
).toThrow();

expect(() =>
  prepareCheckoutRequestSchema.parse({ ...PREPARE, quoteFingerprint: undefined }),
).toThrow();
```

- [ ] **Step 2: Run the contract tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-request.test.ts`

Expected: FAIL because `checkoutQuoteRequestSchema` and the required `quoteFingerprint` field do not exist.

- [ ] **Step 3: Export the shared item schema and add quote/prepare contracts**

Implement this public shape in `checkout-request.ts`:

```ts
export const checkoutItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(5),
}).strict();

export const checkoutQuoteRequestSchema = z.object({
  items: z.array(checkoutItemSchema).min(1).max(10),
  fulfillment: z.enum(["ship", "pickup"]),
  shippingAddress: checkoutShippingAddressSchema.nullable(),
}).strict().superRefine(validateUniqueVariantsAndFulfillment);

// Add inside prepareCheckoutRequestSchema:
quoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/),

export type CheckoutQuoteRequest = z.infer<typeof checkoutQuoteRequestSchema>;
export type CheckoutQuoteResponse =
  | {
      completeness: "preliminary";
      totals: Omit<CheckoutTotals, "taxCents"> & { taxCents: null };
      quoteFingerprint: null;
    }
  | {
      completeness: "exact";
      totals: CheckoutTotals;
      quoteFingerprint: string;
    };
export type ExactCheckoutQuote = Extract<
  CheckoutQuoteResponse,
  { completeness: "exact" }
>;
```

Extract the existing duplicate-variant and fulfillment checks into one local `validateUniqueVariantsAndFulfillment` helper so quote and prepare cannot drift.

- [ ] **Step 4: Write failing deterministic-fingerprint tests**

Test that property insertion order does not affect the result and that changing a variant, quantity, fulfillment, normalized address, or any total changes the result.

- [ ] **Step 5: Implement one canonical SHA-256 fingerprint function**

```ts
import { createHash } from "node:crypto";

export type ExactCheckoutQuoteInput = {
  items: Array<{ variantId: string; quantity: number; unitPriceCents: number }>;
  fulfillment: "ship" | "pickup";
  shippingAddress: CheckoutQuoteRequest["shippingAddress"];
  totals: CheckoutTotals;
};

export function createCheckoutQuoteFingerprint(input: ExactCheckoutQuoteInput): string {
  const canonical = {
    ...input,
    items: [...input.items].sort((a, b) => a.variantId.localeCompare(b.variantId)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
```

Define `CheckoutTotals` once in `checkout-request.ts` and import it in client/server code. This fingerprint is a consistency token, not an authorization token; the server must recompute it.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-request.test.ts tests/unit/checkout-quote-fingerprint.test.ts`

Expected: PASS.

Commit: `git add src/lib/checkout/checkout-request.ts src/lib/checkout/checkout-quote-fingerprint.ts tests/unit/checkout-request.test.ts tests/unit/checkout-quote-fingerprint.test.ts && git commit -m "feat: define checkout quote contract"`

## Task 2: Share Square Order Construction Between Quote and Create

**Files:**

- Create: `src/lib/square/checkout-order-payload.ts`
- Modify: `src/lib/square/checkout-orders.ts`
- Modify: `src/lib/square/client.ts`
- Modify: `tests/unit/square-checkout-orders.test.ts`
- Create: `tests/unit/square-checkout-order-payload.test.ts`

- [ ] **Step 1: Write failing payload-parity tests**

Cover shipment, pickup, shipping service charge, item names/SKUs, automatic taxes, invalid cents, subtotal mismatch, and Square-total parsing. The central assertion must prove both gateway operations receive the same `order` value except that final create includes `referenceId`:

```ts
expect(orders.calculate).toHaveBeenCalledWith({ order: expectedOrder });
expect(orders.create).toHaveBeenCalledWith({
  idempotencyKey: INPUT.idempotencyKey,
  order: { ...expectedOrder, referenceId: INPUT.localOrderId },
});
```

- [ ] **Step 2: Run Square order tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-checkout-orders.test.ts tests/unit/square-checkout-order-payload.test.ts`

Expected: FAIL because the pure builder and `calculate` gateway method do not exist.

- [ ] **Step 3: Extract a pure Square order builder**

Move `assertCents`, item validation, `itemName`, address mapping, line items, service charges, fulfillments, and pricing options out of `checkout-orders.ts`:

```ts
export type SquareCheckoutOrderPayloadInput = {
  fulfillment: "ship" | "pickup";
  buyerEmail?: string;
  subtotalCents: number;
  shippingCents: number;
  shippingAddress: CheckoutQuoteRequest["shippingAddress"];
  items: CheckoutReservationItem[];
  referenceId?: string;
};

export function buildSquareCheckoutOrder(
  locationId: string,
  input: SquareCheckoutOrderPayloadInput,
): Square.Order;

export function readSquareCheckoutTotals(
  order: Square.Order,
  expectedSubtotalCents: number,
  expectedShippingCents: number,
): CheckoutTotals;
```

The pickup branch must remain exactly:

```ts
pickupDetails: {
  scheduleType: "ASAP",
  prepTimeDuration: "PT0S",
}
```

- [ ] **Step 4: Add non-mutating calculation to the gateway**

Extend the local `OrdersClient` type with `calculate(request: Square.CalculateOrderRequest)` and implement:

```ts
async calculate(input: SquareCheckoutOrderPayloadInput): Promise<CheckoutTotals> {
  const requestOrder = buildSquareCheckoutOrder(this.locationId, input);
  const response = await this.orders.calculate({ order: requestOrder });
  if (!response.order) throw new Error("square_checkout_quote_invalid_response");
  return readSquareCheckoutTotals(
    response.order,
    input.subtotalCents,
    input.shippingCents,
  );
}
```

Refactor `create()` to call the same builder with `referenceId: input.localOrderId` and the same totals parser. Keep cancellation behavior unchanged.

- [ ] **Step 5: Run focused tests and typecheck, then commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-checkout-orders.test.ts tests/unit/square-checkout-order-payload.test.ts`

Run: `npm run typecheck`

Expected: both PASS.

Commit: `git add src/lib/square/checkout-order-payload.ts src/lib/square/checkout-orders.ts src/lib/square/client.ts tests/unit/square-checkout-orders.test.ts tests/unit/square-checkout-order-payload.test.ts && git commit -m "refactor: share Square checkout order payload"`

## Task 3: Add the Non-Mutating Quote Endpoint

**Files:**

- Create: `src/lib/checkout/checkout-quote.ts`
- Create: `src/lib/checkout/checkout-quote-dependencies.ts`
- Create: `app/api/checkout/quote/route.ts`
- Create: `tests/unit/checkout-quote.test.ts`
- Modify: `tests/unit/checkout-api-routes.test.ts`
- Modify: `tests/unit/checkout-rate-limit.test.ts`

- [ ] **Step 1: Write failing handler tests**

Cover malformed JSON (400), unavailable checkout (503), failed browser verification, missing tenant, unavailable product, preliminary shipping quote, exact shipping quote, exact pickup quote, Square failure (503), and `Cache-Control: no-store`. Assert the preliminary path never calls Square:

```ts
expect(response.status).toBe(200);
await expect(response.json()).resolves.toEqual({
  completeness: "preliminary",
  totals: {
    subtotalCents: 10_000,
    shippingCents: 1_500,
    taxCents: null,
    totalCents: 11_500,
  },
  quoteFingerprint: null,
});
expect(deps.calculateSquareOrder).not.toHaveBeenCalled();
expect(response.headers.get("cache-control")).toBe("no-store");
```

- [ ] **Step 2: Run quote tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-quote.test.ts tests/unit/checkout-api-routes.test.ts tests/unit/checkout-rate-limit.test.ts`

Expected: FAIL because the handler, route, and dependencies do not exist.

- [ ] **Step 3: Implement the quote response contract and handler**

Use the discriminated response from `checkout-request.ts` so the UI cannot mistake an estimate for a payable quote:

```ts
const response: CheckoutQuoteResponse = shippingAddress
  ? { completeness: "exact", totals, quoteFingerprint }
  : {
      completeness: "preliminary",
      totals: { ...flatRateTotals, taxCents: null },
      quoteFingerprint: null,
    };
```

Handler order:

1. Parse JSON and `checkoutQuoteRequestSchema`.
2. Resolve tenant and call `assertCheckoutOpen` through injected dependencies.
3. Verify browser/request identity with the same checkout bot boundary used by prepare.
4. Resolve current products, quantities, availability, and server prices.
5. Calculate category flat shipping through `checkout-pricing-gateway`.
6. Return preliminary data only when fulfillment is shipping and address is null.
7. Otherwise call Square `CalculateOrder`, create the fingerprint from resolved items/address/totals, and return exact data.

Use the existing checkout error vocabulary and `logError` conventions; do not expose Square response bodies.

- [ ] **Step 4: Wire production dependencies and route**

`createCheckoutQuoteDependencies(requestId)` must lazily construct the Square gateway and inject only read/non-mutating operations. The route stays thin:

```ts
export const runtime = "nodejs";

export function POST(request: NextRequest): Promise<Response> {
  return checkoutQuoteHandler(
    request,
    createCheckoutQuoteDependencies(getRequestIdFromHeaders(request.headers)),
  );
}
```

Do not create an application-level reservation limiter for quote traffic. Confirm `/api/checkout/quote` continues to use the proxy's existing authenticated/general API write limiter, while prepare/payment remain under their current dedicated policy.

- [ ] **Step 5: Add route and rate-policy assertions**

Extend the route table with `quote`, and assert the quote route receives the intended `api_write` rate-limit decision instead of the prepare/payment exemption.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-quote.test.ts tests/unit/checkout-api-routes.test.ts tests/unit/checkout-rate-limit.test.ts`

Expected: PASS.

Commit: `git add app/api/checkout/quote/route.ts src/lib/checkout/checkout-quote.ts src/lib/checkout/checkout-quote-dependencies.ts tests/unit/checkout-quote.test.ts tests/unit/checkout-api-routes.test.ts tests/unit/checkout-rate-limit.test.ts && git commit -m "feat: add checkout quote endpoint"`

## Task 4: Require the Current Exact Quote Before Reservation

**Files:**

- Modify: `src/lib/checkout/prepare-checkout.ts`
- Modify: `src/lib/checkout/prepare-checkout-dependencies.ts`
- Modify: `tests/unit/prepare-checkout.test.ts`

- [ ] **Step 1: Write failing stale-quote tests**

Add cases for matching quote, mismatched totals/fingerprint, changed inventory price, changed address, and Square calculation failure. A stale quote must return 409 and must not reserve or create an order:

```ts
expect(response.status).toBe(409);
expect(await response.json()).toEqual({
  error: "Checkout totals changed. Review the updated total and try again.",
});
expect(deps.reserve).not.toHaveBeenCalled();
expect(deps.createSquareOrder).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run prepare tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/prepare-checkout.test.ts`

Expected: FAIL because prepare does not calculate or validate an exact quote.

- [ ] **Step 3: Recompute and compare before any mutation**

After cart resolution and flat-rate pricing, but before `reserve`, call the shared Square calculation, derive the fingerprint using current server data, and compare it with `body.quoteFingerprint` using `timingSafeEqual` over equal-length buffers. Return 409 on mismatch.

```ts
const totals = await dependencies.calculateSquareOrder(squareInput);
const currentFingerprint = createCheckoutQuoteFingerprint({
  items: resolved.items.map(({ variantId, quantity, unitPriceCents }) => ({
    variantId,
    quantity,
    unitPriceCents,
  })),
  fulfillment: body.fulfillment,
  shippingAddress: body.shippingAddress,
  totals,
});

if (!quoteFingerprintsMatch(body.quoteFingerprint, currentFingerprint)) {
  return Response.json(
    { error: "Checkout totals changed. Review the updated total and try again." },
    { status: 409 },
  );
}
```

Keep the final Square `CreateOrder` response authoritative. If it unexpectedly differs from the calculated totals, fail and run the existing order/reservation cleanup path.

- [ ] **Step 4: Wire the calculation dependency**

Add `calculateSquareOrder` to `PrepareCheckoutDependencies` and bind it to the same lazily constructed `SquareCheckoutOrdersGateway` used for create/cancel.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/prepare-checkout.test.ts tests/unit/square-checkout-orders.test.ts`

Expected: PASS.

Commit: `git add src/lib/checkout/prepare-checkout.ts src/lib/checkout/prepare-checkout-dependencies.ts tests/unit/prepare-checkout.test.ts && git commit -m "feat: reject stale checkout quotes"`

## Task 5: Server-Load Safe Contact Defaults and Public Payment Configuration

**Files:**

- Create: `src/lib/checkout/checkout-page-data.ts`
- Modify: `app/checkout/page.tsx`
- Modify: `tests/unit/checkout-page.test.tsx`
- Create: `tests/unit/checkout-page-data.test.ts`

- [ ] **Step 1: Write failing page-data tests**

Cover guest defaults, account email/name fallback, complete `shipping_profiles` mapping, malformed/partial profile fields becoming empty strings, and missing Square application configuration failing closed.

```ts
expect(await loadCheckoutPageData(deps)).toEqual({
  isGuest: false,
  customer: {
    email: "buyer@example.com",
    address: {
      name: "Buyer Name",
      phone: "3025550100",
      line1: "1 Market St",
      line2: "",
      city: "Wilmington",
      state: "DE",
      postalCode: "19801",
      country: "US",
    },
  },
  paymentConfig: {
    applicationId: "sandbox-sq0idb-example",
    locationId: "LOCATION",
    environment: "sandbox",
  },
});
```

- [ ] **Step 2: Run page tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-page.test.tsx tests/unit/checkout-page-data.test.ts`

Expected: FAIL because `loadCheckoutPageData` and `CheckoutClient` props do not exist.

- [ ] **Step 3: Implement the server loader**

Define serializable props only:

```ts
export type CheckoutPageData = {
  isGuest: boolean;
  customer: {
    email: string;
    address: CheckoutAddressForm;
  };
  paymentConfig: {
    applicationId: string;
    locationId: string;
    environment: SquareEnvironment;
  };
};
```

Load `getServerSession()`. For a signed-in user, instantiate `ShippingService` with the request-scoped Supabase server client and map the profile; fall back from shipping-profile name to `session.profile?.full_name`, and from profile email to `session.user.email`. For guests, do not query `shipping_profiles`. Read Square configuration server-side and return only application ID, location ID, and environment.

- [ ] **Step 4: Pass defaults through the access-gated page**

Load page data only after `loadCheckoutPageAccess()` reports open:

```tsx
if (!access.open) return <CheckoutLockedNotice message={access.message} />;
const pageData = await loadCheckoutPageData();
return <CheckoutClient initialData={pageData} />;
```

If page-data loading fails, render the existing generic checkout-unavailable state and log server-side; do not leak configuration details.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-page.test.tsx tests/unit/checkout-page-data.test.ts`

Expected: PASS.

Commit: `git add src/lib/checkout/checkout-page-data.ts app/checkout/page.tsx tests/unit/checkout-page.test.tsx tests/unit/checkout-page-data.test.ts && git commit -m "feat: preload checkout customer defaults"`

## Task 6: Expand Square Browser Support Without Remounting Card Fields

**Files:**

- Modify: `src/lib/square/web-payments.ts`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `tests/unit/square-web-payments.test.ts`
- Modify: `tests/unit/square-payment-methods.test.tsx`

- [ ] **Step 1: Write failing SDK-surface and lifecycle tests**

Add typed mocks for `applePay`, `googlePay`, and `cashAppPay`. Prove:

- Card attaches as soon as public Square configuration exists, before an exact quote.
- Changing form fields or refreshing a quote does not destroy/recreate Card.
- Apple Pay, Google Pay, Cash App Pay, and Afterpay regions are present immediately.
- Exact totals initialize eligible express methods; an unavailable method is hidden without disabling Card.
- Each method sends its exact `paymentMethodSchema` value to the permit endpoint.

- [ ] **Step 2: Run payment tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-web-payments.test.ts tests/unit/square-payment-methods.test.tsx`

Expected: FAIL because the SDK type and component support only Card/Afterpay and Card is tied to a prepared order.

- [ ] **Step 3: Expand the Square Web Payments types**

```ts
export type SquarePayments = {
  card(): Promise<SquarePaymentMethod>;
  paymentRequest(input: Record<string, unknown>): SquarePaymentRequest;
  applePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  googlePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  cashAppPay(
    request: SquarePaymentRequest,
    options: { redirectURL: string; referenceId: string },
  ): Promise<SquarePaymentMethod>;
  afterpayClearpay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
};
```

Keep the script loader singleton behavior and `authorizeAndTokenize` permit-before-tokenize order unchanged.

- [ ] **Step 4: Separate stable Card mounting from exact-quote methods**

Refactor props to this boundary:

```ts
type SquarePaymentMethodsProps = {
  paymentConfig: CheckoutPageData["paymentConfig"];
  exactQuote: ExactCheckoutQuote | null;
  fulfillment: "ship" | "pickup";
  buyerEmail: string;
  shippingAddress: Address | null;
  isGuest: boolean;
  prepare(method: PaymentMethod): Promise<PreparedCheckout>;
  clearCart(): void;
};
```

Use one effect keyed only by stable `paymentConfig` to load Square and attach Card. Use a second effect keyed by the exact quote fingerprint to construct a `paymentRequest` and independently try each express method. Catch each constructor separately and hide only that method. Destroy only the methods created by that effect.

For Cash App Pay, set `redirectURL` from `window.location.href` and use `exactQuote.quoteFingerprint.slice(0, 40)` as the non-sensitive, length-bounded `referenceId`. Keep the approved shipping-contact validation for Afterpay.

- [ ] **Step 5: Preserve user-gesture tokenization for wallets**

Card keeps the stricter prepare and permit-before-tokenize sequence:

```ts
const checkout = await prepare(method);
const authorization = await authorizeAndTokenize({
  permitRequest: {
    orderId: checkout.orderId,
    guestAccessToken: checkout.guestAccessToken,
    deviceSessionId: checkout.deviceSessionId,
    method,
    turnstileToken: isGuest ? turnstileToken : undefined,
  },
  paymentMethod,
  verificationDetails: method === "card" ? cardVerification(checkout, buyer) : undefined,
});
await payAndRedirect(authorization);
```

Apple Pay must call `tokenize()` immediately inside its click handler with no intervening asynchronous work, as required by Square and Apple. Google Pay and Cash App Pay use the same wallet-safe sequence for consistency: tokenize immediately, then prepare the current exact quote, request the method-bound permit, and submit the token to `/api/checkout/pay`. Afterpay may retain prepare-before-tokenize because its redirect flow does not impose Apple Pay's user-gesture restriction.

Do not store a prepared order in component state across form edits. Disable payment while prepare/pay is running and surface errors inside the Payment section. A wallet token alone cannot charge the buyer; prepare, permit validation, and `/pay` remain mandatory before payment creation.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-web-payments.test.ts tests/unit/square-payment-methods.test.tsx`

Expected: PASS.

Commit: `git add src/lib/square/web-payments.ts src/components/checkout/SquarePaymentMethods.tsx tests/unit/square-web-payments.test.ts tests/unit/square-payment-methods.test.tsx && git commit -m "feat: add Square express checkout methods"`

## Task 7: Build the Immediate Two-Column Checkout Experience

**Files:**

- Modify: `src/components/checkout/CheckoutClient.tsx`
- Create: `src/components/checkout/CheckoutOrderSummary.tsx`
- Modify: `tests/unit/checkout-client.test.tsx`
- Delete: `tests/unit/checkout-client-prepared.test.tsx`
- Create: `tests/unit/checkout-order-summary.test.tsx`

- [ ] **Step 1: Replace prepared-state tests with behavior tests**

Test the actual customer contract rather than mocking React state internals:

- First render shows Contact, Delivery, Payment, order items, subtotal, shipping, tax, total, express region, card container, and Pay button.
- Shipping is selected and all address fields are visible initially.
- Initial data pre-fills signed-in contact/address values.
- Pickup removes street/city/state/ZIP fields but keeps name, phone, email, and the pickup location panel.
- No forbidden copy exists: `news and offers`, `Shipping method`, `Save my information`, `Other Also Bought`, or `Continue to secure payment`.

- [ ] **Step 2: Run client tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-client.test.tsx tests/unit/checkout-client-prepared.test.tsx tests/unit/checkout-order-summary.test.tsx`

Expected: FAIL because the current checkout hides totals/payment until submit and uses the old single-column layout.

- [ ] **Step 3: Implement quote state with stale-response protection**

Represent state explicitly:

```ts
type QuoteState =
  | { status: "loading"; requestId: number; previous: CheckoutQuoteResponse | null }
  | { status: "ready"; requestId: number; quote: CheckoutQuoteResponse }
  | { status: "error"; requestId: number; message: string };
```

On cart/fulfillment changes, quote immediately. For shipping, send `shippingAddress: null` until all required address fields validate, then debounce the exact quote by 300 ms. Increment a request counter and abort the prior fetch; accept a response only when its request ID is current. Pickup requests an exact quote immediately.

The final `prepare(method)` callback must:

1. Validate email/contact/address for the selected fulfillment.
2. Require `quote.completeness === "exact"` and its fingerprint.
3. POST the same normalized cart/fulfillment/address plus fingerprint, idempotency key, and device session ID to `/api/checkout/prepare`.
4. On 409, clear the idempotency key, refresh the quote, and show the stale-total message without tokenizing.
5. Store a returned guest access token and return the prepared checkout to the payment component.

- [ ] **Step 4: Implement the single-page responsive layout**

Use one responsive grid and one summary instance. `SquarePaymentMethods` returns an express section with `order-1` and a regular Payment section with `order-4`, allowing Contact and Delivery to remain between them without mounting Square twice:

```tsx
<main className="mx-auto grid w-full max-w-7xl grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.78fr)]">
  <section className="order-2 px-5 py-8 lg:order-1 lg:px-12 lg:py-12">
    <form className="flex flex-col" onSubmit={(event) => event.preventDefault()}>
      <SquarePaymentMethods
        paymentConfig={initialData.paymentConfig}
        exactQuote={exactQuote}
        fulfillment={fulfillment}
        buyerEmail={email}
        shippingAddress={normalizedShippingAddress}
        isGuest={initialData.isGuest}
        prepare={prepare}
        clearCart={clearCompletedCheckout}
      />
      <section className="order-2" aria-labelledby="contact-heading">
        {contactFields}
      </section>
      <fieldset className="order-3">{deliveryFields}</fieldset>
    </form>
  </section>
  <CheckoutOrderSummary
    className="order-1 lg:order-2"
    items={items}
    quoteState={quoteState}
  />
</main>
```

Do not create fake express buttons. `SquarePaymentMethods` owns the real Square containers and their availability state. Use semantic headings/fieldsets, persistent labels, `autocomplete` attributes, visible keyboard focus, and `aria-live="polite"` for changing totals/status.

- [ ] **Step 5: Implement the summary as a pure component**

`CheckoutOrderSummary` receives cart items and quote state. It displays server totals when ready; during initial loading it may display the cart subtotal as an explicitly temporary value. Preliminary shipping renders `Tax — Calculated after address` and an `Estimated total` label. Exact quotes render numeric tax and `Total`. No action other than viewing purchased items belongs in this component.

- [ ] **Step 6: Run client tests and commit**

Delete the state-mocking `checkout-client-prepared.test.tsx` only after its meaningful prepared/payment assertions exist in the new tests.

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-client.test.tsx tests/unit/checkout-order-summary.test.tsx tests/unit/square-payment-methods.test.tsx`

Expected: PASS.

Commit: `git add src/components/checkout/CheckoutClient.tsx src/components/checkout/CheckoutOrderSummary.tsx src/components/checkout/SquarePaymentMethods.tsx tests/unit/checkout-client.test.tsx tests/unit/checkout-order-summary.test.tsx tests/unit/square-payment-methods.test.tsx && git rm tests/unit/checkout-client-prepared.test.tsx && git commit -m "feat: build single-page checkout experience"`

## Task 8: Repair Square CSP, Turnstile Diagnostics, and Favicon

**Files:**

- Modify: `src/config/security.ts`
- Modify: `tests/unit/security-headers.test.ts`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`
- Create: `app/icon.png`

- [ ] **Step 1: Write failing directive-specific CSP tests**

Parse CSP into directives and assert exact membership instead of matching a hostname anywhere:

```ts
expect(directives.get("style-src")).toEqual(
  expect.arrayContaining([
    "https://web.squarecdn.com",
    "https://sandbox.web.squarecdn.com",
  ]),
);
expect(directives.get("font-src")).toEqual(
  expect.arrayContaining([
    "https://square-fonts-production-f.squarecdn.com",
    "https://d1g145x70srn7h.cloudfront.net",
  ]),
);
expect(directives.get("connect-src")).toEqual(
  expect.arrayContaining([
    "https://web.squarecdn.com",
    "https://sandbox.web.squarecdn.com",
    "https://pci-connect.squareup.com",
    "https://pci-connect.squareupsandbox.com",
    "https://o160250.ingest.sentry.io",
  ]),
);
```

- [ ] **Step 2: Run security/payment tests and confirm RED**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/security-headers.test.ts tests/unit/square-payment-methods.test.tsx`

Expected: FAIL because Square stylesheet/font/connect hosts are absent and Turnstile errors are not classified.

- [ ] **Step 3: Add Square's required hosts to the correct directives**

Update both development and production `style-src`, `font-src`, and `connect-src` values. Retain all existing sources and do not broaden production to a wildcard `https:` source. Keep `script-src` and `frame-src` Square entries.

- [ ] **Step 4: Make Turnstile configuration failures non-retrying and actionable**

Type the Turnstile error callback to accept the error code. On `110200`, set a stable message such as `Guest verification is not configured for this checkout hostname.` and mark the widget unavailable for this mount. Do not call `reset()` after a terminal configuration error. Other errors remain retryable after a payment attempt.

This code change improves diagnosis only. The staging fix still requires adding `soles-stg.vercel.app` to the Turnstile widget's Cloudflare **Hostname Management** list.

- [ ] **Step 5: Generate and verify the brand favicon**

Use the existing square brand image as source and generate a 64 px PNG without adding a dependency. Next.js metadata routing will publish it as the site icon:

```powershell
node -e "const sharp=require('sharp'); sharp('public/images/logo_og.jpg').resize(64,64,{fit:'cover'}).png().toFile('app/icon.png')"
```

Verify the icon URL emitted by the built page returns 200 and that the browser no longer requests a missing `/favicon.ico`.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/security-headers.test.ts tests/unit/square-payment-methods.test.tsx`

Expected: PASS.

Commit: `git add src/config/security.ts src/components/checkout/SquarePaymentMethods.tsx tests/unit/security-headers.test.ts tests/unit/square-payment-methods.test.tsx app/icon.png && git commit -m "fix: allow secure Square checkout assets"`

## Task 9: Verify the Complete Checkout and Record External Gates

**Files:**

- Modify if needed: files already touched by Tasks 1–8
- Create: `docs/verification/2026-09-07-single-page-checkout.md`

- [ ] **Step 1: Run the complete automated verification set**

Run each command independently so a failure has one owner:

```powershell
npm run test:jest:unit -- --runInBand --testPathIgnorePatterns=.worktrees
npm run test:jest:integration -- --runInBand --testPathIgnorePatterns=.worktrees
npm run typecheck
npm run lint
npm run build
```

Expected: all exit 0. If typecheck reports a deleted route only from `.next/dev/types/validator.ts`, run `npx next typegen` and retry before changing application code.

- [ ] **Step 2: Inspect the desktop checkout at 1440 x 1000**

Start `npm run dev:test`, open `/checkout`, and capture evidence that:

- The left column immediately contains express methods, Contact, Delivery, Payment, and Pay.
- The right column contains only purchased items and the four totals rows.
- Card fields attach without CSP errors.
- Shipping is initially selected and preliminary tax copy is visible until the address is complete.
- The browser console has no application-owned error; identify any remaining third-party `c.js` source before changing BotID or analytics.

- [ ] **Step 3: Inspect mobile behavior at 390 x 844**

Confirm one column, order summary first, no horizontal overflow, all labels visible, and keyboard focus reaches delivery, contact, card, eligible wallets, Afterpay, Turnstile, and Pay in a logical sequence.

- [ ] **Step 4: Exercise staging flows and record evidence**

On `soles-stg.vercel.app`, record timestamp, account mode, fulfillment, displayed total, Square order ID, local order ID, and final status for:

1. Signed-in shipping with prefill and flat shipping.
2. Guest shipping with Turnstile and Card.
3. Pickup with zero shipping and ASAP Square fulfillment.
4. Each device-eligible wallet: Apple Pay, Google Pay, Cash App Pay.
5. Afterpay eligibility plus one refund/reconciliation proof using the established operational process.

Do not treat a rendered button as payment proof. Unavailable device-specific wallets should be recorded as unavailable with browser/device evidence, not forced visible.

- [ ] **Step 5: Write the verification record and final commit**

The document must have five short sections: automated commands, desktop capture, mobile capture, successful transaction matrix, and external blockers. Record the required Cloudflare hostname configuration as unresolved until the dashboard change and a guest payment prove it.

Run: `git status --short`

Expected: only the verification document and intentional fixes from this task are present.

Commit: `git add docs/verification/2026-09-07-single-page-checkout.md && git commit -m "docs: verify single-page checkout"`

## Acceptance Checklist

- [ ] `/checkout` shows delivery, contact/address, purchased items, totals, payment fields, and payment actions immediately with no Continue/Update gate.
- [ ] Shipping and pickup both receive an exact Square quote; only final prepare mutates inventory or creates an order; stale quotes stop before reservation.
- [ ] Card works under CSP, eligible Apple Pay/Google Pay/Cash App Pay methods appear, Afterpay remains available when eligible, and unsupported methods stay hidden.
- [ ] Signed-in defaults, guest Turnstile behavior, desktop/mobile layout, pickup ASAP fulfillment, tax, payment, webhook, reconciliation, and refund evidence are recorded.
- [ ] No excluded marketing, upsell, insurance, discount, shipping-method, saved-info, or reassurance UI appears.

## Authoritative References

- Square Calculate Order: <https://developer.squareup.com/reference/square/orders-api/calculate-order>
- Square Web Payments methods: <https://developer.squareup.com/reference/sdks/web/payments>
- Square Apple Pay requirements: <https://developer.squareup.com/docs/web-payments/apple-pay>
- Square Web Payments CSP: <https://developer.squareup.com/docs/web-payments/content-security-policy>
- Cloudflare Turnstile error codes: <https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/>
