# Shipping Checkout and Shippo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make category shipping settings authoritative at checkout, persist a working carrier allowlist, synchronize Square's final shipment address, and restrict Shippo labels to paid fulfillment-ready orders and enabled carriers.

**Architecture:** Checkout reads tenant-scoped category defaults and charges the highest represented category once; Square remains authoritative for tax and hosted payment. After a verified Square payment event, the final Square shipment recipient is copied into the local order snapshot. Staff then rates and purchases a Shippo label, with server-side order, address, shipment, and carrier policy checks.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL, Square Node SDK 45.1, Shippo SDK 2.15, Jest 30

**Spec:** `docs/superpowers/specs/2026-09-05-shipping-checkout-shippo-design.md`

## Global Constraints

- Supported category keys are exactly `sneakers`, `clothing`, `accessories`, and `electronics`.
- Customer shipping is the highest represented category rate once; quantity does not multiply it; pickup is $0.
- Product shipping-price overrides do not participate in checkout pricing.
- Carrier keys are exactly `UPS`, `USPS`, and `FEDEX`, in that stable order.
- Square remains authoritative for tax; do not add local tax calculation.
- Staff chooses Shippo service after payment; customers do not choose a carrier at checkout.
- Do not delete dormant database columns or tables in this change.
- Never log customer address fields or provider credentials.

---

## File Structure

- `src/lib/checkout/checkout-pricing-gateway.ts` owns category-based customer shipping calculation.
- `src/lib/shipping/package-profile.ts` owns category dimension/weight aggregation for the staff label form.
- `src/lib/shipping/carriers.ts` owns canonical carrier keys, normalization, strict saved-selection parsing, and toggle behavior.
- `src/lib/square/order-shipping.ts` owns Square order fulfillment-recipient mapping.
- `src/lib/square/shipping-address-sync.ts` owns idempotent synchronization orchestration between Square and local repositories.
- `src/lib/shipping/label-purchase-policy.ts` owns pure fail-closed label authorization rules.
- Existing pages and API routes remain orchestration layers and call these focused modules.

---

### Task 1: Replace the Checkout Flat Rate with Category Pricing

**Files:**
- Modify: `tests/unit/checkout-pricing-gateway.test.ts`
- Modify: `tests/unit/checkout-cart-resolver.test.ts`
- Modify: `tests/unit/create-payment-link.test.ts`
- Modify: `src/lib/checkout/checkout-pricing-gateway.ts`
- Modify: `src/lib/checkout/checkout-cart-resolver.ts`
- Modify: `src/lib/checkout/create-payment-link.ts`
- Modify: `src/lib/checkout/create-payment-link-dependencies.ts`
- Modify: `src/repositories/product-repo.ts:1955-2001`

**Interfaces:**
- Consumes: `ShippingDefaultsRepository.getByCategories(tenantId: string | null, categories: string[]): Promise<ShippingDefaultRow[]>`.
- Produces: `createCheckoutPricingGateway(repository: ShippingDefaultsReader): CheckoutPricingGateway`, where the gateway exposes only `quote(input: CheckoutPricingQuoteInput): Promise<CheckoutPricingQuote>`.
- Produces: `ResolvedCheckoutItem` without `shippingPriceCents`; `category` remains supplied by `CheckoutReservationItem`.

- [ ] **Step 1: Replace flat-rate tests with failing category-rate tests**

```typescript
import type { ResolvedCheckoutItem } from "@/lib/checkout/checkout-cart-resolver";
import {
  CheckoutPricingUnavailableError,
  createCheckoutPricingGateway,
} from "@/lib/checkout/checkout-pricing-gateway";

const item = (category: string, quantity = 1): ResolvedCheckoutItem => ({
  productId: `product-${category}`,
  variantId: `variant-${category}`,
  quantity,
  unitPriceCents: 10_000,
  unitCostCents: 5_000,
  lineTotalCents: 10_000 * quantity,
  variantSku: `SKU-${category}`,
  productName: category,
  brand: "Sole",
  model: null,
  category,
  condition: "new",
  sizeLabel: "10",
});

it("charges the highest represented category once", async () => {
  const getByCategories = jest.fn().mockResolvedValue([
    { category: "sneakers", shipping_cost_cents: 1500 },
    { category: "clothing", shipping_cost_cents: 900 },
  ]);
  const gateway = createCheckoutPricingGateway({ getByCategories });

  const quote = await gateway.quote({
    tenantId: "tenant-1",
    fulfillment: "ship",
    shippingAddress: null,
    subtotalCents: 30_000,
    items: [item("sneakers", 2), item("clothing")],
  });

  expect(quote.shippingCents).toBe(1500);
  expect(getByCategories).toHaveBeenCalledWith("tenant-1", [
    "sneakers",
    "clothing",
  ]);
});

it("fails closed when a represented category is missing", async () => {
  const gateway = createCheckoutPricingGateway({
    getByCategories: jest.fn().mockResolvedValue([
      { category: "sneakers", shipping_cost_cents: 1500 },
    ]),
  });

  await expect(
    gateway.quote({
      tenantId: "tenant-1",
      fulfillment: "ship",
      shippingAddress: null,
      subtotalCents: 20_000,
      items: [item("sneakers"), item("electronics")],
    }),
  ).rejects.toMatchObject({
    name: "CheckoutPricingUnavailableError",
    category: "electronics",
  });
});

it("returns zero for pickup without reading shipping defaults", async () => {
  const getByCategories = jest.fn();
  const gateway = createCheckoutPricingGateway({ getByCategories });

  await expect(
    gateway.quote({
      tenantId: "tenant-1",
      fulfillment: "pickup",
      shippingAddress: null,
      subtotalCents: 10_000,
      items: [item("sneakers")],
    }),
  ).resolves.toMatchObject({ shippingCents: 0, taxCents: 0 });
  expect(getByCategories).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and verify the old flat-rate implementation fails**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/checkout-pricing-gateway.test.ts tests/unit/checkout-cart-resolver.test.ts tests/unit/create-payment-link.test.ts
```

