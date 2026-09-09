import { renderToStaticMarkup } from "react-dom/server";

import { CheckoutContactSection } from "@/components/checkout/CheckoutContactSection";

describe("CheckoutContactSection", () => {
  it("offers checkout-preserving sign in only to guests", () => {
    const guestHtml = renderToStaticMarkup(
      <CheckoutContactSection
        email="guest@example.com"
        isGuest
        onEmailChange={jest.fn()}
      />,
    );
    const customerHtml = renderToStaticMarkup(
      <CheckoutContactSection
        email="buyer@example.com"
        isGuest={false}
        onEmailChange={jest.fn()}
      />,
    );

    expect(guestHtml).toContain('href="/auth/login?next=%2Fcheckout"');
    expect(customerHtml).not.toContain("Sign in");
    expect(customerHtml).toContain('value="buyer@example.com"');
    expect(customerHtml).toContain("disabled");
    expect(guestHtml).toContain('aria-label="Email help"');
    expect(guestHtml).not.toMatch(/news|offers|marketing/i);
  });
});
