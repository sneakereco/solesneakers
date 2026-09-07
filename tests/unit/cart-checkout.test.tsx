import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: { alt: string; src: string }) => (
    <img alt={props.alt} src={props.src} />
  ),
}));
jest.mock("@/components/cart/CartProvider", () => ({
  useCart: () => ({
    items: [
      {
        productId: "product-1",
        variantId: "variant-1",
        sizeLabel: "10",
        brand: "Sole",
        titleDisplay: "Air Runner",
        priceCents: 10000,
        imageUrl: "https://images.example.com/air-runner.jpg",
        quantity: 1,
      },
    ],
    itemCount: 1,
    removeItem: jest.fn(),
    updateQuantity: jest.fn(),
    total: 10000,
    isReady: true,
  }),
}));
jest.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ user: null }),
}));
jest.mock("@/components/cart/ShippingEstimate", () => ({
  ShippingEstimate: () => <div>Shipping estimate</div>,
}));

import CartPage from "../../app/(store)/cart/page";

describe("CartPage checkout", () => {
  it("links to checkout without asking for fulfillment in the cart", () => {
    const html = renderToStaticMarkup(<CartPage />);

    expect(html).toContain("air-runner.jpg");
    expect(html).toContain('href="/checkout"');
    expect(html).toContain("Checkout");
    expect(html).not.toContain("Local pickup");
    expect(html).not.toContain("Continue to secure payment");
  });
});
