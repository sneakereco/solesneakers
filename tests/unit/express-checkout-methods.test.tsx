import { renderToStaticMarkup } from "react-dom/server";

import { ExpressCheckoutMethods } from "@/components/checkout/ExpressCheckoutMethods";

describe("ExpressCheckoutMethods", () => {
  it("retains wallet hosts while preventing payment during an update", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady
        googlePayReady
        disabled
        loading={false}
        quoteIsExact
        onApplePayClick={jest.fn()}
        onGooglePayClick={jest.fn()}
      />,
    );
    expect(html).toMatch(/id="square-apple-pay-container"[^>]*disabled=""/);
    expect(html).toMatch(
      /id="square-google-pay-container"[^>]*inert=""[^>]*aria-disabled="true"/,
    );
    expect(html).not.toMatch(/<section[^>]*hidden/);
  });
  it("shows only Square-ready wallet controls", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        googlePayReady
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
    expect(html).not.toContain('id="square-cash-app-pay-container"');
    expect(html).not.toContain("sm:grid-cols-2");
  });

  it("collapses the express section while no wallet is ready", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        googlePayReady={false}
        loading={false}
        quoteIsExact={false}
        onApplePayClick={jest.fn()}
        onGooglePayClick={jest.fn()}
      />,
    );

    expect(html).toMatch(/<section[^>]*hidden/);
    expect(html).toContain('id="square-apple-pay-container"');
    expect(html).toContain('id="square-google-pay-container"');
    expect(html).not.toContain('id="square-cash-app-pay-container"');
  });

  it("shows an accessible loading status while wallet availability is checked", () => {
    const html = renderToStaticMarkup(
      <ExpressCheckoutMethods
        applePayReady={false}
        googlePayReady={false}
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
    expect(html).not.toContain("Calculated after address");
    expect(html).toContain("Shipping and tax are calculated in your wallet.");
  });
});
