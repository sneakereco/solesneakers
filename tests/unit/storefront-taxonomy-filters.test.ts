import { StorefrontService } from "@/services/storefront-service";

const mockListFilterData = jest.fn();
const mockListAvailableSizes = jest.fn();
const mockListAvailableConditions = jest.fn();
const mockListCanonicalSearchProductIds = jest.fn();
const mockList = jest.fn();
const mockGetById = jest.fn();

jest.mock("@/repositories/product-repo", () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({
    listFilterData: mockListFilterData,
    listAvailableSizes: mockListAvailableSizes,
    listAvailableConditions: mockListAvailableConditions,
    listCanonicalSearchProductIds: mockListCanonicalSearchProductIds,
    list: mockList,
    getById: mockGetById,
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

  it("omits cost and its provenance from public list and detail JSON", async () => {
    const product = {
      id: "product-1",
      variants: [
        {
          id: "v1",
          sale_price_cents: 100,
          stock: 1,
          unit_cost_cents: 42,
          unit_cost_recorded: true,
        },
      ],
    };
    mockList.mockResolvedValue({ products: [product], total: 1 });
    mockGetById.mockResolvedValue(product);
    const service = new StorefrontService({} as never);
    const list = await service.listProducts({});
    const detail = await service.getProductById(product.id);
    const expected = { id: "v1", sale_price_cents: 100, stock: 1 };
    expect(list.products[0].variants[0]).toEqual(expected);
    expect(detail?.variants[0]).toEqual(expected);
    expect(product.variants[0].unit_cost_cents).toBe(42);
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
