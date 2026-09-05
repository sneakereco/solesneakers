import type { ResolvedCheckoutItem } from "@/lib/checkout/checkout-cart-resolver";
import {
  CheckoutPricingUnavailableError,
  createCheckoutPricingGateway,
} from "@/lib/checkout/checkout-pricing-gateway";

const item = (category: string, quantity = 1): ResolvedCheckoutItem => ({
  productId: `product-${category}`,
  variantId: `variant-${category}`,
  quantity,
  unitPriceCents: 10_000,
  unitCostCents: 5_000,
  lineTotalCents: 10_000 * quantity,
  variantSku: `SKU-${category}`,
  productName: category,
  brand: "Sole",
  model: null,
  category,
  condition: "new",
  sizeLabel: "10",
});

describe("createCheckoutPricingGateway", () => {
  it("charges the highest represented category once", async () => {
    const getByCategories = jest.fn().mockResolvedValue([
      { category: "sneakers", shipping_cost_cents: 1500 },
      { category: "clothing", shipping_cost_cents: 900 },
    ]);
    const gateway = createCheckoutPricingGateway({ getByCategories } as never);

    const quote = await gateway.quote({
      tenantId: "tenant-1",
      fulfillment: "ship",
      shippingAddress: null,
      subtotalCents: 30_000,
      items: [item("sneakers", 2), item("clothing")],
    });

    expect(quote.shippingCents).toBe(1500);
    expect(getByCategories).toHaveBeenCalledWith("tenant-1", ["sneakers", "clothing"]);
  });

  it("fails closed when a represented category is missing", async () => {
    const gateway = createCheckoutPricingGateway({
      getByCategories: jest
        .fn()
        .mockResolvedValue([{ category: "sneakers", shipping_cost_cents: 1500 }]),
    } as never);

    await expect(
      gateway.quote({
        tenantId: "tenant-1",
        fulfillment: "ship",
        shippingAddress: null,
        subtotalCents: 20_000,
        items: [item("sneakers"), item("electronics")],
      }),
    ).rejects.toMatchObject({
      name: "CheckoutPricingUnavailableError",
      category: "electronics",
    });
  });

  it("returns zero for pickup without reading shipping defaults", async () => {
    const getByCategories = jest.fn();
    const gateway = createCheckoutPricingGateway({ getByCategories } as never);

    await expect(
      gateway.quote({
        tenantId: "tenant-1",
        fulfillment: "pickup",
        shippingAddress: null,
        subtotalCents: 10_000,
        items: [item("sneakers")],
      }),
    ).resolves.toMatchObject({ shippingCents: 0, taxCents: 0 });
    expect(getByCategories).not.toHaveBeenCalled();
  });

  it("rejects an invalid configured category price", async () => {
    const gateway = createCheckoutPricingGateway({
      getByCategories: jest
        .fn()
        .mockResolvedValue([{ category: "sneakers", shipping_cost_cents: -1 }]),
    } as never);

    await expect(
      gateway.quote({
        tenantId: "tenant-1",
        fulfillment: "ship",
        shippingAddress: null,
        subtotalCents: 10_000,
        items: [item("sneakers")],
      }),
    ).rejects.toBeInstanceOf(CheckoutPricingUnavailableError);
  });
});
