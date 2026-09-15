import { renderToStaticMarkup } from "react-dom/server";

import { EMPTY_BILLING_ADDRESS } from "@/components/checkout/BillingAddressFields";
import { CheckoutPaymentPanel } from "@/components/checkout/CheckoutPaymentPanel";

const baseProps = {
  afterpayReady: true,
  cashAppPayReady: true,
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
  it("locks the selected payment method while payment is in progress", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel {...baseProps} selectedMethod="card" isPaying />,
    );
    expect(html.match(/<button[^>]*role="radio"[^>]*disabled=""/g)).toHaveLength(3);
  });
  it("renders Card first with accepted brand badges and shared billing", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel {...baseProps} selectedMethod="card" />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio" aria-checked="true"');
    expect(html).toContain('id="square-card-container"');
    expect(html).toContain("Same as shipping address");
    expect(html).toContain('id="square-afterpay-container"');
    expect(html).toContain('alt="Afterpay"');
    expect(html).toContain('src="/images/payments/afterpay.svg"');
    expect(html).toContain('alt="Visa"');
    expect(html).toContain("Show 4 more accepted card brands");
    expect(html).not.toContain("+5");
  });

  it("keeps Afterpay selected with billing choices while it is not ready", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel
        {...baseProps}
        selectedMethod="afterpay"
        afterpayReady={false}
      />,
    );

    expect(html).toMatch(/id="payment-card-content"[^>]*data-open="false"[^>]*inert=""/);
    expect(html).toContain("to approve your payment.");
    expect(html).not.toContain("Afterpay popup");
    expect(html).toMatch(/<div id="square-afterpay-container" hidden/);
    expect(html).toContain("Same as shipping address");
    expect(html).toContain("Use a different billing address");
  });

  it("keeps all choices visible while Cash App waits for delivery details", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel
        {...baseProps}
        selectedMethod="cashAppPay"
        cashAppPayReady={false}
        afterpayReady={false}
        methodMessage="Enter your delivery details to continue with Cash App Pay."
        onRetryMethod={jest.fn()}
      />,
    );
    expect(html).toMatch(
      /<button[^>]*role="radio" aria-checked="true"[^>]*>.*Cash App Pay/,
    );
    expect(html).not.toMatch(/<button[^>]*role="radio"[^>]*hidden/);
    expect(html.indexOf("Credit card")).toBeLessThan(html.indexOf("Cash App Pay"));
    expect(html.indexOf("Cash App Pay")).toBeLessThan(html.indexOf(">Afterpay"));
    expect(html).toContain('id="square-cash-app-pay-container"');
    expect(html).toContain('src="/images/payments/cash-app-pay.svg"');
    expect(html).toContain("to approve your payment.");
    expect(html).toContain('role="status"');
    expect(html).toContain("Enter your delivery details");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Pay now");
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*>Continue with Cash App Pay<\/button>/,
    );
  });

  it.each(["card", "cashAppPay", "afterpay"] as const)(
    "requires explicit billing fields for pickup with %s",
    (selectedMethod) => {
      const html = renderToStaticMarkup(
        <CheckoutPaymentPanel
          {...baseProps}
          selectedMethod={selectedMethod}
          fulfillment="pickup"
        />,
      );

      expect(html).not.toContain("Same as shipping address");
      expect(html).toContain("Billing address");
      expect(html).toContain('autoComplete="billing given-name"');
      expect(html).toContain('<option value="DE">Delaware</option>');
      expect(html).toContain("In case we need to contact you about your order");
    },
  );

  it("keeps checkout policies available beside the payment action", () => {
    const html = renderToStaticMarkup(
      <CheckoutPaymentPanel {...baseProps} selectedMethod="card" />,
    );

    expect(html).toContain('href="/refunds"');
    expect(html).toContain('href="/shipping"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/contact"');
  });
});
