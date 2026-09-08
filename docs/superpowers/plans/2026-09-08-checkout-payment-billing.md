# Checkout Payment and Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Card/Afterpay payment panel, collect a valid billing address, supply it to Square, and persist an immutable billing snapshot atomically with checkout reservation.

**Architecture:** A shared billing schema normalizes the browser contract. `SquarePaymentMethods` owns payment selection and visible billing state, while `CheckoutClient` sends the resolved billing data through protected prepare. The reservation RPC writes `order_billing` in the same transaction as the order and inventory reservation.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS, Square Web Payments SDK, Supabase/PostgreSQL, Zod 4, Jest 30.

**Spec:** [2026-09-08-checkout-payment-billing-design.md](../specs/2026-09-08-checkout-payment-billing-design.md)

## Global Constraints

- Credit card is selected by default; Afterpay is a regular payment method below Card, never an Express checkout method.
- Square continues to own card number, expiration, security code, tokenization, and payment-method eligibility.
- Card and Afterpay require a normalized US billing address before reservation.
- Billing is stored once in `order_billing` in the reservation transaction and is never saved to `user_billing_addresses`.
- Apple Pay, Google Pay, Cash App Pay, Turnstile, one-use permits, server-authoritative totals, inventory reservation, and webhook authority remain intact.
- Do not add dependencies or expose raw card details to application code.
- Preserve unrelated `package-lock.json`, `AGENTS.md`, and `CLAUDE.md` working-tree changes.

---

### Task 1: Define the billing contract and checkout identity

**Files:**

- Modify: `src/lib/checkout/checkout-request.ts`
- Modify: `src/lib/checkout/checkout-cart-hash.ts`
- Modify: `tests/unit/checkout-request.test.ts`
- Modify: `tests/unit/checkout-cart-hash.test.ts`

**Interfaces:**

- Consumes: existing `paymentMethodSchema`, shipping address schema, and prepare request.
- Produces: `checkoutBillingAddressSchema`, `CheckoutBillingAddress`, required Card/Afterpay prepare billing, and billing-bound cart hashes.

- [ ] **Step 1: Write failing billing-schema tests.** Add a normalized fixture and assertions that Card/Afterpay require it, pickup accepts it without shipping, express wallets may omit it, and malformed state/country/name fields fail:

```ts
const billingAddress = {
  givenName: "Buyer",
  familyName: "Example",
  phone: null,
  line1: "1 Billing Street",
  line2: null,
  city: "Charleston",
  state: "sc",
  postalCode: "29401",
  country: "us",
};

expect(
  prepareCheckoutRequestSchema.parse({
    ...base,
    paymentMethod: "card",
    billingAddress,
  }).billingAddress,
).toMatchObject({ state: "SC", country: "US" });

expect(
  prepareCheckoutRequestSchema.safeParse({
    ...base,
    paymentMethod: "afterpay",
    billingAddress: null,
  }).success,
).toBe(false);

expect(
  prepareCheckoutRequestSchema.safeParse({
    ...base,
    paymentMethod: "applePay",
    billingAddress: null,
  }).success,
).toBe(true);
```

- [ ] **Step 2: Run the request-schema test and confirm RED.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-request.test.ts`

Expected: FAIL because `paymentMethod` and `billingAddress` are rejected by the strict schema.

- [ ] **Step 3: Implement the normalized billing schema and conditional requirement.** Move `paymentMethodSchema` above prepare, define and export this schema/type, and add both fields to prepare:

```ts
export const checkoutBillingAddressSchema = z
  .object({
    givenName: z.string().trim().min(1).max(50),
    familyName: z.string().trim().min(1).max(50),
    phone: z.string().trim().min(7).max(30).nullable().optional(),
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
    country: z.string().trim().toUpperCase().pipe(z.literal("US")),
  })
  .strict();

export type CheckoutBillingAddress = z.infer<typeof checkoutBillingAddressSchema>;
```

In `superRefine`, require `billingAddress` when `paymentMethod` is `card` or `afterpay`. Leave it nullable for express wallet methods because their billing contacts remain wallet-owned.

- [ ] **Step 4: Write and run a failing cart-hash test.** Hash otherwise-identical Card inputs with different billing postal codes and expect distinct SHA-256 values.

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-cart-hash.test.ts`

Expected: FAIL because the current canonical payload excludes billing.

- [ ] **Step 5: Bind billing and payment method into checkout identity.** Extend `CheckoutCartHashInput` and the canonical versioned JSON:

