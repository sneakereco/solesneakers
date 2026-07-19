import { TagTaxonomyRepository } from "@/repositories/tag-taxonomy-repo";

describe("TagTaxonomyRepository", () => {
  it("writes brands to the tag namespace", async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: "brand-1", canonical_label: "Nike" },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    const from = jest.fn(() => ({ insert }));
    const repository = new TagTaxonomyRepository({ from } as never);

    await repository.createBrand({ canonical_label: "Nike", tenant_id: null });

    expect(from).toHaveBeenCalledWith("tag_brands");
    expect(insert).toHaveBeenCalledWith({ canonical_label: "Nike", tenant_id: null });
  });

  it("accepts candidates through the renamed RPC", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: { targetId: "brand-1" }, error: null });
    const repository = new TagTaxonomyRepository({ rpc } as never);

    await repository.acceptCandidate("candidate-1", "Nike");

    expect(rpc).toHaveBeenCalledWith("accept_tag_candidate", {
      candidate_id: "candidate-1",
      accepted_label: "Nike",
    });
  });
});
