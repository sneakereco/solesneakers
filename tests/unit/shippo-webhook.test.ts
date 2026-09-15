import { NextRequest } from "next/server";

import { env } from "@/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";

import { POST } from "../../src/app/api/webhooks/shippo/route";

jest.mock("@/lib/supabase/service-role");
jest.mock("@/lib/utils/log", () => ({ log: jest.fn(), logError: jest.fn() }));

const rpc = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  rpc.mockResolvedValue({ data: { matched: true, queued: true }, error: null });
});

function request(status: string, token = env.SHIPPO_WEBHOOK_TOKEN) {
  return new NextRequest(`https://example.com/api/webhooks/shippo?token=${token}`, {
    method: "POST",
    body: JSON.stringify({
      event: "track_updated",
      data: {
        tracking_number: "tracking-1",
        tracking_status: { status },
        carrier: "usps",
      },
    }),
  });
}

it.each(["TRANSIT", "DELIVERED"])(
  "durably processes %s even on repeated callbacks",
  async (status) => {
    expect((await POST(request(status))).status).toBe(200);
    expect((await POST(request(status))).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("record_shippo_tracking_update", {
      p_tracking_number: "tracking-1",
      p_status: status === "TRANSIT" ? "shipped" : "delivered",
      p_carrier: "usps",
      p_tracking_url: null,
    });
  },
);

it("does not acknowledge a failed database write", async () => {
  rpc.mockResolvedValue({ data: null, error: new Error("database unavailable") });
  expect((await POST(request("DELIVERED"))).status).toBe(500);
});

it("rejects unauthenticated callbacks before storing notifications", async () => {
  expect((await POST(request("TRANSIT", "wrong"))).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});

it("ignores pre-transit without queuing a shipment email", async () => {
  expect((await POST(request("PRE_TRANSIT"))).status).toBe(200);
  expect(rpc).not.toHaveBeenCalled();
});