```ts
const canonical = JSON.stringify({
  version: 2,
  tenantId: input.tenantId,
  buyerEmail: input.buyerEmail,
  fulfillment: input.fulfillment,
  paymentMethod: input.paymentMethod,
  shippingAddress: input.shippingAddress ?? null,
  billingAddress: input.billingAddress ?? null,
  items,
});
```

- [ ] **Step 6: Run both focused tests and confirm GREEN.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-request.test.ts tests/unit/checkout-cart-hash.test.ts`

- [ ] **Step 7: Commit the contract.**

```powershell
git add src/lib/checkout/checkout-request.ts src/lib/checkout/checkout-cart-hash.ts tests/unit/checkout-request.test.ts tests/unit/checkout-cart-hash.test.ts
git commit -m "feat: define checkout billing contract"
```

### Task 2: Persist billing atomically with checkout reservation

**Files:**

- Create: `supabase/migrations/20260908120000_square_checkout_billing_snapshot.sql`
- Modify: `src/repositories/checkout-reservation-repo.ts`
- Modify: `src/lib/checkout/prepare-checkout.ts`
- Modify: `tests/integration/square-checkout-schema.test.ts`
- Modify: `tests/unit/checkout-reservation-repo.test.ts`
- Modify: `tests/unit/prepare-checkout.test.ts`

**Interfaces:**

- Consumes: `PrepareCheckoutRequest["billingAddress"]` and existing `reserve_square_checkout_inventory` result.
- Produces: `ReserveCheckoutInput.paymentMethod`, `ReserveCheckoutInput.billingAddress`, and service-role RPC parameters `p_payment_method` and `p_billing_address`.

- [ ] **Step 1: Add failing repository and handler tests.** Assert that `prepareCheckoutHandler` passes normalized billing into `reserve`, and the repository maps it to snake-case RPC JSON:

```ts
expect(deps.reserve).toHaveBeenCalledWith(
  expect.objectContaining({
    billingAddress: expect.objectContaining({
      givenName: "Buyer",
      familyName: "Example",
      postalCode: "29401",
      country: "US",
    }),
  }),
);

expect(rpc).toHaveBeenCalledWith(
  "reserve_square_checkout_inventory",
  expect.objectContaining({
    p_billing_address: expect.objectContaining({
      given_name: "Buyer",
      family_name: "Example",
      postal_code: "29401",
      country: "US",
    }),
  }),
);
```

- [ ] **Step 2: Run focused server tests and confirm RED.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/prepare-checkout.test.ts tests/unit/checkout-reservation-repo.test.ts`

Expected: FAIL because `ReserveCheckoutInput` and the RPC call do not carry billing.

- [ ] **Step 3: Thread billing through the handler and repository.** Add `paymentMethod: PrepareCheckoutRequest["paymentMethod"]` and `billingAddress: PrepareCheckoutRequest["billingAddress"]` to `ReserveCheckoutInput`, include both in `createCheckoutCartHash`, and pass both parsed values into `deps.reserve`. Map them to:

```ts
p_payment_method: input.paymentMethod,
p_billing_address: input.billingAddress
  ? {
      given_name: input.billingAddress.givenName,
      family_name: input.billingAddress.familyName,
      phone: input.billingAddress.phone ?? null,
      line1: input.billingAddress.line1,
      line2: input.billingAddress.line2 ?? null,
      city: input.billingAddress.city,
      state: input.billingAddress.state,
      postal_code: input.billingAddress.postalCode,
      country: input.billingAddress.country,
    }
  : null,
```

- [ ] **Step 4: Write a failing migration-contract assertion.** Load the new migration and require `p_billing_address jsonb`, validation of a US address, insertion into `public.order_billing`, `on conflict (order_id) do nothing`, and service-role-only execution.

Run: `npm run test:jest:integration -- --runTestsByPath tests/integration/square-checkout-schema.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 5: Add the transactional RPC migration.** Rename the current 17-argument wrapper to `reserve_square_checkout_inventory_without_billing`, revoke all access to it, and create the new 19-argument public RPC by adding `p_payment_method text` and `p_billing_address jsonb`. The new wrapper must:

```sql
if p_billing_address is not null and (
  jsonb_typeof(p_billing_address) is distinct from 'object'
  or upper(coalesce(p_billing_address ->> 'country', '')) <> 'US'
  or nullif(trim(p_billing_address ->> 'given_name'), '') is null
  or nullif(trim(p_billing_address ->> 'family_name'), '') is null
  or nullif(trim(p_billing_address ->> 'line1'), '') is null
  or nullif(trim(p_billing_address ->> 'city'), '') is null
  or upper(coalesce(p_billing_address ->> 'state', '')) !~ '^[A-Z]{2}$'
  or coalesce(p_billing_address ->> 'postal_code', '') !~ '^\d{5}(-\d{4})?$'
) then
  raise exception 'invalid_checkout_billing_address';
