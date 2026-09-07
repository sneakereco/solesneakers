import { renderToStaticMarkup } from "react-dom/server";

import { SquarePaymentMethods } from "@/components/checkout/SquarePaymentMethods";

describe("SquarePaymentMethods", () => {
  it("renders isolated card, Afterpay, and guest verification surfaces", () => {
    const html = renderToStaticMarkup(
      <SquarePaymentMethods
        checkout={{
          orderId: "order-1",
          guestAccessToken: "guest-token",
          totals: {
            subtotalCents: 10000,
            shippingCents: 1000,
            taxCents: 800,
            totalCents: 11800,
          },
          paymentConfig: {
            applicationId: "sandbox-app",
            locationId: "location-1",
            environment: "sandbox",
          },
        }}
        deviceSessionId="device-1"
        buyerEmail="buyer@example.com"
        shippingAddress={null}
        isGuest
        clearCart={jest.fn()}
      />,
    );

    expect(html).toContain('id="square-card-container"');
    expect(html).toContain('id="square-afterpay-container"');
    expect(html).toContain("Pay $118.00 by card");
  });
});
