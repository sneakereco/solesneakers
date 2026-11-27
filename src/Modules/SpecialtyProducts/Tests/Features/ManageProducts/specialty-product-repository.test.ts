import { SpecialtyProductRepository } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-repository";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
};
const productId = "33333333-3333-4333-8333-333333333333";
const input = {
  mode: "create" as const,
  name: "Cash prize",
  description: null,
  quantity: 1,
  images: [],
  goLiveAt: "2026-01-01T00:00:00Z",
  instructions: null,
};
test("writes one atomic prize RPC with trusted actor and server campaign configuration", async () => {
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { productId, revision: 1 }, error: null });
  const repository = new SpecialtyProductRepository(
    { rpc } as unknown as AdminSupabaseClient,
    "black-friday-2026",
  );
  await expect(repository.save(input, actor)).resolves.toEqual({
    productId,
    revision: 1,
  });
  expect(rpc).toHaveBeenCalledWith("save_specialty_product", {
    p_product_id: null,
    p_input: { ...input, campaignSlug: "black-friday-2026" },
    p_actor_id: actor.userId,
    p_compatibility_tenant_id: actor.tenantId,
  });
});
test("rejects malformed quantity before writing any prize", async () => {
  const rpc = jest.fn();
  const repository = new SpecialtyProductRepository({
    rpc,
  } as unknown as AdminSupabaseClient);
  await expect(repository.save({ ...input, quantity: -1 }, actor)).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
test("rejects malformed RPC results and maps revision conflicts without exposing SQL details", async () => {
  const rpc = jest.fn().mockResolvedValue({
    data: null,
    error: {
      message: "specialty_revision_conflict",
      code: "P0001",
      details: "private",
    },
  });
  const repository = new SpecialtyProductRepository({
    rpc,
  } as unknown as AdminSupabaseClient);
  await expect(repository.save(input, actor)).rejects.toMatchObject({
    code: "revision_conflict",
  });
  rpc.mockResolvedValue({ data: { productId }, error: null });
  await expect(repository.save(input, actor)).rejects.toMatchObject({
    code: "unavailable",
  });
});
