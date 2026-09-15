import { renderToStaticMarkup } from "react-dom/server";

import { CheckoutDeliverySection } from "@/components/checkout/CheckoutDeliverySection";

const address = {
  name: "Buyer Example",
  phone: "3025550100",
  line1: "1 Market St",
  line2: "Suite 2",
  city: "Wilmington",
  state: "DE",
  postalCode: "19801",
  country: "US" as const,
};

describe("CheckoutDeliverySection", () => {
  it("renders the approved shipping fields without a shipping-method selector", () => {
    const html = renderToStaticMarkup(
      <CheckoutDeliverySection
        fulfillment="ship"
        address={address}
        onFulfillmentChange={jest.fn()}
        onAddressChange={jest.fn()}
      />,
    );

    expect(html).toContain("Ship");
    expect(html).toContain("Pickup");
    expect(html).toContain('aria-label="First name"');
    expect(html).toContain('value="Buyer"');
    expect(html).toContain('aria-label="Last name"');
    expect(html).toContain('value="Example"');
    expect(html).toContain('autoComplete="shipping street-address"');
    expect(html).toContain('aria-label="State"');
    expect(html).toContain('<option value="DE" selected="">Delaware</option>');
    expect(html).toContain('aria-label="Search address"');
    expect(html).toContain('aria-label="Phone help"');
    expect(html).toContain("In case we need to contact you about your order");
    expect(html).toContain("bg-[#e8e8e8]");
    expect(html).not.toContain("Shipping method");
  });

  it("replaces shipping-only fields with the pickup location", () => {
    const html = renderToStaticMarkup(
      <CheckoutDeliverySection
        fulfillment="pickup"
        address={address}
        onFulfillmentChange={jest.fn()}
        onAddressChange={jest.fn()}
      />,
    );

    expect(html).toContain("Pickup in");
    expect(html).not.toContain('autoComplete="shipping street-address"');
    expect(html).toContain('aria-label="First name"');
    expect(html).toContain('type="tel"');
  });
});