Expected: FAIL because the gateway expects `getByTenant`, exposes `assertReady`, and still carries `shippingPriceCents`.

- [ ] **Step 3: Implement the minimum server-authoritative category calculation**

Replace the gateway's settings dependency with this shape and logic:

```typescript
type ShippingDefaultsReader = Pick<ShippingDefaultsRepository, "getByCategories">;

export class CheckoutPricingUnavailableError extends Error {
  readonly category: string | null;

  constructor(category: string | null = null) {
    super("checkout_pricing_unavailable");
    this.name = "CheckoutPricingUnavailableError";
    this.category = category;
  }
}

export function createCheckoutPricingGateway(
  repository: ShippingDefaultsReader,
): CheckoutPricingGateway {
  return {
    quote: async (input) => {
      const customerState = input.shippingAddress?.state ?? "SC";
      if (input.fulfillment === "pickup") {
        return {
          shippingCents: 0,
          taxCents: 0,
          taxCalculationId: "square:pending",
          customerState,
        };
      }

      const categories = [...new Set(input.items.map(({ category }) => category))];
      const rows = await repository.getByCategories(input.tenantId, categories);
      const prices = new Map(
        rows.map((row) => [row.category, row.shipping_cost_cents]),
      );
      let shippingCents = 0;
      for (const category of categories) {
        const cents = prices.get(category);
        if (cents === undefined || !Number.isSafeInteger(cents) || cents < 0) {
          throw new CheckoutPricingUnavailableError(category);
        }
        shippingCents = Math.max(shippingCents, cents);
      }

      return {
        shippingCents,
        taxCents: 0,
        taxCalculationId: "square:pending",
        customerState,
      };
    },
  };
}
```

Remove `assertReady`/`ensureCommerceReady` from the gateway, handler dependency type, production dependency factory, and tests. Construct the gateway with `ShippingDefaultsRepository`. Remove `shippingPriceCents` from checkout product selection, mapping, resolver types, and affected fixtures. Keep `quote` before inventory reservation and Square calls.

- [ ] **Step 4: Run checkout tests and type checking**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/checkout-pricing-gateway.test.ts tests/unit/checkout-cart-resolver.test.ts tests/unit/create-payment-link.test.ts tests/unit/square-payment-links.test.ts
npm run typecheck
```

Expected: all selected suites PASS and TypeScript exits 0.

- [ ] **Step 5: Commit category pricing**

```powershell
git add -- src/lib/checkout/checkout-pricing-gateway.ts src/lib/checkout/checkout-cart-resolver.ts src/lib/checkout/create-payment-link.ts src/lib/checkout/create-payment-link-dependencies.ts src/repositories/product-repo.ts tests/unit/checkout-pricing-gateway.test.ts tests/unit/checkout-cart-resolver.test.ts tests/unit/create-payment-link.test.ts tests/unit/square-payment-links.test.ts
git commit -m "fix: price checkout shipping by category"
```

---

### Task 2: Remove Duplicate Shipping Controls and Centralize Package Defaults

**Files:**
- Create: `src/lib/shipping/package-profile.ts`
- Create: `tests/unit/shipping-package-profile.test.ts`
- Modify: `app/admin/shipping/page.tsx:396-437`
- Modify: `app/admin/settings/shipping/page.tsx:91-223,390-413,518-557`
- Modify: `src/components/inventory/ProductForm.tsx:31-49,286-331,384,440-445,1086-1093,1160-1170,1702-1730`
- Modify: `app/admin/inventory/create/actions.ts`
- Modify: `app/admin/inventory/create/client.tsx`
- Modify: `app/admin/inventory/create/page.tsx`
- Modify: `app/admin/inventory/[id]/edit/actions.ts`
- Modify: `app/admin/inventory/[id]/edit/client.tsx`
- Modify: `app/admin/inventory/[id]/edit/page.tsx`
- Delete: `app/api/admin/checkout-settings/route.ts`
- Delete: `src/repositories/checkout-settings-repo.ts`
- Delete: `tests/unit/checkout-settings-api.test.ts`
- Delete: `tests/unit/checkout-settings-repo.test.ts`
- Modify: `src/lib/validation/admin.ts`

**Interfaces:**
- Produces: `buildPackageProfile(items: PackageProfileItem[], defaults: Record<string, ShippingPackageDefaults>): PackageProfile`.
- `PackageProfile` contains only `weight`, `length`, `width`, and `height`; customer shipping price is not part of Shippo parcel construction.

- [ ] **Step 1: Write failing package aggregation tests**

```typescript
import { buildPackageProfile } from "@/lib/shipping/package-profile";

