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
jest.mock(
  "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims",
  () => ({
    ...jest.requireActual(
      "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims",
    ),
    listSpecialtyClaims: jest.fn(),
    updateSpecialtyClaimStatus: jest.fn(),
    setSpecialtyCampaignEnabled: jest.fn(),
    getSpecialtyCampaignState: jest.fn(),
  }),
);
import { AuthError, requireAdminApi } from "@/lib/auth/session";
import {
  listSpecialtyClaims,
  updateSpecialtyClaimStatus,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageClaims/admin-claims";
import { GET } from "@/app/api/admin/specialty/claims/route";
import { PATCH } from "@/app/api/admin/specialty/claims/[claimId]/route";
import { PATCH as campaignPatch } from "@/app/api/admin/specialty/campaign/route";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAdminApi).mockResolvedValue({ user: { id } } as never);
});
test.each([401, 403])(
  "customer/anonymous cannot access staff claim records (%s)",
  async (status) => {
    jest.mocked(requireAdminApi).mockRejectedValue(new AuthError("Denied", status));
    const response = await GET(
      new Request("https://example.com/api/admin/specialty/claims"),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(listSpecialtyClaims).not.toHaveBeenCalled();
    expect(
      (
        await campaignPatch(
          new Request("https://example.com", { method: "PATCH", body: "{}" }),
        )
      ).status,
    ).toBe(status);
  },
);
test("stale staff status changes return 409 without SQL/provider details", async () => {
  jest.mocked(updateSpecialtyClaimStatus).mockRejectedValue({ code: "conflict" });
  const response = await PATCH(
    new Request("https://example.com", {
      method: "PATCH",
      body: JSON.stringify({ status: "contacted", expectedRevision: 1 }),
    }),
    { params: Promise.resolve({ claimId: id }) },
  );
  expect(response.status).toBe(409);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});
test("successful staff list defaults to a private 25-record page", async () => {
  jest.mocked(listSpecialtyClaims).mockResolvedValue({ claims: [], total: 0 });
  const response = await GET(
    new Request("https://example.com/api/admin/specialty/claims"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ claims: [], total: 0 });
  expect(listSpecialtyClaims).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
});
