import { ProductSkuService } from "@/services/product-sku-service";
import { ProductService } from "@/services/product-service";

const mockGetBrandById = jest.fn();
const mockGetModelById = jest.fn();
const mockGetSizeById = jest.fn();

jest.mock("@/repositories/tag-taxonomy-repo", () => ({
  TagTaxonomyRepository: jest.fn().mockImplementation(() => ({
    getBrandById: mockGetBrandById,
    getModelById: mockGetModelById,
    getSizeById: mockGetSizeById,
  })),
}));

describe("variant SKU assignment", () => {
  it("rejects ordinary mutations and duplication of specialty products before writes", async () => {
    const service = new ProductService({} as never);
    (service as unknown as { repo: unknown }).repo = {
      getById: () => Promise.resolve({ category: "specialty" }),
      update: () => {
        return Promise.reject(new Error("unexpected write"));
      },
    };
    await expect(
      service.updateProduct("product", { category: "specialty" } as never, {
        userId: "admin",
        tenantId: "tenant",
      }),
    ).rejects.toThrow(/specialty/i);
    await expect(
      service.duplicateProduct("product", { userId: "admin", tenantId: "tenant" }),
    ).rejects.toThrow(/specialty/i);
    await expect(
      service.createProduct({ category: "specialty" } as never, {
        userId: "admin",
        tenantId: "tenant",
      }),
    ).rejects.toThrow(/specialty/i);
  });
  beforeEach(() => jest.clearAllMocks());

  it("generates numeric SKUs for variants missing a SKU", () => {
    const skuService = new ProductSkuService();
    const existing = ["100001"];

    const first = skuService.getNextNumericSku(existing);
    const second = skuService.getNextNumericSku([...existing, first]);

    expect(first).toBe("100002");
    expect(second).toBe("100003");
  });

  it("hard deletes products even when order items exist", async () => {
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const archiveMock = jest.fn().mockResolvedValue(undefined);

    const service = new ProductService({} as never);
    (service as unknown as { repo: unknown }).repo = {
      delete: deleteMock,
      archive: archiveMock,
    };

    const result = await service.deleteProduct("product-1");

    expect(deleteMock).toHaveBeenCalledWith("product-1");
    expect(archiveMock).not.toHaveBeenCalled();
    expect(result).toEqual({ archived: false });
  });

  it.each([
    [undefined, false],
    [0, true],
    [7000, true],
  ] as const)(
    "persists canonical taxonomy and trusted cost presence for %s",
    async (cost, recorded) => {
      const create = jest.fn().mockResolvedValue({ id: "product-1" });
      const createVariant = jest.fn().mockResolvedValue({ id: "variant-1" });
      const createImage = jest.fn();
      const listVariantSkus = jest.fn().mockResolvedValue([]);
      mockGetBrandById.mockResolvedValue({
        id: "brand-1",
        tenant_id: null,
        is_active: true,
      });
      mockGetModelById.mockResolvedValue({
        id: "model-1",
        brand_id: "brand-1",
        tenant_id: null,
        is_active: true,
      });
      mockGetSizeById.mockResolvedValue({
        id: "size-1",
        size_type: "shoe",
        tenant_id: null,
        is_active: true,
      });

      const service = new ProductService({} as never);
      (service as unknown as { repo: unknown }).repo = {
        create,
        createVariant,
        createImage,
        listVariantSkus,
      };

      await service.createProduct(
        {
          name: "Nike Dunk Low",
          brand_id: "brand-1",
          model_id: "model-1",
          category: "sneakers",
          condition: "new",
          size_type: "shoe",
          variants: [
            {
              size_id: "size-1",
              sale_price_cents: 12000,
              ...(cost === undefined ? {} : { unit_cost_cents: cost }),
              stock: 1,
              sort_order: 0,
            },
          ],
          images: [],
        },
        { userId: "user-1", tenantId: "tenant-1" },
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ brand_id: "brand-1", model_id: "model-1" }),
      );
      expect(createVariant).toHaveBeenCalledWith(
        expect.objectContaining({
          size_id: "size-1",
          unit_cost_cents: cost ?? 0,
          unit_cost_recorded: recorded,
        }),
      );
      expect(
        (service as unknown as { repo: Record<string, unknown> }).repo,
      ).not.toHaveProperty("linkProductTag");
    },
  );
});