it("sums category weight by quantity and uses the largest dimensions", () => {
  expect(
    buildPackageProfile(
      [
        { quantity: 2, category: "sneakers" },
        { quantity: 1, category: "clothing" },
      ],
      {
        sneakers: { weight: 20, length: 14, width: 10, height: 6 },
        clothing: { weight: 8, length: 12, width: 11, height: 4 },
      },
    ),
  ).toEqual({ weight: 48, length: 14, width: 11, height: 6 });
});

it("uses the safe package fallback when no items exist", () => {
  expect(buildPackageProfile([], {})).toEqual({
    weight: 16,
    length: 12,
    width: 12,
    height: 12,
  });
});
```

- [ ] **Step 2: Run the package test and verify the module is missing**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/shipping-package-profile.test.ts
```

Expected: FAIL because `src/lib/shipping/package-profile.ts` does not exist.

- [ ] **Step 3: Add the package helper and remove redundant settings**

Implement the helper with explicit defaults:

```typescript
export type PackageProfileItem = { quantity?: number | null; category?: string | null };
export type ShippingPackageDefaults = {
  weight: number;
  length: number;
  width: number;
  height: number;
};
export type PackageProfile = ShippingPackageDefaults;

const FALLBACK_PACKAGE: PackageProfile = {
  weight: 16,
  length: 12,
  width: 12,
  height: 12,
};

export function buildPackageProfile(
  items: PackageProfileItem[],
  defaults: Record<string, ShippingPackageDefaults>,
): PackageProfile {
  if (items.length === 0) return FALLBACK_PACKAGE;

  return items.reduce<PackageProfile>((profile, item) => {
    const configured = item.category ? defaults[item.category] : undefined;
    const parcel = configured ?? FALLBACK_PACKAGE;
    const quantity = Math.max(1, Number(item.quantity ?? 0));
    return {
      weight: profile.weight + parcel.weight * quantity,
      length: Math.max(profile.length, parcel.length),
      width: Math.max(profile.width, parcel.width),
      height: Math.max(profile.height, parcel.height),
    };
  }, { weight: 0, length: 0, width: 0, height: 0 });
}
```

Map database defaults to this helper in `app/admin/shipping/page.tsx` and continue passing the result as `CreateLabelForm.initialPackage` so staff can edit it before rating.

Remove the flat-rate state, fetch, save function, and card from the shipping settings page. Delete the unused checkout-settings route/repository/tests and remove only `checkoutSettingsSchema` from `src/lib/validation/admin.ts`.

Remove the product shipping-price input, state, validation, request property, `initialShippingDefaults` prop, and corresponding server data fetches. Leave database schema and service/API compatibility fields intact; checkout already ignores them after Task 1.

