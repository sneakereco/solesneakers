import { renderToStaticMarkup } from "react-dom/server";

import { SquarePaymentMethods } from "@/components/checkout/SquarePaymentMethods";

const paymentConfig = {
  applicationId: "sandbox-app",
  locationId: "location-1",
  environment: "sandbox" as const,
};

describe("SquarePaymentMethods", () => {
  it("renders express, card, Afterpay, and guest verification surfaces immediately", () => {
    const html = renderToStaticMarkup(
      <SquarePaymentMethods
        paymentConfig={paymentConfig}
        exactQuote={null}
        fulfillment="ship"
        buyerEmail=""
        shippingAddress={null}
        isGuest
        prepare={jest.fn()}
        clearCart={jest.fn()}
      />,
    );

    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).toContain('id="square-google-pay-container"');
    expect(html).toContain('id="square-cash-app-pay-container"');
    expect(html).toContain('id="square-card-container"');
    expect(html).toContain('id="square-afterpay-container"');
    expect(html).toContain("Calculated after address");
    expect(html).toContain("Pay now");
  });

  it("renders an exact card total without marketing payment options", () => {
    const html = renderToStaticMarkup(
      <SquarePaymentMethods
        paymentConfig={paymentConfig}
        exactQuote={{
          completeness: "exact",
          quoteFingerprint: "a".repeat(64),
          totals: {
            subtotalCents: 10_000,
            shippingCents: 1_000,
            taxCents: 800,
            totalCents: 11_800,
          },
        }}
        fulfillment="pickup"
        buyerEmail="buyer@example.com"
        shippingAddress={null}
        isGuest={false}
        prepare={jest.fn()}
        clearCart={jest.fn()}
      />,
    );

    expect(html).toContain("Pay $118.00 now");
    expect(html).not.toContain("PayPal");
    expect(html).not.toContain("Klarna");
    expect(html).not.toContain("Venmo");
  });
});
