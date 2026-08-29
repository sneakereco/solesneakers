jest.mock("@/lib/auth/session", () => ({ requireAdminApi: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(),
}));
jest.mock("@/lib/auth/tenant", () => ({ ensureTenantId: jest.fn() }));
jest.mock("@/repositories/checkout-settings-repo", () => ({
  CheckoutSettingsRepository: jest.fn(),
}));

import { requireAdminApi } from "@/lib/auth/session";
import { ensureTenantId } from "@/lib/auth/tenant";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CheckoutSettingsRepository } from "@/repositories/checkout-settings-repo";

import { GET, POST } from "../../app/api/admin/checkout-settings/route";

const mockRequireAdminApi = jest.mocked(requireAdminApi);
const mockEnsureTenantId = jest.mocked(ensureTenantId);
const mockCreateSupabaseServerClient = jest.mocked(createSupabaseServerClient);
const mockRepository = jest.mocked(CheckoutSettingsRepository);

describe("/api/admin/checkout-settings", () => {
  const getByTenant = jest.fn();
  const upsert = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdminApi.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" },
      profile: null,
      role: "admin",
    } as never);
    mockCreateSupabaseServerClient.mockResolvedValue({} as never);
    mockEnsureTenantId.mockResolvedValue("tenant-1");
    mockRepository.mockImplementation(() => ({ getByTenant, upsert }) as never);
  });

  it("returns the persisted flat rate", async () => {
    getByTenant.mockResolvedValue({ flatShippingCents: 1295 });

    const response = await GET(
      new Request("https://shop.example.com/api/admin/checkout-settings"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      settings: { flatShippingCents: 1295 },
    });
  });

  it("rejects fractional cents", async () => {
    const response = await POST(
      new Request("https://shop.example.com/api/admin/checkout-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flatShippingCents: 12.5 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("persists a valid flat rate", async () => {
    upsert.mockResolvedValue({ flatShippingCents: 1500 });

    const response = await POST(
      new Request("https://shop.example.com/api/admin/checkout-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flatShippingCents: 1500 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith("tenant-1", 1500);
  });
});
