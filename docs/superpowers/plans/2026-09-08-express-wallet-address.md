# Express Wallet Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show eligible Apple Pay and Google Pay options before the shipping form is complete and obtain an exact server quote from the wallet-selected address before payment.

**Architecture:** `CheckoutClient` exposes the current preliminary or exact quote, a redacted-destination quote callback, and a full wallet-contact callback. `SquarePaymentMethods` creates Apple Pay and Google Pay from either quote, returns exact totals during `shippingcontactchanged`, then validates the full post-tokenization address and passes its exact matching quote into the unchanged protected prepare pipeline.

**Tech Stack:** React 19, TypeScript 5.9, Square Web Payments SDK, Jest 30.

**Spec:** [2026-09-08-express-wallet-address-design.md](../specs/2026-09-08-express-wallet-address-design.md)

## Global Constraints

- Only an exact current server quote may enter `/api/checkout/prepare`.
- Pre-tokenization wallet quoting accepts a US state/postal destination; prepare still accepts complete US addresses only.
- Card, Afterpay, Turnstile, permits, reservations, and webhook authority remain unchanged.
- Do not add dependencies or fake wallet buttons.

---

### Task 1: Define and test wallet quote behavior

**Files:**

- Modify: `src/lib/square/web-payments.ts`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`

**Interfaces:**

- Consumes: `CheckoutQuoteResponse`, Square `shippingcontactchanged` contact.
- Produces: `WalletCheckoutContext` containing an exact quote and normalized address.

- [x] **Step 1: Write failing tests** for these public helpers:

```ts
expect(walletPaymentTotal(PRELIMINARY_QUOTE)).toEqual({
  amount: "110.00",
  label: "Estimated total",
  pending: true,
});
expect(
  walletShippingAddress({
    givenName: "Ada",
    familyName: "Lovelace",
    phone: "3025550100",
    addressLines: ["1 Market St", "Suite 2"],
    city: "Wilmington",
    state: "de",
    postalCode: "19801",
    countryCode: "US",
  }),
).toEqual({
  name: "Ada Lovelace",
  phone: "3025550100",
  line1: "1 Market St",
  line2: "Suite 2",
  city: "Wilmington",
  state: "DE",
  postalCode: "19801",
  country: "US",
});
```

- [x] **Step 2: Run** `npm run test:jest:unit -- --runTestsByPath tests/unit/square-payment-methods.test.tsx` and confirm failures name the missing behavior.
- [x] **Step 3: Implement the minimum exported pure helpers and Square event typing:**

```ts
export function walletPaymentTotal(quote: CheckoutQuoteResponse): {
  amount: string;
  label: string;
  pending: boolean;
};
export function walletShippingAddress(value: unknown): CheckoutPaymentAddress;
```

Allow `SquarePaymentRequest.addEventListener` listeners to return either a wallet update object or a promise of one.

- [x] **Step 4: Re-run the focused test and confirm it passes.**

### Task 2: Connect wallet requoting to protected prepare

**Files:**

- Modify: `src/components/checkout/CheckoutClient.tsx`
- Modify: `src/components/checkout/SquarePaymentMethods.tsx`
- Modify: `tests/unit/square-payment-methods.test.tsx`

**Interfaces:**

- Consumes: redacted `quoteWalletShippingDestination(destination)` and full `resolveWalletShippingContact(address, email?)` callbacks.
- Produces: exact wallet quote/address passed to `prepare(method, context)`.

- [x] **Step 1: Write a failing orchestration test** against the wallet request helpers. Capture the `shippingcontactchanged` listener, invoke it with a redacted destination, and assert that it returns:

```ts
{
  shippingOptions: [{
    id: "STANDARD",
    label: "Standard shipping",
    amount: "10.00",
    taxLineItems: [{ label: "Tax", amount: "8.00" }],
    total: { label: "Total", amount: "118.00" },
  }],
}
```

- [x] **Step 2: Run the focused test and confirm RED.**
- [x] **Step 3: Implement immediate wallet construction, redacted-destination quoting, full token-contact requoting, total-mismatch blocking, and safe unsupported-method diagnostics.** `CheckoutClient` POSTs both wallet quote stages to `/api/checkout/quote`; only the full address response updates the form and enters `prepare(method, context)`. Log only the wallet method name and thrown error class when Square reports a method unavailable.

The component contracts are:

```ts
export type WalletCheckoutContext = {
  quote: ExactCheckoutQuote;
  shippingAddress: CheckoutPaymentAddress;
};
quoteWalletShippingDestination(value: WalletShippingDestination): Promise<{ quote: ExactCheckoutQuote }>;
resolveWalletShippingContact(value: CheckoutPaymentAddress, email?: string): Promise<WalletCheckoutContext>;
prepare(method: PaymentMethod, context?: WalletCheckoutContext): Promise<PreparedCheckout>;
```

- [x] **Step 4: Run focused checkout/payment tests and confirm GREEN.**

### Task 3: Verify the checkout change

**Files:**

- Modify only if verification finds a defect in Tasks 1-2.

- [x] **Step 1: Run** `npm run test:jest:unit -- --runTestsByPath tests/unit/square-payment-methods.test.tsx tests/unit/checkout-client.test.tsx tests/unit/square-web-payments.test.ts`.
- [x] **Step 2: Run** `npm run typecheck`.
- [x] **Step 3: Run** `npm run lint`.
- [x] **Step 4: Run** `npm run build`.
- [x] **Step 5: Inspect `git diff` and verify the unrelated `package-lock.json`, `AGENTS.md`, and `CLAUDE.md` changes were not modified.**