- [ ] **Step 4: Run focused tests and TypeScript**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/shipping-package-profile.test.ts tests/unit/product-validation.test.ts tests/unit/product-service.test.ts tests/unit/store-access-api.test.ts
npm run typecheck
```

Expected: all selected suites PASS; create/edit product pages no longer require shipping defaults; TypeScript exits 0.

- [ ] **Step 5: Commit settings cleanup**

```powershell
git add -A -- app/admin/shipping/page.tsx app/admin/settings/shipping/page.tsx app/admin/inventory/create/actions.ts app/admin/inventory/create/client.tsx app/admin/inventory/create/page.tsx 'app/admin/inventory/[id]/edit/actions.ts' 'app/admin/inventory/[id]/edit/client.tsx' 'app/admin/inventory/[id]/edit/page.tsx' app/api/admin/checkout-settings/route.ts src/components/inventory/ProductForm.tsx src/lib/shipping/package-profile.ts src/lib/validation/admin.ts src/repositories/checkout-settings-repo.ts tests/unit/checkout-settings-api.test.ts tests/unit/checkout-settings-repo.test.ts tests/unit/shipping-package-profile.test.ts
git commit -m "refactor: make category shipping settings authoritative"
```

---

### Task 3: Repair Carrier Selection and Persistence

**Files:**
- Create: `src/lib/shipping/carriers.ts`
- Create: `src/components/admin/shipping/CarrierSelector.tsx`
- Create: `tests/unit/shipping-carriers.test.tsx`
- Modify: `app/admin/settings/shipping/page.tsx:17-21,215-216,329-336,458-480,592-612`
- Modify: `app/api/admin/shipping/carriers/route.ts`
- Delete: `src/services/shipping-carriers-service.ts`

**Interfaces:**
- Produces: `CARRIER_KEYS`, `CarrierKey`, `normalizeCarrier(value: unknown): CarrierKey | null`, `parseCarrierSelection(values: unknown): CarrierKey[]`, `parseStoredCarrierSelection(values: unknown): CarrierKey[]`, and `toggleCarrierSelection(enabled: CarrierKey[], carrier: CarrierKey): CarrierKey[]`.
- Produces: `CarrierSelector({ enabled, onToggle })`, with `aria-pressed` reflecting selected state.

- [ ] **Step 1: Write failing normalization, toggle, and rendering tests**

```tsx
import { renderToStaticMarkup } from "react-dom/server";

import { CarrierSelector } from "@/components/admin/shipping/CarrierSelector";
import {
  normalizeCarrier,
  parseCarrierSelection,
  parseStoredCarrierSelection,
  toggleCarrierSelection,
} from "@/lib/shipping/carriers";

it("normalizes FedEx and preserves stable provider order", () => {
  expect(normalizeCarrier("FedEx")).toBe("FEDEX");
  expect(parseCarrierSelection(["fedex", "UPS", "USPS", "UPS"])).toEqual([
    "UPS",
    "USPS",
    "FEDEX",
  ]);
  expect(parseStoredCarrierSelection(["FedEx", "DHL"])).toEqual(["FEDEX"]);
});

it("rejects unknown saved providers", () => {
  expect(() => parseCarrierSelection(["DHL"])).toThrow(
    "shipping_carrier_invalid",
  );
});

it("toggles a canonical carrier and exposes selected state", () => {
  expect(toggleCarrierSelection(["UPS"], "UPS")).toEqual([]);
  expect(toggleCarrierSelection([], "FEDEX")).toEqual(["FEDEX"]);
  const html = renderToStaticMarkup(
    <CarrierSelector enabled={["FEDEX"]} onToggle={() => undefined} />,
  );
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("FedEx");
});
```

- [ ] **Step 2: Run the carrier test and verify the focused modules are missing**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/shipping-carriers.test.tsx
```

Expected: FAIL because the canonical carrier module and selector do not exist.

- [ ] **Step 3: Implement one canonical allowlist and button-based selector**

```typescript
export const CARRIER_KEYS = ["UPS", "USPS", "FEDEX"] as const;
export type CarrierKey = (typeof CARRIER_KEYS)[number];

export function normalizeCarrier(value: unknown): CarrierKey | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return CARRIER_KEYS.find((carrier) => carrier === normalized) ?? null;
}

export function parseCarrierSelection(values: unknown): CarrierKey[] {
  if (!Array.isArray(values)) throw new Error("shipping_carrier_invalid");
  const normalized = values.map(normalizeCarrier);
  if (normalized.some((carrier) => carrier === null)) {
    throw new Error("shipping_carrier_invalid");
  }
  const selected = new Set(normalized as CarrierKey[]);
  return CARRIER_KEYS.filter((carrier) => selected.has(carrier));
}

export function parseStoredCarrierSelection(values: unknown): CarrierKey[] {
  if (!Array.isArray(values)) return [];
  const selected = new Set(
    values.map(normalizeCarrier).filter((carrier): carrier is CarrierKey => Boolean(carrier)),
  );
  return CARRIER_KEYS.filter((carrier) => selected.has(carrier));
}

export function toggleCarrierSelection(
  enabled: CarrierKey[],
  carrier: CarrierKey,
): CarrierKey[] {
  const next = new Set(enabled);
  next.has(carrier) ? next.delete(carrier) : next.add(carrier);
  return CARRIER_KEYS.filter((candidate) => next.has(candidate));
}
```

Render each selector entry as a real button:

