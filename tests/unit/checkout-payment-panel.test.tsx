import { renderToStaticMarkup } from "react-dom/server";

import { EMPTY_BILLING_ADDRESS } from "@/components/checkout/BillingAddressFields";
import { CheckoutPaymentPanel } from "@/components/checkout/CheckoutPaymentPanel";

const baseProps = {
  afterpayReady: true,
  fulfillment: "ship" as const,
  sameAsShipping: true,
  cardholderName: "",
  billingAddress: EMPTY_BILLING_ADDRESS,
  isPaying: false,
  payDisabled: true,
  payLabel: "Pay now",
  error: null,
  onSelectMethod: jest.fn(),
  onSameAsShippingChange: jest.fn(),
  onCardholderNameChange: jest.fn(),
  onBillingAddressChange: jest.fn(),
  onPay: jest.fn(),
};

describe("CheckoutPaymentPanel", () => {
  it("renders Card first without fabricated card-brand artwork", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel {...baseProps} selectedMethod="card" />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio" aria-checked="true"');
    expect(html).toContain('id="square-card-container"');
    expect(html).toContain("Use shipping address as billing address");
    expect(html).toContain('id="square-afterpay-container"');
    expect(html).toContain('alt="Afterpay"');
    expect(html).toContain('src="/images/payments/afterpay.svg"');
    expect(html).not.toMatch(/aria-label="(?:Visa|Mastercard|American Express)"/);
    expect(html).not.toContain("+5");
  });

  it("shows Afterpay redirect and billing choices when selected", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel {...baseProps} selectedMethod="afterpay" />,
    );

    expect(html).toMatch(
      /<div hidden="" class="hidden [^"]*"><div id="square-card-container"/,
    );
    expect(html).toContain("redirected to Afterpay");
    expect(html).toContain("Same as shipping address");
    expect(html).toContain("Use a different billing address");
  });

  it("requires explicit billing fields for pickup", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel {...baseProps} selectedMethod="card" fulfillment="pickup" />,
    );

    expect(html).not.toContain("Use shipping address as billing address");
    expect(html).toContain("Billing address");
    expect(html).toContain('autoComplete="billing given-name"');
    expect(html).toContain('<option value="DE">Delaware</option>');
  });
});
