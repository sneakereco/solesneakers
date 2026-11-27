import { cookies } from "next/headers";
import { requireAdminApi } from "@/lib/auth/session";
import { verifyAdminSessionToken } from "@/lib/http/admin-session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { createStaffCostReader } from "@/repositories/staff-cost-reader";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/auth/session", () => ({ requireAdminApi: jest.fn() }));
jest.mock("@/lib/http/admin-session", () => ({ verifyAdminSessionToken: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

it.each(["customer", "missing cookie", "different user", "pending MFA"])(
  "denies private enrichment for %s",
  async (reason) => {
    jest.clearAllMocks();
    if (reason === "customer")
      jest.mocked(requireAdminApi).mockRejectedValue(new Error("Forbidden"));
    else
      jest.mocked(requireAdminApi).mockResolvedValue({ user: { id: "staff" } } as never);
    jest.mocked(cookies).mockResolvedValue({
      get: () => (reason === "missing cookie" ? undefined : { value: "signed" }),
    } as never);
    jest.mocked(verifyAdminSessionToken).mockResolvedValue({
      sub: reason === "different user" ? "other" : "staff",
    } as never);
    const mfa = {
      getAuthenticatorAssuranceLevel: () =>
        Promise.resolve({
          data: { nextLevel: "aal2", currentLevel: "aal1" },
          error: null,
        }),
    };
    await expect(
      createStaffCostReader({
        auth: { mfa },
        from: () => ({
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [{ id: "variant", unit_cost_cents: 25, unit_cost_recorded: true }],
                error: null,
              }),
          }),
        }),
      } as never).variants(["variant"]),
    ).rejects.toThrow();
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  },
);
