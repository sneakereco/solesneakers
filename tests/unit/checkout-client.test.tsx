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
  it("shows the complete checkout immediately with signed-in defaults", () => {
    const html = renderToStaticMarkup(
      <CheckoutClient
        initialData={{
          isGuest: false,
          customer: {
            email: "buyer@example.com",
            address: {
              name: "Buyer Example",
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
            applicationId: "sandbox-app",
            locationId: "location-1",
            environment: "sandbox",
          },
        }}
      />,
    );

    expect(html).toContain("Contact");
    expect(html).toContain("Delivery");
    expect(html).toContain("Payment");
    expect(html).toContain("Shipping");
    expect(html).toContain("Local pickup");
    expect(html).toContain('type="email"');
    expect(html).toContain('value="buyer@example.com"');
    expect(html).toContain('value="1 Market St"');
    expect(html).toContain('autoComplete="shipping street-address"');
    expect(html).toContain('id="square-card-container"');
    expect(html).toContain("Subtotal");
    expect(html).toContain("Tax");
    expect(html).toContain("Estimated total");
    expect(html).toContain("air-runner.jpg");
    expect(html).not.toContain("Continue to secure payment");
    expect(html).not.toContain("Update order");
    expect(html).not.toContain("news and offers");
    expect(html).not.toContain("Shipping method");
    expect(html).not.toContain("Save my information");
  });
});
