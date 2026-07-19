import { ProductTitleParserService } from "@/services/product-title-parser-service";

const mockListBrands = jest.fn();
const mockListBrandAliases = jest.fn();
const mockListModels = jest.fn();
const mockListModelAliasesAll = jest.fn();

jest.mock("@/repositories/tag-taxonomy-repo", () => ({
  TagTaxonomyRepository: jest.fn().mockImplementation(() => ({
    listBrands: mockListBrands,
    listBrandAliases: mockListBrandAliases,
    listModels: mockListModels,
    listModelAliasesAll: mockListModelAliasesAll,
  })),
}));

describe("ProductTitleParserService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockListBrands.mockResolvedValue([
      {
        id: "brand-nike",
        canonical_label: "Nike",
        is_active: true,
      },
    ]);
    mockListBrandAliases.mockResolvedValue([]);
    mockListModels.mockResolvedValue([
      {
        id: "model-jordan-3",
        canonical_label: "Jordan 3",
        brand_id: "brand-nike",
      },
    ]);
    mockListModelAliasesAll.mockResolvedValue([]);
  });

  it("reuses taxonomy lookups across multiple parses for the same tenant", async () => {
    const service = new ProductTitleParserService({} as never);

    const result = await service.parseTitle({
      titleRaw: "Nike Jordan 3 White Cement",
      category: "sneakers",
      tenantId: "tenant-1",
    });
    await service.parseTitle({
      titleRaw: "Nike Jordan 3 Black Cement",
      category: "sneakers",
      tenantId: "tenant-1",
    });

    expect(mockListBrands).toHaveBeenCalledTimes(1);
    expect(mockListBrandAliases).toHaveBeenCalledTimes(1);
    expect(mockListModels).toHaveBeenCalledTimes(1);
    expect(mockListModelAliasesAll).toHaveBeenCalledTimes(1);
    expect(result.brand).toEqual(
      expect.objectContaining({ id: "brand-nike", label: "Nike", source: "taxonomy" }),
    );
    expect(result.brand).not.toHaveProperty("groupKey");
    expect(result.brand).not.toHaveProperty("isVerified");
  });
});
