import { renderToStaticMarkup } from "react-dom/server";

import { ExpressCheckoutMethods } from "@/components/checkout/ExpressCheckoutMethods";

describe("ExpressCheckoutMethods", () => {
  it("retains wallet hosts while preventing payment during an update", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady
        disabled
        loading={false}
        onApplePayClick={jest.fn()}
      />,
    );
    expect(html).toMatch(/id="square-apple-pay-container"[^>]*disabled=""/);
    expect(html).not.toContain("square-google-pay-container");
    expect(html).not.toMatch(/<section[^>]*hidden/);
  });
  it("shows Apple Pay with the express checkout legal notice", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady
        loading={false}
        onApplePayClick={jest.fn()}
      />,
    );

    expect(html).not.toMatch(/<section[^>]*hidden/);
    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).not.toContain("square-google-pay-container");
    expect(html).not.toContain('id="square-cash-app-pay-container"');
    expect(html).not.toContain("sm:grid-cols-2");
    expect(html).toContain("By using an express payment method");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it("collapses the express section while no wallet is ready", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        loading={false}
        onApplePayClick={jest.fn()}
      />,
    );

    expect(html).toMatch(/<section[^>]*hidden/);
    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).not.toContain('id="square-google-pay-container"');
    expect(html).not.toContain('id="square-cash-app-pay-container"');
  });

  it("shows an accessible loading status while wallet availability is checked", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        loading
        onApplePayClick={jest.fn()}
      />,
    );

    expect(html).not.toMatch(/<section[^>]*hidden/);
    expect(html).toContain("Express checkout");
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading express checkout");
    expect(html).toContain("animate-spin");
    expect(html).toContain('class="sr-only"');
    expect(html).not.toContain("Calculated after address");
    expect(html).not.toContain("Shipping and tax are calculated in your wallet.");
  });
});
