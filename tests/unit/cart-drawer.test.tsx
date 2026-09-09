import { renderToStaticMarkup } from "react-dom/server";

import { CartDrawer } from "@/components/cart/CartDrawer";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/cart/CartProvider", () => ({
  useCart: () => ({
    items: [],
    itemCount: 0,
    removeItem: jest.fn(),
    updateQuantity: jest.fn(),
    total: 0,
  }),
}));

jest.mock("@/components/cart/ShippingEstimate", () => ({
  ShippingEstimate: () => null,
}));

describe("CartDrawer", () => {
  it("makes the closed drawer inert without aria-hiding a focused descendant", () => {
    const html = renderToStaticMarkup(
      <CartDrawer isOpen={false} onClose={jest.fn()} />,
    );

    expect(html).toMatch(/^<div[^>]*inert=""/);
    expect(html).not.toMatch(/^<div[^>]*aria-hidden=/);
  });
});
