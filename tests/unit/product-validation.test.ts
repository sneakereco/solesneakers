import { productCreateSchema } from "@/lib/validation/product";

describe("productCreateSchema", () => {
  it("accepts a product payload with no images", () => {
    const result = productCreateSchema.safeParse({
      name: "Jordan 3 Retro",
      brand_id: "00000000-0000-4000-8000-000000000001",
      model_id: "00000000-0000-4000-8000-000000000002",
      category: "sneakers",
      condition: "used",
      size_type: "shoe",
      description: "No photos yet",
      shipping_price_cents: 1500,
      variants: [
        {
          sku: "123456",
          size_id: "00000000-0000-4000-8000-000000000003",
          sale_price_cents: 25000,
          stock: 1,
          unit_cost_cents: 12000,
        },
      ],
      images: [],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a variant without a unit cost", () => {
    const result = productCreateSchema.safeParse({
      name: "Jordan 3 Retro",
      brand_id: "00000000-0000-4000-8000-000000000001",
      category: "sneakers",
      condition: "new",
      size_type: "shoe",
      variants: [
        {
          size_id: "00000000-0000-4000-8000-000000000003",
          sale_price_cents: 25000,
          stock: 1,
        },
      ],
      images: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects the retired generic tag contract", () => {
    const result = productCreateSchema.safeParse({
      name: "Jordan 3 Retro",
      brand_id: "00000000-0000-4000-8000-000000000001",
      category: "sneakers",
      condition: "new",
      size_type: "shoe",
      variants: [
        {
          size_id: "00000000-0000-4000-8000-000000000003",
          sale_price_cents: 25000,
          stock: 1,
          unit_cost_cents: 12000,
        },
      ],
      images: [],
      tags: [{ label: "Nike", group_key: "brand" }],
    });

    expect(result.success).toBe(false);
  });
});
