import { createCheckoutQuoteFingerprint } from "@/lib/checkout/checkout-quote-fingerprint";

const address = {
  name: "Buyer Example",
  phone: "8435550100",
  line1: "1 Main Street",
  line2: null,
  city: "Charleston",
  state: "SC",
  postalCode: "29401",
  country: "US" as const,
};

const input = {
  items: [
    {
      variantId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
      unitPriceCents: 10_000,
    },
    {
      variantId: "33333333-3333-4333-8333-333333333333",
      quantity: 2,
      unitPriceCents: 2_500,
    },
  ],
  fulfillment: "ship" as const,
  shippingAddress: address,
  totals: {
    subtotalCents: 15_000,
    shippingCents: 1_500,
    taxCents: 990,
    totalCents: 17_490,
  },
};

describe("checkout quote fingerprint", () => {
  it("is deterministic when item order changes", () => {
    expect(
      createCheckoutQuoteFingerprint({ ...input, items: [...input.items].reverse() }),
    ).toBe(createCheckoutQuoteFingerprint(input));
  });

  it.each([
    ["quantity", { ...input, items: [{ ...input.items[0], quantity: 2 }] }],
    [
      "variant",
      { ...input, items: [{ ...input.items[0], variantId: crypto.randomUUID() }] },
    ],
    ["fulfillment", { ...input, fulfillment: "pickup" as const, shippingAddress: null }],
    ["address", { ...input, shippingAddress: { ...address, postalCode: "29403" } }],
    [
      "totals",
      { ...input, totals: { ...input.totals, taxCents: 991, totalCents: 17_491 } },
    ],
  ])("changes when %s changes", (_field, changed) => {
    expect(createCheckoutQuoteFingerprint(changed)).not.toBe(
      createCheckoutQuoteFingerprint(input),
    );
  });
});
