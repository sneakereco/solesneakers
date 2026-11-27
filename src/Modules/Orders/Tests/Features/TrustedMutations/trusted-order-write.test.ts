import { POST as resend } from "@/app/api/admin/orders/[orderId]/resend-email/route";
import { OrderEmailService } from "@/services/order-email-service";
import type { NextRequest } from "next/server";
import { POST as fulfill } from "@/app/api/admin/orders/[orderId]/fulfill/route";
import { POST as pickup } from "@/app/api/admin/orders/[orderId]/pickup/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";

jest.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("@/services/order-email-service");
jest.mock("@/lib/utils/log", () => ({ logError: jest.fn() }));

const orderId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const rpc = jest.fn();

function authenticate(role: string | null) {
  const row = {
    id: userId,
    role,
    email: "fixture@example.invalid",
    full_name: null,
    tenant_id: null,
  };
  const session = {
    auth: {
      getUser: () => Promise.resolve({ data: { user: role ? { id: userId } : null } }),
    },
    from: (table: string) => {
      if (table !== "profiles") throw new Error("Session client cannot write orders");
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }),
        }),
      };
    },
  };
  jest.mocked(createSupabaseServerClient).mockResolvedValue(session as never);
}

function request() {
  return new Request("https://example.invalid/", {
    method: "POST",
    body: JSON.stringify({}),
  }) as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
});

describe.each([
  ["fulfill", fulfill],
  ["pickup", pickup],
] as const)("%s", (action, post) => {
  it.each([
    [null, 401],
    ["customer", 403],
  ] as const)(
    "returns the auth status for %s before opening service access",
    async (role, status) => {
      authenticate(role);
      const result = await post(request(), { params: Promise.resolve({ orderId }) });
      expect(result.status).toBe(status);
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    },
  );
  it.each(["admin", "super_admin", "dev"])(
    "uses the verified %s identity and trusted operation",
    async (role) => {
      authenticate(role);
      const order = {
        id: orderId,
        fulfillment_status: action === "pickup" ? "picked_up" : "shipped",
      };
      rpc.mockReturnValue({
        maybeSingle: () => Promise.resolve({ data: order, error: null }),
      });
      const result = await post(request(), { params: Promise.resolve({ orderId }) });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual(
        action === "fulfill" ? { order } : { success: true },
      );
      expect(rpc).toHaveBeenCalledWith("write_staff_order_fulfillment", {
        p_order_id: orderId,
        p_action: action,
        p_actor_id: userId,
        p_carrier: undefined,
        p_tracking_number: undefined,
      });
    },
  );
});

it.each(["pickup_instructions", "order_confirmation"] as const)(
  "resends %s using persisted recipient and order amounts",
  async (emailType) => {
    authenticate("admin");
    const detail = {
      id: orderId,
      user_id: userId,
      fulfillment: emailType === "order_confirmation" ? "ship" : "pickup",
      shipping: 8.25,
      subtotal: 25,
      tax_amount: 2,
      total: 35.25,
      profiles: { email: "fixture@example.invalid" },
      items: [],
    };
    const from = jest.fn().mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: detail }) }),
      }),
    });
    jest.mocked(createSupabaseAdminClient).mockReturnValue({ from } as never);
    const payload = new Request("https://example.invalid/", {
      method: "POST",
      body: JSON.stringify({ emailType }),
    }) as NextRequest;
    const response = await resend(payload, { params: Promise.resolve({ orderId }) });
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("orders");
    const email = jest.mocked(OrderEmailService).mock.instances[0];
    if (emailType === "pickup_instructions") {
      expect(email.sendPickupInstructions).toHaveBeenCalledWith({
        to: "fixture@example.invalid",
        orderId,
      });
    } else {
      expect(email.sendOrderConfirmationFromDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "fixture@example.invalid",
          order: expect.objectContaining({
            orderId,
            fulfillment: "ship",
            shipping: 8.25,
            total: 35.25,
          }),
        }),
      );
    }
  },
);
