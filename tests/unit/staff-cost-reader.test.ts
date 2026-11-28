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

it.each([
  "customer",
  "missing cookie",
  "different user",
  "different Supabase user",
  "missing Supabase user",
  "auth unavailable",
  "pending MFA",
])("denies private enrichment for %s", async (reason) => {
  jest.clearAllMocks();
  if (reason === "customer")
    jest.mocked(requireAdminApi).mockRejectedValue(new Error("Forbidden"));
  else jest.mocked(requireAdminApi).mockResolvedValue({ user: { id: "staff" } } as never);
  jest.mocked(cookies).mockResolvedValue({
    get: () => (reason === "missing cookie" ? undefined : { value: "signed" }),
  } as never);
  jest.mocked(verifyAdminSessionToken).mockResolvedValue({
    sub: reason === "different user" ? "other" : "staff",
  } as never);
  jest.mocked(createSupabaseAdminClient).mockReturnValue({
    from: () => ({
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [{ id: "variant", unit_cost_cents: 25, unit_cost_recorded: true }],
            error: null,
          }),
      }),
    }),
  } as never);
  const mfa = {
    getAuthenticatorAssuranceLevel: () =>
      Promise.resolve({
        data: {
          nextLevel: "aal2",
          currentLevel: reason === "pending MFA" ? "aal1" : "aal2",
        },
        error: null,
      }),
  };
  await expect(
    createStaffCostReader({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: {
              user:
                reason === "missing Supabase user"
                  ? null
                  : { id: reason === "different Supabase user" ? "other" : "staff" },
            },
            error: reason === "auth unavailable" ? new Error("unavailable") : null,
          }),
        mfa,
      },
    } as never).variants(["variant"]),
  ).rejects.toThrow();
  expect(createSupabaseAdminClient).not.toHaveBeenCalled();
});

it("returns private costs after the same staff identity completes MFA", async () => {
  jest.clearAllMocks();
  jest.mocked(requireAdminApi).mockResolvedValue({ user: { id: "staff" } } as never);
  jest.mocked(cookies).mockResolvedValue({ get: () => ({ value: "signed" }) } as never);
  jest.mocked(verifyAdminSessionToken).mockResolvedValue({ sub: "staff" } as never);
  jest.mocked(createSupabaseAdminClient).mockReturnValue({
    from: () => ({
      select: () => ({
        in: () =>
          Promise.resolve({
            data: [{ id: "variant", unit_cost_cents: 25, unit_cost_recorded: true }],
            error: null,
          }),
      }),
    }),
  } as never);

  const reader = createStaffCostReader({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "staff" } }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () =>
          Promise.resolve({
            data: { nextLevel: "aal2", currentLevel: "aal2" },
            error: null,
          }),
      },
    },
  } as never);
  const costs = await reader.variants(["variant"]);
  expect(costs("variant")).toEqual({
    id: "variant",
    unit_cost_cents: 25,
    unit_cost_recorded: true,
  });
});
