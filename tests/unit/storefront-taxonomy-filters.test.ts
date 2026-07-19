import { StorefrontService } from "@/services/storefront-service";

const mockListFilterData = jest.fn();
const mockListAvailableSizes = jest.fn();
const mockListAvailableConditions = jest.fn();
const mockListCanonicalSearchProductIds = jest.fn();
const mockList = jest.fn();

jest.mock("@/repositories/product-repo", () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({
    listFilterData: mockListFilterData,
    listAvailableSizes: mockListAvailableSizes,
    listAvailableConditions: mockListAvailableConditions,
    listCanonicalSearchProductIds: mockListCanonicalSearchProductIds,
    list: mockList,
  })),
}));

describe("storefront taxonomy filters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListFilterData.mockResolvedValue([
      {
        brandId: "brand-1",
        brand: "Nike",
        modelId: "model-1",
        model: "Dunk",
        category: "sneakers",
      },
    ]);
    mockListAvailableSizes.mockResolvedValue({
      shoe: [{ id: "size-1", label: "9M / 10.5W" }],
      clothing: [],
      shoeCounts: { "size-1": 2 },
      clothingCounts: {},
    });
    mockListAvailableConditions.mockResolvedValue(["new"]);
    mockListCanonicalSearchProductIds.mockResolvedValue(["product-1"]);
    mockList.mockResolvedValue({ products: [], total: 0 });
  });

  it("exposes IDs as values and labels only for presentation", async () => {
    const service = new StorefrontService({} as never);
    const result = await service.listFilters({
      filters: { brandIds: ["brand-1"], sizeIds: ["size-1"] },
    });

    expect(result.brands).toEqual([{ id: "brand-1", label: "Nike" }]);
    expect(result.models).toEqual([{ id: "model-1", label: "Dunk", brandId: "brand-1" }]);
    expect(result.availableShoeSizes).toEqual([{ id: "size-1", label: "9M / 10.5W" }]);
    expect(mockListAvailableSizes).toHaveBeenCalledWith(
      expect.objectContaining({ brandIds: ["brand-1"], sizeIds: [] }),
    );
  });

  it("resolves storefront searches through canonical taxonomy labels", async () => {
    const service = new StorefrontService({} as never);

    await service.listProducts({ q: "Nike" });

    expect(mockListCanonicalSearchProductIds).toHaveBeenCalledWith("Nike", undefined);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ q: "Nike", matchingProductIds: ["product-1"] }),
    );
  });
});