```tsx
const AVAILABLE_CARRIERS = [
  { key: "UPS", label: "UPS", description: "United Parcel Service" },
  { key: "USPS", label: "USPS", description: "United States Postal Service" },
  { key: "FEDEX", label: "FedEx", description: "Federal Express" },
] satisfies Array<{ key: CarrierKey; label: string; description: string }>;

export function CarrierSelector({ enabled, onToggle }: {
  enabled: CarrierKey[];
  onToggle(carrier: CarrierKey): void;
}) {
  return AVAILABLE_CARRIERS.map((carrier) => {
    const selected = enabled.includes(carrier.key);
    return (
      <button
        key={carrier.key}
        type="button"
        aria-pressed={selected}
        onClick={() => onToggle(carrier.key)}
        className={selected
          ? "w-full rounded border border-red-500 bg-red-950/40 p-3 text-left"
          : "w-full rounded border border-zinc-800 bg-zinc-950/40 p-3 text-left"}
      >
        <span className="block text-sm font-medium text-white">{carrier.label}</span>
        <span className="block text-xs text-gray-500">{carrier.description}</span>
      </button>
    );
  });
}
```

In the API, strictly parse POST selections, return 400 for `shipping_carrier_invalid`, normalize legacy stored values on GET, and save the canonical stable order. Replace the page checkbox loop with `CarrierSelector`, update state through `toggleCarrierSelection`, and always replace state with the POST response after save. Remove the now-unused service to keep one normalization path.

- [ ] **Step 4: Run carrier tests and type checking**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/shipping-carriers.test.tsx
npm run typecheck
```

Expected: PASS; the UI and API both use `FEDEX`, never `FedEx` as a stored key.

- [ ] **Step 5: Commit the carrier repair**

```powershell
git add -A -- src/lib/shipping/carriers.ts src/components/admin/shipping/CarrierSelector.tsx app/admin/settings/shipping/page.tsx app/api/admin/shipping/carriers/route.ts src/services/shipping-carriers-service.ts tests/unit/shipping-carriers.test.tsx
git commit -m "fix: persist selectable shipping carriers"
```

---

### Task 4: Synchronize Square's Final Shipment Address

**Files:**
- Create: `supabase/migrations/20260905120000_square_shipping_address_sync.sql`
- Modify: `src/types/db/database.types.ts:761-801`
- Modify: `src/repositories/addresses-repo.ts:15-75`
- Modify: `src/repositories/orders-repo.ts:60-71`
- Create: `src/lib/square/order-shipping.ts`
- Create: `src/lib/square/shipping-address-sync.ts`
- Modify: `src/lib/square/payment-event.ts`
- Modify: `app/api/webhooks/square/route.ts`
- Create: `tests/unit/square-order-shipping.test.ts`
- Create: `tests/unit/square-shipping-address-sync.test.ts`
- Create: `tests/unit/addresses-repo.test.ts`
- Modify: `tests/unit/square-payment-event.test.ts`
- Modify: `tests/unit/square-webhook-route.test.ts`

**Interfaces:**
- Produces: `SquareOrderShippingReader.get(squareOrderId: string): Promise<AddressInput | null>`.
- Produces: `synchronizeSquareShippingAddress(result: SquarePaymentEventResult, deps: SquareShippingSyncDependencies): Promise<"skipped" | "synced">`.
- Extends processed event results with optional `paymentStatus` and `squareOrderId`, populated for payment events.
- Produces: `AddressesRepository.upsertSquareOrderShippingSnapshot(orderId: string, address: AddressInput): Promise<void>` and `OrdersRepository.getBySquareOrderId(squareOrderId: string): Promise<OrderRow | null>`.

- [ ] **Step 1: Write failing mapper, retry, and schema tests**

```typescript
it("maps the Square shipment recipient into the local address shape", async () => {
  const reader = new SquareOrderShippingReader({
    get: jest.fn().mockResolvedValue({
      order: {
        fulfillments: [{
          type: "SHIPMENT",
          shipmentDetails: {
            recipient: {
              displayName: "Buyer Name",
              phoneNumber: "8435550100",
              address: {
                addressLine1: "1 Main Street",
                addressLine2: "Unit 2",
                locality: "Charleston",
                administrativeDistrictLevel1: "SC",
                postalCode: "29401",
                country: "US",
              },
            },
          },
        }],
      },
    }),
  } as never);

  await expect(reader.get("square-order-1")).resolves.toEqual({
    name: "Buyer Name",
    phone: "8435550100",
    line1: "1 Main Street",
    line2: "Unit 2",
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US",
  });
});

