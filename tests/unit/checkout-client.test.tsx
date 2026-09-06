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
  it("offers direct Square shipping and pickup without a local address form", () => {
    const html = renderToStaticMarkup(<CheckoutClient />);

    expect(html).toContain("Ship to me");
    expect(html).toContain("Local pickup");
    expect(html).toContain('type="email"');
    expect(html).not.toContain("Shipping address");
    expect(html).not.toContain("Address</label>");
  });
});