end if;
```

After delegating reservation, insert the immutable snapshot in the same function call:

```sql
insert into public.order_billing (
  order_id, name, phone, line1, line2, city, state, postal_code, country
) values (
  (v_result ->> 'order_id')::uuid,
  trim(concat_ws(' ', p_billing_address ->> 'given_name', p_billing_address ->> 'family_name')),
  nullif(trim(p_billing_address ->> 'phone'), ''),
  trim(p_billing_address ->> 'line1'),
  nullif(trim(p_billing_address ->> 'line2'), ''),
  trim(p_billing_address ->> 'city'),
  upper(trim(p_billing_address ->> 'state')),
  trim(p_billing_address ->> 'postal_code'),
  'US'
)
on conflict (order_id) do nothing;
```

Reject null billing when `p_payment_method` is `card` or `afterpay`; include `p_payment_method text` in the new RPC rather than trusting only the browser schema. Grant only the exact new signature to `service_role`.

- [ ] **Step 6: Update generated RPC typing manually to match the migration.** Modify only the `reserve_square_checkout_inventory` argument block in `src/types/db/database.types.ts` by adding `p_payment_method: string` and `p_billing_address: Json | null`. Do not regenerate unrelated schema output.

- [ ] **Step 7: Run server and schema tests and confirm GREEN.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/prepare-checkout.test.ts tests/unit/checkout-reservation-repo.test.ts tests/unit/checkout-cart-hash.test.ts`

Run: `npm run test:jest:integration -- --runTestsByPath tests/integration/square-checkout-schema.test.ts`

- [ ] **Step 8: Commit atomic persistence.**

```powershell
git add supabase/migrations/20260908120000_square_checkout_billing_snapshot.sql src/types/db/database.types.ts src/repositories/checkout-reservation-repo.ts src/lib/checkout/prepare-checkout.ts tests/integration/square-checkout-schema.test.ts tests/unit/checkout-reservation-repo.test.ts tests/unit/prepare-checkout.test.ts
git commit -m "feat: persist checkout billing snapshots"
```

### Task 3: Build the selectable payment panel and billing form

**Files:**

- Create: `src/components/checkout/PaymentBrandMarks.tsx`
- Create: `src/components/checkout/BillingAddressFields.tsx`
- Create: `src/components/checkout/checkout-field-styles.ts`
- Modify: `src/components/checkout/CheckoutClient.tsx`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `src/lib/square/web-payments.ts`
- Modify: `tests/unit/checkout-client.test.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`
- Modify: `tests/unit/square-web-payments.test.ts`

**Interfaces:**

- Consumes: `CheckoutBillingAddress`, shipping address, exact quote, Square `CardOptions`, and Afterpay custom-button options.
- Produces: `PaymentBrandMarks`, `BillingAddressFields`, `CHECKOUT_INPUT_CLASS`, `resolveBillingAddress`, `squareCardStyle`, and selected Card/Afterpay UI state.

- [ ] **Step 1: Write failing static-render tests for the approved hierarchy.** Assert that Card is selected initially, brand labels exist, Afterpay follows Card, excluded methods are absent, and pickup renders separate billing fields:

```ts
expect(html).toContain('role="radiogroup"');
expect(html).toContain('aria-label="Visa"');
expect(html).toContain('aria-label="Mastercard"');
expect(html).toContain('aria-label="American Express"');
expect(html).toContain("+5");
expect(html.indexOf("Credit card")).toBeLessThan(html.indexOf("Afterpay"));
expect(html).toContain("Use shipping address as billing address");
expect(pickupHtml).toContain("Billing address");
expect(html).not.toContain("PayPal");
expect(html).not.toContain("Klarna");
```

