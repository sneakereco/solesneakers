const mockUseState = jest.fn();

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (initial: unknown) => mockUseState(initial),
  };
});

jest.mock("@/components/cart/CartProvider", () => ({
  useCart: () => ({
    items: [
      {
        productId: "product-1",
        variantId: "variant-1",
        titleDisplay: "Air Runner",
        sizeLabel: "10",
        quantity: 1,
        priceCents: 10000,
        imageUrl: "https://images.example.com/air-runner.jpg",
      },
    ],
    isReady: true,
    clearCart: jest.fn(),
  }),
}));

jest.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ user: null }),
}));

import { renderToStaticMarkup } from "react-dom/server";

import { CheckoutClient } from "@/components/checkout/CheckoutClient";

describe("CheckoutClient prepared order", () => {
  it("keeps fulfillment controls visible with the embedded payment fields", () => {
    const prepared = {
      orderId: "order-1",
      guestAccessToken: "guest-token",
      totals: {
        subtotalCents: 10000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 10000,
      },
      paymentConfig: {
        applicationId: "sandbox-app-id",
        locationId: "location-1",
        environment: "sandbox" as const,
      },
      buyerEmail: "buyer@example.com",
      shippingAddress: null,
      deviceSessionId: "device-1",
    };
    let stateCall = 0;
    mockUseState.mockImplementation((initial: unknown) => {
      stateCall += 1;
      return [stateCall === 4 ? prepared : initial, jest.fn()];
    });

    const html = renderToStaticMarkup(<CheckoutClient />);

    expect(html).toContain("Shipping");
    expect(html).toContain("Local pickup");
    expect(html).toContain('id="square-card-container"');
    expect(html).toContain("Update order");
  });
});
