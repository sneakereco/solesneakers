import { GET } from "@/app/api/admin/transactions/[orderId]/route";
import { cookies } from "next/headers";
import { verifyAdminSessionToken } from "@/lib/http/admin-session";
import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/http/admin-session", () => ({ verifyAdminSessionToken: jest.fn() }));
jest.mock("@/lib/auth/session", () => ({ requireAdminApi: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

const order = {
  id: "scoped-order",
  user_id: "customer",
  items: [
    { id: "old", variant: { id: "v1" } },
    { id: "zero", variant: { id: "v2" } },
    { id: "unknown", variant: { id: "v3" } },
  ],
};
const request = () =>
  GET(new Request("https://shop.test/transaction") as never, {
    params: Promise.resolve({ orderId: order.id }),
  });
function setup(visible: boolean, verified: boolean) {
  jest.clearAllMocks();
  jest.mocked(requireAdminApi).mockResolvedValue({ user: { id: "staff" } } as never);
  jest.mocked(cookies).mockResolvedValue({
    get: () => (verified ? { value: "cookie" } : undefined),
  } as never);
  jest.mocked(verifyAdminSessionToken).mockResolvedValue({ sub: "staff" } as never);
  const captured: string[] = [];
  const costs: Record<string, unknown[]> = {
    order_items: [
      { id: "old", unit_cost: 9.87 },
      { id: "zero", unit_cost: 0 },
      { id: "unknown", unit_cost: null },
    ],
    product_variants: [
      { id: "v1", unit_cost_cents: 1234, unit_cost_recorded: true },
      { id: "v2", unit_cost_cents: 0, unit_cost_recorded: true },
      { id: "v3", unit_cost_cents: 0, unit_cost_recorded: false },
    ],
  };
  const sessionFrom = jest.fn((table: string) => ({
    select: (projection: string) => {
      if (table === "orders") {
        captured.push(projection);
        expect(projection).not.toMatch(/unit_cost/);
        return {
          eq: (name: string, id: string) => {
            expect([name, id]).toEqual(["id", order.id]);
            return {
              maybeSingle: () =>
                Promise.resolve({ data: visible ? order : null, error: null }),
            };
          },
        };
      }
      if (table !== "email_audit_log") throw Error("Unexpected session read");
      return { eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
  }));
  const privilegedFrom = jest.fn((table: string) => ({
    select: (projection: string) => {
      if (table === "order_items" || table === "product_variants")
        return {
          in: (key: string, ids: string[]) => {
            expect(key).toBe("id");
            expect(ids).toEqual(
              table === "order_items" ? ["old", "zero", "unknown"] : ["v1", "v2", "v3"],
            );
            return Promise.resolve({ data: costs[table], error: null });
          },
        };
      if (table === "orders")
        expect(projection).not.toMatch(/order_items|unit_cost|product_variants/);
      return {
        eq: (key: string, id: string) => {
          expect(id).toBe(order.id);
          expect(key).toBe(table === "orders" ? "id" : "order_id");
          return {
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  profiles: { email: "customer@example.test", full_name: "Customer" },
                  shipping_address: null,
                },
                error: null,
              }),
            order: () => Promise.resolve({ data: [], error: null }),
          };
        },
      };
    },
  }));
  jest.mocked(createSupabaseServerClient).mockResolvedValue({
    from: sessionFrom,
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "staff" } }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () =>
          Promise.resolve({ data: { currentLevel: "aal2", nextLevel: "aal2" } }),
      },
    },
  } as never);
  jest
    .mocked(createSupabaseAdminClient)
    .mockReturnValue({ from: privilegedFrom } as never);
  return { captured, privilegedFrom };
}
it("returns 404 before privileged reads when RLS does not return the requested order", async () => {
  setup(false, true);
  expect((await request()).status).toBe(404);
  expect(createSupabaseAdminClient).not.toHaveBeenCalled();
});
it("denies cost enrichment without the subject's signed cookie", async () => {
  setup(true, false);
  expect((await request()).status).toBeGreaterThanOrEqual(400);
  expect(createSupabaseAdminClient).not.toHaveBeenCalled();
});
it("uses scope-resolved line and variant IDs, including distinct historical, zero and unknown costs", async () => {
  const { captured } = setup(true, true);
  const response = await request();
  expect(response.status).toBe(200);
  expect(captured).toHaveLength(1);
  const result = await response.json();
  expect(result.order.items).toEqual([
    { id: "old", unit_cost: 9.87, variant: { id: "v1", unit_cost_cents: 1234 } },
    { id: "zero", unit_cost: 0, variant: { id: "v2", unit_cost_cents: 0 } },
    { id: "unknown", unit_cost: null, variant: { id: "v3", unit_cost_cents: null } },
  ]);
  expect(result.customer.email).toBe("customer@example.test");
});