- [ ] **Step 2: Run component tests and confirm RED.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-payment-methods.test.tsx tests/unit/checkout-client.test.tsx`

Expected: FAIL because the current panel has no method radio group, card marks, cardholder field, or billing fields.

- [ ] **Step 3: Add the shared checkout field class.** Export one string from `checkout-field-styles.ts` and use it in both delivery and billing inputs:

```ts
export const CHECKOUT_INPUT_CLASS =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950 focus-visible:outline-none disabled:bg-zinc-100";
```

This scoped `focus-visible:outline-none` removes the legacy red global outline while retaining the checkout border/ring.

- [ ] **Step 4: Create local accessible card indicators.** `PaymentBrandMarks` renders a blue Visa wordmark tile, overlapping red/orange Mastercard circles, a blue stacked AM/EX tile, and a white `+5` tile. Give each brand wrapper an `aria-label`; mark internal decorative shapes `aria-hidden="true"`. Do not load remote images or add a package.

- [ ] **Step 5: Create controlled billing fields.** `BillingAddressFields` accepts:

```ts
type BillingAddressFieldsProps = {
  value: CheckoutBillingAddressForm;
  onChange(field: keyof CheckoutBillingAddressForm, value: string): void;
  disabled?: boolean;
};
```

Render fixed United States, first/last name, address, optional apartment, city, two-character state, ZIP, and optional phone with `billing` autocomplete tokens and `CHECKOUT_INPUT_CLASS`.

- [ ] **Step 6: Implement pure billing resolution.** Export and test:

```ts
export function resolveBillingAddress(input: {
  fulfillment: "ship" | "pickup";
  sameAsShipping: boolean;
  shippingAddress: CheckoutPaymentAddress | null;
  billingAddress: CheckoutBillingAddressForm;
}): CheckoutBillingAddress | null;
```

Shipping plus `sameAsShipping` normalizes the shipping address and splits its name. Pickup always parses the separate billing form. Invalid data returns `null`.

- [ ] **Step 7: Replace the payment markup.** In `SquarePaymentMethods`, add `selectedMethod: "card" | "afterpay"`, `sameAsShipping`, `cardholderName`, and billing-form state. Render the method rows as a semantic radio group, expand only the selected method, show the Afterpay redirect copy, and render billing controls according to fulfillment. Keep one final payment button and the existing Turnstile/error regions.

- [ ] **Step 8: Configure Square card styling and Afterpay custom attachment.** Expand types:

```ts
card(options?: { style?: Record<string, Record<string, string>> }): Promise<SquarePaymentMethod>;
attach?(selector: string, options?: { useCustomButton?: boolean }): Promise<void>;
```

Initialize Card with exported `squareCardStyle` using documented `.input-container`, `.input-container.is-focus`, `.input-container.is-error`, `input`, `input::placeholder`, and error-message selectors. Attach Afterpay to the custom method element with `{ useCustomButton: true }`. Change safe unavailable diagnostics to warning level so staging production builds retain the method/error-class evidence.

- [ ] **Step 9: Run focused UI/SDK tests and confirm GREEN.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-payment-methods.test.tsx tests/unit/checkout-client.test.tsx tests/unit/square-web-payments.test.ts`

- [ ] **Step 10: Commit the payment UI.**

```powershell
git add src/components/checkout/PaymentBrandMarks.tsx src/components/checkout/BillingAddressFields.tsx src/components/checkout/checkout-field-styles.ts src/components/checkout/CheckoutClient.tsx src/components/checkout/SquarePaymentMethods.tsx src/lib/square/web-payments.ts tests/unit/checkout-client.test.tsx tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts
git commit -m "feat: redesign checkout payment panel"
```

### Task 4: Connect billing to prepare and Square tokenization

**Files:**

- Modify: `src/components/checkout/CheckoutClient.tsx`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `src/lib/square/web-payments.ts`
- Modify: `tests/unit/square-payment-methods.test.tsx`
- Modify: `tests/unit/square-web-payments.test.ts`
- Modify: `tests/unit/prepare-checkout.test.ts`

**Interfaces:**

- Consumes: selected method, `CheckoutBillingAddress`, cardholder name, buyer email, exact quote, and existing protected prepare/permit pipeline.
- Produces: `prepare(method, { billingAddress })` and Square Card/Afterpay billing contacts.

- [ ] **Step 1: Write failing billing-contact tests.** Test a pure builder with separate cardholder name and billing address:

```ts
expect(
  squareBillingContact({
    cardholderName: "Ada Lovelace",
    buyerEmail: "ada@example.com",
    billingAddress,
  }),
).toEqual({
  givenName: "Ada",
  familyName: "Lovelace",
  email: "ada@example.com",
  phone: undefined,
  addressLines: ["1 Billing Street"],
  city: "Charleston",
  state: "SC",
  postalCode: "29401",
  countryCode: "US",
});
```

Also assert that the Card verification object contains this contact and Afterpay's `paymentRequest` receives the billing contact selected in the UI.

