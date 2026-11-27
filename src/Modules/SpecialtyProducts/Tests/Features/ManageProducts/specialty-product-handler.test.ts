jest.mock("@/lib/auth/session", () => ({
  requireAdminApi: jest.fn(),
  AuthError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("@/lib/auth/tenant", () => ({ ensureTenantId: jest.fn() }));
jest.mock("next/cache", () => ({ revalidateTag: jest.fn() }));
import { requireAdminApi, AuthError } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { ensureTenantId } from "@/lib/auth/tenant";
import { saveSpecialtyProductHandler } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-handler";
const id = "11111111-1111-4111-8111-111111111111";
const input = {
  mode: "create",
  name: "Cash prize",
  quantity: 1,
  description: null,
  images: [],
  instructions: null,
  goLiveAt: "2026-11-25T12:00:00Z",
};
const request = (body: unknown = input) =>
  new Request("https://example.com/api/admin/specialty/products", {
    method: "POST",
    body: JSON.stringify(body),
  });
const rpc = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(requireAdminApi)
    .mockResolvedValue({ user: { id }, role: "admin" } as never);
  jest.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  jest.mocked(ensureTenantId).mockResolvedValue(id);
  rpc.mockResolvedValue({ data: { productId: id, revision: 1 }, error: null });
});
test.each([401, 403])("authenticates before privileged writes (%s)", async (status) => {
  jest.mocked(requireAdminApi).mockRejectedValue(new AuthError("Denied", status));
  const response = await saveSpecialtyProductHandler(request(), null);
  expect(response.status).toBe(status);
  expect(createSupabaseAdminClient).not.toHaveBeenCalled();
});
test("creates a brand-free prize with zero payment configuration", async () => {
  const response = await saveSpecialtyProductHandler(request(), null);
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ productId: id, revision: 1 });
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});
test("rejects mode/URL mismatches and unnecessary ordinary checkout fields", async () => {
  for (const [body, productId] of [
    [{ ...input, shipping: true }, null],
    [input, id],
    [{ ...input, mode: "update", productId: id, expectedRevision: 1 }, null],
  ] as const) {
    expect((await saveSpecialtyProductHandler(request(body), productId)).status).toBe(
      422,
    );
  }
});
test.each(["specialty_revision_conflict", "specialty_stock_locked_after_claim"])(
  "stale inventory returns conflict without exposing SQL (%s)",
  async (message) => {
    rpc.mockResolvedValue({ error: { message }, data: null });
    const response = await saveSpecialtyProductHandler(
      request({ ...input, mode: "update", productId: id, expectedRevision: 1 }),
      id,
    );
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain(message);
  },
);