it("retries synchronization for a duplicate completed webhook", async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await expect(
    synchronizeSquareShippingAddress(
      {
        duplicate: true,
        fulfillmentAuthorized: false,
        orderId: null,
        paymentStatus: "COMPLETED",
        squareOrderId: "square-order-1",
      },
      {
        getOrderById: jest.fn(),
        getOrderBySquareOrderId: jest.fn().mockResolvedValue({
          id: "order-1",
          fulfillment: "ship",
        }),
        getSquareShippingAddress: jest.fn().mockResolvedValue({
          name: "Buyer",
          line1: "1 Main Street",
          city: "Charleston",
          state: "SC",
          postalCode: "29401",
          country: "US",
        }),
        saveSquareShippingAddress: save,
      },
    ),
  ).resolves.toBe("synced");
  expect(save).toHaveBeenCalledWith("order-1", expect.any(Object));
});
```

Verify the repository emits the additive synchronization marker at the database boundary:

```typescript
it("upserts Square's final address with a synchronization timestamp", async () => {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  const repository = new AddressesRepository({
    from: jest.fn(() => ({ upsert })),
  } as never);

  await repository.upsertSquareOrderShippingSnapshot("order-1", {
    name: "Buyer",
    line1: "1 Main Street",
    city: "Charleston",
    state: "SC",
    postalCode: "29401",
    country: "US",
  });

  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      order_id: "order-1",
      postal_code: "29401",
      square_synced_at: expect.any(String),
    }),
    { onConflict: "order_id" },
  );
});
```

- [ ] **Step 2: Run Square-focused tests and verify they fail**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/square-order-shipping.test.ts tests/unit/square-shipping-address-sync.test.ts tests/unit/addresses-repo.test.ts tests/unit/square-payment-event.test.ts tests/unit/square-webhook-route.test.ts
```

Expected: FAIL because the reader, synchronizer, event metadata, and repository methods are absent.

- [ ] **Step 3: Add an idempotent Square synchronization boundary**

The migration is additive only:

```sql
alter table public.order_shipping
  add column if not exists square_synced_at timestamp with time zone;
```

Add `square_synced_at` to the generated `order_shipping` Row/Insert/Update types. Add `getBySquareOrderId` using `.eq("square_order_id", squareOrderId).maybeSingle()`.

Add a dedicated repository write that stamps synchronization:

```typescript
async upsertSquareOrderShippingSnapshot(
  orderId: string,
  address: AddressInput,
): Promise<void> {
  const { error } = await this.supabase.from("order_shipping").upsert({
    order_id: orderId,
    name: address.name ?? null,
    phone: address.phone ?? null,
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postal_code: address.postalCode ?? null,
    country: address.country ?? null,
    square_synced_at: new Date().toISOString(),
  }, { onConflict: "order_id" });
  if (error) throw error;
}
```

`SquareOrderShippingReader` calls `orders.get({ orderId: squareOrderId })`, selects the `SHIPMENT` fulfillment, validates all required postal fields, and returns `null` when no complete shipment recipient exists:

```typescript
type SquareOrdersReader = Pick<SquareClient["orders"], "get">;

export class SquareOrderShippingReader {
  constructor(private readonly orders: SquareOrdersReader) {}

  async get(squareOrderId: string): Promise<AddressInput | null> {
    const response = await this.orders.get({ orderId: squareOrderId });
    const recipient = response.order?.fulfillments?.find(
      (fulfillment) => fulfillment.type === "SHIPMENT",
    )?.shipmentDetails?.recipient;
    const address = recipient?.address;
    if (!address?.addressLine1 || !address.locality ||
        !address.administrativeDistrictLevel1 || !address.postalCode ||
        !address.country) {
      return null;
    }
    return {
      name: recipient?.displayName ?? null,
      phone: recipient?.phoneNumber ?? null,
      line1: address.addressLine1,
      line2: address.addressLine2 ?? null,
      city: address.locality,
      state: address.administrativeDistrictLevel1,
      postalCode: address.postalCode,
      country: String(address.country),
    };
  }
}
```

Use this result shape, and add `paymentStatus` and `squareOrderId` after the existing durable RPC call only for payment events:

```typescript
export type SquarePaymentEventResult =
  | { ignored: true; reason: "location_mismatch" }
  | {
      duplicate: boolean;
      fulfillmentAuthorized: boolean;
      orderId: string | null;
      paymentStatus?: string;
      squareOrderId?: string;
    };
```

The synchronizer skips non-payment, non-completed, and pickup events. For a duplicate event whose RPC result has no local order ID, it resolves the order using `getBySquareOrderId`, making a failed first synchronization retryable:

```typescript
export async function synchronizeSquareShippingAddress(
  result: SquarePaymentEventResult,
  deps: SquareShippingSyncDependencies,
): Promise<"skipped" | "synced"> {
  if ("ignored" in result || result.paymentStatus !== "COMPLETED" ||
      !result.squareOrderId) {
    return "skipped";
  }
  const order = result.orderId
    ? await deps.getOrderById(result.orderId)
    : await deps.getOrderBySquareOrderId(result.squareOrderId);
  if (!order || order.fulfillment !== "ship") return "skipped";

  const address = await deps.getSquareShippingAddress(result.squareOrderId);
  if (!address) throw new Error("square_shipping_address_unavailable");
  await deps.saveSquareShippingAddress(order.id, address);
  return "synced";
}
```

