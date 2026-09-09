import { renderToStaticMarkup } from "react-dom/server";

import { ExpressCheckoutMethods } from "@/components/checkout/ExpressCheckoutMethods";

describe("ExpressCheckoutMethods", () => {
  it("shows only Square-ready wallet controls", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        googlePayReady
        cashAppPayReady={false}
        loading={false}
        quoteIsExact
        onApplePayClick={jest.fn()}
        onGooglePayClick={jest.fn()}
      />,
    );

    expect(html).not.toMatch(/<section[^>]*hidden/);
    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).toContain('id="square-apple-pay-container" type="button" hidden');
    expect(html).toContain('id="square-google-pay-container" class="min-h-12"');
    expect(html).toContain('id="square-cash-app-pay-container" hidden');
  });

  it("collapses the express section while no wallet is ready", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        googlePayReady={false}
        cashAppPayReady={false}
        loading={false}
        quoteIsExact={false}
        onApplePayClick={jest.fn()}
        onGooglePayClick={jest.fn()}
      />,
    );

    expect(html).toMatch(/<section[^>]*hidden/);
    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).toContain('id="square-google-pay-container"');
    expect(html).toContain('id="square-cash-app-pay-container"');
  });

  it("shows an accessible loading status while wallet availability is checked", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        googlePayReady={false}
        cashAppPayReady={false}
        loading
        quoteIsExact={false}
        onApplePayClick={jest.fn()}
        onGooglePayClick={jest.fn()}
      />,
    );

    expect(html).not.toMatch(/<section[^>]*hidden/);
    expect(html).toContain("Express checkout");
    expect(html).toContain('role="status"');
    expect(html).toContain("Checking available express payment methods…");
  });
});
