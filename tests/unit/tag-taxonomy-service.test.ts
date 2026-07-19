import { TagTaxonomyService } from "@/services/tag-taxonomy-service";

const mockCreateBrand = jest.fn();
const mockCreateAlias = jest.fn();
const mockGetCandidateById = jest.fn();
const mockAcceptCandidate = jest.fn();

jest.mock("@/repositories/tag-taxonomy-repo", () => ({
  TagTaxonomyRepository: jest.fn().mockImplementation(() => ({
    createBrand: mockCreateBrand,
    createAlias: mockCreateAlias,
    getCandidateById: mockGetCandidateById,
    acceptCandidate: mockAcceptCandidate,
  })),
}));

describe("TagTaxonomyService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("trims canonical labels and retains only active state", async () => {
    mockCreateBrand.mockResolvedValue({ id: "brand-1" });
    const service = new TagTaxonomyService({} as never);

    await service.createBrand({
      tenantId: "tenant-1",
      canonicalLabel: "  Nike  ",
    });

    expect(mockCreateBrand).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      canonical_label: "Nike",
      is_active: true,
    });
  });

  it("normalizes aliases before persistence", async () => {
    const service = new TagTaxonomyService({} as never);
    await service.createAlias({
      tenantId: "tenant-1",
      entityType: "brand",
      brandId: "brand-1",
      aliasLabel: "  Air-Jordan  ",
    });

    expect(mockCreateAlias).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: "brand-1",
        alias_label: "Air-Jordan",
        alias_normalized: "air jordan",
      }),
    );
  });

  it("delegates candidate acceptance to the transactional RPC", async () => {
    mockGetCandidateById.mockResolvedValue({ id: "candidate-1", raw_text: "Jordn" });
    const service = new TagTaxonomyService({} as never);

    await service.acceptCandidate({ id: "candidate-1", canonicalLabel: "Jordan" });

    expect(mockAcceptCandidate).toHaveBeenCalledWith("candidate-1", "Jordan");
  });
});