Wire the synchronizer after verified durable event processing in the webhook route. Throw `square_shipping_address_unavailable` for a shipped completed order without a complete Square shipment recipient so Square retries the webhook. Log only IDs and the outcome, never address values.

- [ ] **Step 4: Run Square unit, integration, and type tests**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/square-order-shipping.test.ts tests/unit/square-shipping-address-sync.test.ts tests/unit/addresses-repo.test.ts tests/unit/square-payment-event.test.ts tests/unit/square-webhook-route.test.ts
npm run typecheck
```

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Square address synchronization**

```powershell
git add -- supabase/migrations/20260905120000_square_shipping_address_sync.sql src/types/db/database.types.ts src/repositories/addresses-repo.ts src/repositories/orders-repo.ts src/lib/square/order-shipping.ts src/lib/square/shipping-address-sync.ts src/lib/square/payment-event.ts app/api/webhooks/square/route.ts tests/unit/square-order-shipping.test.ts tests/unit/square-shipping-address-sync.test.ts tests/unit/addresses-repo.test.ts tests/unit/square-payment-event.test.ts tests/unit/square-webhook-route.test.ts
git commit -m "feat: sync Square shipping addresses"
```

---

### Task 5: Enforce Order and Carrier Policy Before Shippo Purchase

**Files:**
- Create: `src/lib/shipping/label-purchase-policy.ts`
- Create: `tests/unit/shipping-label-policy.test.ts`
- Modify: `src/services/shipping-label-service.ts`
- Modify: `app/api/admin/shipping/rates/route.ts`
- Modify: `app/api/admin/shipping/labels/route.ts`
- Create: `tests/unit/shipping-label-api.test.ts`

**Interfaces:**
- Extends `NormalizedRate` with `shipmentId: string`.
- Produces: `ShippoService.getRate(rateId: string): Promise<NormalizedRate>` using `shippo.rates.get(rateId)`.
- Produces: `assertOrderReadyForLabel(order, shipping): void` and `assertRateAllowed(rate, shipmentId, enabledCarriers): void`.

- [ ] **Step 1: Write failing policy and route tests**

```typescript
import {
  assertOrderReadyForLabel,
  assertRateAllowed,
} from "@/lib/shipping/label-purchase-policy";

it.each(["pending", "review", "refunded", "canceled"])(
  "blocks a %s order",
  (status) => {
    expect(() =>
      assertOrderReadyForLabel(
        { status, fulfillment: "ship", fulfillment_status: "unfulfilled", tracking_number: null },
        { square_synced_at: "2026-09-05T12:00:00.000Z" },
      ),
    ).toThrow("shipping_order_not_fulfillment_ready");
  },
);

it("blocks an unsynchronized shipment address", () => {
  expect(() =>
    assertOrderReadyForLabel(
      { status: "paid", fulfillment: "ship", fulfillment_status: "unfulfilled", tracking_number: null },
      { square_synced_at: null },
    ),
  ).toThrow("shipping_address_not_square_synced");
});

it("blocks a disabled provider and a mismatched shipment", () => {
  expect(() =>
    assertRateAllowed(
      { id: "rate-1", carrier: "FedEx", shipmentId: "shipment-1" },
      "shipment-1",
      ["UPS"],
    ),
  ).toThrow("shipping_carrier_disabled");
  expect(() =>
    assertRateAllowed(
      { id: "rate-1", carrier: "UPS", shipmentId: "shipment-2" },
      "shipment-1",
      ["UPS"],
    ),
  ).toThrow("shipping_rate_shipment_mismatch");
});
```

In the label API test, mock `ShippoService.prototype.purchaseLabel` and prove it is not called for a `review` order or a disabled carrier.

- [ ] **Step 2: Run label tests and verify the missing policy fails**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/shipping-label-policy.test.ts tests/unit/shipping-label-api.test.ts
```

Expected: FAIL because the policy module, `getRate`, and route enforcement do not exist.

- [ ] **Step 3: Retrieve and verify the Shippo rate before purchasing**

Implement the pure policy first:

```typescript
type LabelOrder = {
  status?: string | null;
  fulfillment?: string | null;
  fulfillment_status?: string | null;
  tracking_number?: string | null;
};
type LabelShipping = { square_synced_at?: string | null } | null;
type RatePolicyInput = Pick<NormalizedRate, "id" | "carrier" | "shipmentId">;

export function assertOrderReadyForLabel(
  order: LabelOrder,
  shipping: LabelShipping,
): void {
  if (order.status !== "paid" || order.fulfillment !== "ship") {
    throw new Error("shipping_order_not_fulfillment_ready");
  }
  if (order.tracking_number || ["ready_to_ship", "shipped", "delivered"].includes(
    String(order.fulfillment_status ?? "").toLowerCase(),
  )) {
    throw new Error("shipping_label_already_purchased");
  }
  if (!shipping?.square_synced_at) {
    throw new Error("shipping_address_not_square_synced");
  }
}

export function assertRateAllowed(
  rate: RatePolicyInput,
  shipmentId: string,
  enabledCarriers: CarrierKey[],
): void {
  if (rate.shipmentId !== shipmentId) {
    throw new Error("shipping_rate_shipment_mismatch");
  }
  const carrier = normalizeCarrier(rate.carrier);
  if (!carrier || !enabledCarriers.includes(carrier)) {
    throw new Error("shipping_carrier_disabled");
  }
}
```

