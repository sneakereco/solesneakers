import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/components/cart/CartProvider", () => ({
  useCart: () => ({
    items: [
      {
        productId: "product-1",
        variantId: "variant-1",
        titleDisplay: "Air Runner",
        quantity: 1,
        priceCents: 10000,
        imageUrl: "https://images.example.com/air-runner.jpg",
      },
    ],
    total: 10000,
    isReady: true,
  }),
}));

jest.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ user: null }),
}));

import { CheckoutClient } from "@/components/checkout/CheckoutClient";

describe("CheckoutClient", () => {
  it("keeps guest checkout and collects shipping details before embedded payment", () => {
    const html = renderToStaticMarkup(<CheckoutClient />);

    expect(html).toContain("Shipping");
    expect(html).toContain("Local pickup");
    expect(html).toContain('type="email"');
    expect(html).toContain('autoComplete="shipping street-address"');
    expect(html).toContain("Card");
    expect(html).toContain("Afterpay");
    expect(html).toContain("Continue to secure payment");
    expect(html).toContain("air-runner.jpg");
    expect(html).not.toContain("Address and payment details are entered on Square");
  });
});
