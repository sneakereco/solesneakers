jest.mock("@/lib/auth/session", () => ({ requireAdminApi: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
import { createClient } from "@supabase/supabase-js";
import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import {
  listSpecialtyClaims,
  updateSpecialtyClaimStatus,
  setSpecialtyCampaignEnabled,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims";
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  product_id: id,
  product_name: "Cash prize",
  product_image_url: null,
  instagram_handle: "sole.user",
  eligibility_address: {
    line1: "123 MAIN ST",
    line2: null,
    city: "COLUMBIA",
    state: "SC",
    postalCode: "29201",
    country: "US",
  },
  instructions: "Contact us",
  accepted_at: "2026-11-25T18:00:00Z",
  decision_ordinal: 1,
  follow_up_status: "new",
  revision: 1,
  updated_by: null,
  updated_at: "2026-11-25T18:00:00Z",
  address_key: "private-key",
  instagram_key: "private-ig-key",
};
const urls: URL[] = [];
let rpcError: string | null = null;
beforeEach(() => {
  jest.clearAllMocks();
  urls.length = 0;
  rpcError = null;
  jest
    .mocked(requireAdminApi)
    .mockResolvedValue({ user: { id }, role: "admin" } as never);
  const client = createClient("https://example.supabase.co", "test", {
    global: {
      fetch: (input) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname.includes("/rpc/"))
          return Promise.resolve(
            rpcError
              ? Response.json({ message: rpcError }, { status: 400 })
              : Response.json({
                  ...row,
                  follow_up_status: "contacted",
                  revision: 2,
                  updated_by: id,
                }),
          );
        if (url.pathname.endsWith("specialty_campaigns"))
          return Promise.resolve(
            Response.json({
              id,
              enabled: false,
              revision: 1,
              identity_key_fingerprint: null,
            }),
          );
        return Promise.resolve(
          Response.json([row], { headers: { "content-range": "25-25/26" } }),
        );
      },
    },
  });
  jest.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
});
test("paginates successful claims and strips identity HMACs from private admin DTOs", async () => {
  const result = await listSpecialtyClaims({
    page: 2,
    pageSize: 25,
    status: "new",
    productId: id,
  });
  expect(result.total).toBe(26);
  expect(result.claims[0]).toMatchObject({
    claimId: id,
    instagramHandle: "sole.user",
    address: row.eligibility_address,
    updatedBy: null,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private-key|private-ig-key|address_key|instagram_key/,
  );
  const url = urls.find((item) => item.pathname.endsWith("specialty_claims"))!;
  expect(url.searchParams.get("offset")).toBe("25");
  expect(url.searchParams.get("limit")).toBe("25");
  expect(url.searchParams.get("follow_up_status")).toBe("eq.new");
});
test("exported operations reject missing admin authorization before service-role reads", async () => {
  jest.mocked(requireAdminApi).mockRejectedValue(new Error("forbidden"));
  await expect(listSpecialtyClaims({ page: 1, pageSize: 25 })).rejects.toThrow();
  expect(createSupabaseAdminClient).not.toHaveBeenCalled();
});
test("refuses oversized pages and actor spoofing", async () => {
  await expect(listSpecialtyClaims({ page: 1, pageSize: 101 })).rejects.toThrow();
  await expect(
    updateSpecialtyClaimStatus(
      { claimId: id, status: "contacted", expectedRevision: 1 },
      "22222222-2222-4222-8222-222222222222",
    ),
  ).rejects.toThrow();
});
test("status updates map only safe snapshots and report a stale revision conflict", async () => {
  const result = await updateSpecialtyClaimStatus(
    { claimId: id, status: "contacted", expectedRevision: 1 },
    id,
  );
  expect(result).toMatchObject({
    status: "contacted",
    revision: 2,
    updatedBy: id,
    instructions: "Contact us",
  });
  rpcError = "specialty_revision_conflict";
  await expect(
    updateSpecialtyClaimStatus(
      { claimId: id, status: "fulfilled", expectedRevision: 1 },
      id,
    ),
  ).rejects.toMatchObject({ code: "conflict" });
});
test("campaign close remains available without an eligibility signing key", async () => {
  const client = jest.mocked(createSupabaseAdminClient)();
  const rpc = jest
    .spyOn(client, "rpc")
    .mockResolvedValue({ data: { enabled: false, revision: 2 }, error: null } as never);
  expect(
    await setSpecialtyCampaignEnabled({ enabled: false, expectedRevision: 1 }, id),
  ).toEqual({ enabled: false, revision: 2 });
  expect(rpc.mock.calls[0][0]).toBe("set_specialty_campaign_enabled");
});