Extend rate normalization to capture the shipment ID:

```typescript
type ShippoClient = Pick<Shippo, "shipments" | "rates" | "transactions">;

export interface NormalizedRate {
  id: string;
  shipmentId: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  estimated_delivery_days: number | null;
}

constructor(private readonly client: ShippoClient = shippo) {}

async getRate(rateId: string): Promise<NormalizedRate> {
  const rate = await this.client.rates.get(rateId);
  const normalized = this.normalizeRate(rate);
  if (!normalized) throw new Error("shippo_rate_invalid");
  return normalized;
}
```

Inject the Shippo client through the service constructor with the existing configured client as the default so unit tests can supply a fake client.

In the rates route, use `normalizeCarrier` and canonical stored carrier selections from Task 3. Keep the existing empty-selection and no-matching-rate errors.

In the label route, destructure `shipmentId` from the validated request and enforce this order before `purchaseLabel`:

```typescript
const { orderId, shipmentId, rateId } = parsed.data;
const shipping = await addressesRepo.getOrderShipping(orderId);
assertOrderReadyForLabel(order, shipping);

const enabled = parseStoredCarrierSelection(
  (await carriersRepo.get())?.enabled_carriers ?? [],
);
const rate = await shippoService.getRate(rateId);
assertRateAllowed(rate, shipmentId, enabled);

const transaction = await shippoService.purchaseLabel(rateId);
```

Map policy errors to stable 409 responses for order/duplicate state and 400 responses for address, shipment, or carrier configuration. Preserve the existing Shippo 502 mapping for provider failures.

- [ ] **Step 4: Run all shipping tests and type checking**

Run:

```powershell
npm run test:jest:unit -- --runInBand tests/unit/shipping-carriers.test.tsx tests/unit/shipping-package-profile.test.ts tests/unit/shipping-label-policy.test.ts tests/unit/shipping-label-api.test.ts
npm run typecheck
```

Expected: all selected suites PASS and TypeScript exits 0.

- [ ] **Step 5: Commit Shippo enforcement**

```powershell
git add -- src/lib/shipping/label-purchase-policy.ts src/services/shipping-label-service.ts app/api/admin/shipping/rates/route.ts app/api/admin/shipping/labels/route.ts tests/unit/shipping-label-policy.test.ts tests/unit/shipping-label-api.test.ts
git commit -m "fix: enforce Shippo label purchase policy"
```

---

### Task 6: Run Release-Level Verification

**Files:**
- Modify only if a verification failure identifies an in-scope defect.

**Interfaces:**
- Consumes all deliverables from Tasks 1-5.
- Produces a clean test/build report and a manual checkout-to-label validation record.

- [ ] **Step 1: Run formatting and static checks**

```powershell
npm run check:file-case
npm run check:env-case
npm run lint
npm run typecheck
```

Expected: every command exits 0.

- [ ] **Step 2: Run the full Jest suites**

```powershell
npm run test:jest:unit -- --runInBand
npm run test:jest:integration -- --runInBand
```

Expected: all suites PASS with no duplicate test discovery from nested worktrees.

- [ ] **Step 3: Run the production-equivalent local build**

```powershell
npm run build
```

Expected: Next.js build exits 0 and the shipping settings, checkout Payment Link, Square webhook, rates, and labels routes compile.

- [ ] **Step 4: Perform the authenticated shipping-settings smoke test**

Start the site with the repository's normal local environment, open `/admin/settings/shipping`, then:

1. Click UPS and verify its button changes state immediately.
2. Enable FedEx, save, refresh, and verify it remains selected.
3. Edit two category rates and verify the summaries show the saved values.
4. Verify no public-checkout flat-rate card or product shipping override is visible.

Expected: all four observations succeed without console or API errors.

- [ ] **Step 5: Perform one staffed sandbox order-to-label test and record evidence**

Use a mixed-category cart whose configured rates differ. Verify the local reservation and Square Payment Link charge the higher category rate once, complete the Square sandbox payment with a changed shipping address, verify the local order stores that final address with `square_synced_at`, then confirm that staff sees only enabled Shippo providers and can purchase one allowed test label.

Expected evidence: local order ID, Square order/payment IDs, charged subtotal/shipping/tax/total, enabled provider list, Shippo shipment/rate/transaction IDs, and timestamps. Do not record customer address values or secrets.
