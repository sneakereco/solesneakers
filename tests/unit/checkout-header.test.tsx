import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/components/cart/CartProvider", () => ({
  useCart: () => ({ itemCount: 3 }),
}));

import { CheckoutHeader } from "@/components/checkout/CheckoutHeader";

describe("CheckoutHeader", () => {
  it("links the branded checkout header directly to the cart", () => {
    const html = renderToStaticMarkup(<CheckoutHeader />);

    expect(html).toContain("<header");
    expect(html).toContain('alt="Sole Sneakers"');
    expect(html).toContain('href="/cart"');
    expect(html).toContain('aria-label="Go to cart, 3 items"');
    expect(html).not.toContain("openCart");
    expect(html).not.toContain("sticky");
    expect(html).not.toContain("fixed");
  });
});
