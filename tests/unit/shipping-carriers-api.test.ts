jest.mock("@/lib/auth/session", () => ({
  requireAdminApi: jest.fn(),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

jest.mock("@/repositories/shipping-carriers-repo", () => ({
  ShippingCarriersRepository: jest.fn(),
}));

import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { ShippingCarriersRepository } from "@/repositories/shipping-carriers-repo";

import { GET, POST } from "../../app/api/admin/shipping/carriers/route";

const mockRequireAdminApi = jest.mocked(requireAdminApi);
const mockCreateSupabaseAdminClient = jest.mocked(createSupabaseAdminClient);
const mockRepository = jest.mocked(ShippingCarriersRepository);

const get = jest.fn();
const upsert = jest.fn();

describe("/api/admin/shipping/carriers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdminApi.mockResolvedValue({ role: "admin" } as never);
    mockCreateSupabaseAdminClient.mockReturnValue({} as never);
    mockRepository.mockImplementation(() => ({ get, upsert }) as never);
  });

  it("normalizes legacy stored carrier values on GET", async () => {
    get.mockResolvedValue({ enabled_carriers: ["FedEx", "DHL", "UPS"] });

    const response = await GET(
      new Request("https://shop.example.com/api/admin/shipping/carriers") as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ carriers: ["UPS", "FEDEX"] });
  });

  it("saves submitted carriers in canonical stable order", async () => {
    upsert.mockResolvedValue({ enabled_carriers: ["UPS", "FEDEX"] });

    const response = await POST(
      new Request("https://shop.example.com/api/admin/shipping/carriers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ carriers: ["fedex", "UPS", "UPS"] }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(["UPS", "FEDEX"]);
    await expect(response.json()).resolves.toEqual({ carriers: ["UPS", "FEDEX"] });
  });

  it("rejects an unsupported carrier without saving", async () => {
    const response = await POST(
      new Request("https://shop.example.com/api/admin/shipping/carriers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ carriers: ["DHL"] }),
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
