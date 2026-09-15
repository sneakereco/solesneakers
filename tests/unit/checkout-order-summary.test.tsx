import { renderToStaticMarkup } from "react-dom/server";

import { CheckoutOrderSummary } from "@/components/checkout/CheckoutOrderSummary";

const items = [
  {
    productId: "product-1",
    variantId: "variant-1",
    titleDisplay: "Air Runner",
    sizeLabel: "10",
    brand: "Sole",
    name: "Air Runner",
    quantity: 1,
    priceCents: 10_000,
    imageUrl: "https://images.example.com/air-runner.jpg",
  },
];

describe("CheckoutOrderSummary", () => {
  it("labels preliminary totals and defers tax", () => {
    const html = renderToStaticMarkup(
      <CheckoutOrderSummary
        items={items}
        quoteState={{
          status: "ready",
          quote: {
            completeness: "preliminary",
            totals: {
              subtotalCents: 10_000,
              shippingCents: 1_000,
              taxCents: null,
              totalCents: 11_000,
            },
            quoteFingerprint: null,
          },
        }}
      />,
    );

    expect(html).toContain("Air Runner");
    expect(html).toContain(
      '<h2 id="order-summary-heading" class="sr-only">Order summary</h2>',
    );
    expect(html).toContain("Calculated after address");
    expect(html).toContain("Estimated total");
    expect(html).toContain("$110.00");
  });

  it("shows Square-authoritative exact tax and total", () => {
    const html = renderToStaticMarkup(
      <CheckoutOrderSummary
        items={items}
        quoteState={{
          status: "ready",
          quote: {
            completeness: "exact",
            totals: {
              subtotalCents: 10_000,
              shippingCents: 1_000,
              taxCents: 800,
              totalCents: 11_800,
            },
            quoteFingerprint: "a".repeat(64),
          },
        }}
      />,
    );

    expect(html).toContain("$8.00");
    expect(html).toContain("$118.00");
    expect(html).toContain(">Total<");
    expect(html).not.toContain("Other Also Bought");
    expect(html).not.toContain("Shipping Insurance");
    expect(html).not.toContain("Discount code");
    expect(html).not.toContain("Protection Coverage");
  });
});