- [ ] **Step 2: Run focused payment tests and confirm RED.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts`

Expected: FAIL because Card currently derives billing from shipping and Afterpay receives no billing contact.

- [ ] **Step 3: Pass resolved billing through protected prepare.** Extend the preparation context:

```ts
export type CheckoutPreparationContext = {
  quote?: ExactCheckoutQuote;
  shippingAddress?: CheckoutPaymentAddress;
  buyerEmail?: string;
  billingAddress?: CheckoutBillingAddress | null;
};
```

`CheckoutClient.prepare(method, context)` includes `paymentMethod: method` and `billingAddress: context?.billingAddress ?? null` in both the cart fingerprint and `/api/checkout/prepare` body.

- [ ] **Step 4: Supply the correct contact to each Square method.** Card's final action validates cardholder name and billing, prepares the order, then calls `authorizeAndTokenize` with:

```ts
{
  amount: money(checkout.totals.totalCents),
  currencyCode: "USD",
  intent: "CHARGE",
  customerInitiated: true,
  sellerKeyedIn: false,
  billingContact: squareBillingContact({
    cardholderName,
    buyerEmail,
    billingAddress,
  }),
}
```

Afterpay uses the resolved billing contact in its `paymentRequest`, calls `prepare("afterpay", { billingAddress })`, then invokes `authorizeAndTokenize` without Card verification details.

- [ ] **Step 5: Validate only visible fields and focus failures.** Before prepare, call `reportValidity()` on `Name on card` for Card and the visible billing fieldset for either regular method. Return the existing sanitized payment error without clearing Card, billing, shipping, or contact state.

- [ ] **Step 6: Run the focused checkout suite and confirm GREEN.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-request.test.ts tests/unit/checkout-cart-hash.test.ts tests/unit/checkout-client.test.tsx tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts tests/unit/prepare-checkout.test.ts tests/unit/checkout-reservation-repo.test.ts`

- [ ] **Step 7: Commit the integrated flow.**

```powershell
git add src/components/checkout/CheckoutClient.tsx src/components/checkout/SquarePaymentMethods.tsx src/lib/square/web-payments.ts tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts tests/unit/prepare-checkout.test.ts
git commit -m "feat: validate checkout billing with Square"
```

### Task 5: Verify the complete checkout change

**Files:**

- Create: `docs/verification/2026-09-08-checkout-payment-billing.md`
- Modify implementation files only when a verification failure demonstrates a defect.

**Interfaces:**

- Consumes: Tasks 1-4 and the staging Square/Turnstile configuration.
- Produces: automated verification output and a bounded staging checklist.

- [ ] **Step 1: Run all checkout-focused unit tests.**

Run: `npm run test:jest:unit -- --runTestsByPath tests/unit/checkout-request.test.ts tests/unit/checkout-cart-hash.test.ts tests/unit/checkout-client.test.tsx tests/unit/square-payment-methods.test.tsx tests/unit/square-web-payments.test.ts tests/unit/prepare-checkout.test.ts tests/unit/checkout-reservation-repo.test.ts tests/unit/create-direct-payment.test.ts tests/unit/issue-payment-permit.test.ts`

Expected: all selected suites pass.

- [ ] **Step 2: Run checkout schema integration coverage.**

Run: `npm run test:jest:integration -- --runTestsByPath tests/integration/square-checkout-schema.test.ts`

Expected: the new billing RPC assertions and prior checkout migration assertions pass.

- [ ] **Step 3: Run repository-wide static verification.**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0.

- [ ] **Step 4: Perform local responsive browser verification.** At desktop and 390px mobile width verify Card default selection, actual Square iframe rendering, brand indicators, separate billing toggle, pickup-required billing, Afterpay conditional visibility, final Pay labeling, keyboard focus, and absence of red outlines/horizontal scrolling. Record screenshots and observations in `docs/verification/2026-09-08-checkout-payment-billing.md`.

- [ ] **Step 5: Record staging-only provider checks.** After deployment, verify Square Sandbox Card tokenization, eligible Afterpay initialization and redirect, atomic `order_billing` creation, and safe warning diagnostics when Afterpay is ineligible. Record Turnstile hostname, Apple Pay registration, and browser/device eligibility as external gates rather than code failures.

- [ ] **Step 6: Inspect scope and preserve user changes.**

Run: `git status --short`

Run: `git diff --check`

Run: `git diff --stat HEAD~4..HEAD`

Expected: no whitespace errors; `package-lock.json`, `AGENTS.md`, and `CLAUDE.md` remain untouched unless they predated this plan.

- [ ] **Step 7: Commit verification evidence.**

```powershell
git add docs/verification/2026-09-08-checkout-payment-billing.md
git commit -m "docs: verify checkout payment billing"
```
