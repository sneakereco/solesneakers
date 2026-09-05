import { resolveCheckoutCart } from "@/lib/checkout/checkout-cart-resolver";

const product = {
  id: "product-1",
  name: "Air Runner",
  brand: "Sole",
  model: "One",
  titleDisplay: "Sole Air Runner One",
  category: "sneakers",
  condition: "new",
  tenantId: "tenant-1",
  shippingPriceCents: 1200,
  variants: [
    {
      id: "variant-1",
      sku: "SOLE-1-10",
      sizeLabel: "10",
      salePriceCents: 15000,
      unitCostCents: 9000,
      stock: 2,
    },
  ],
};

describe("resolveCheckoutCart", () => {
  it("uses only authoritative product values", async () => {
    const repository = {
      getProductsForCheckout: jest.fn().mockResolvedValue([product]),
    };

    const result = await resolveCheckoutCart(repository, "tenant-1", [
      { productId: "product-1", variantId: "variant-1", quantity: 2 },
    ]);

    expect(result.subtotalCents).toBe(30000);
    expect(result.items).toEqual([
      expect.objectContaining({
        productId: "product-1",
        variantId: "variant-1",
        quantity: 2,
        unitPriceCents: 15000,
        unitCostCents: 9000,
        lineTotalCents: 30000,
      }),
    ]);
    expect(result.items[0]).not.toHaveProperty("shippingPriceCents");
  });

  it("rejects cross-tenant products", async () => {
    const repository = {
      getProductsForCheckout: jest
        .fn()
        .mockResolvedValue([{ ...product, tenantId: "tenant-2" }]),
    };

    await expect(
      resolveCheckoutCart(repository, "tenant-1", [
        { productId: "product-1", variantId: "variant-1", quantity: 1 },
      ]),
    ).rejects.toThrow("checkout_cart_unavailable");
  });

  it("rejects missing variants and insufficient inventory", async () => {
    const repository = {
      getProductsForCheckout: jest.fn().mockResolvedValue([product]),
    };

    await expect(
      resolveCheckoutCart(repository, "tenant-1", [
        { productId: "product-1", variantId: "missing", quantity: 1 },
      ]),
    ).rejects.toThrow("checkout_cart_unavailable");

    await expect(
      resolveCheckoutCart(repository, "tenant-1", [
        { productId: "product-1", variantId: "variant-1", quantity: 3 },
      ]),
    ).rejects.toThrow("checkout_inventory_unavailable");
  });
});
