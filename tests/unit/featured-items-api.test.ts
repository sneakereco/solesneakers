const getFeaturedItemsMock = jest.fn();

jest.mock("@/lib/auth/session", () => ({
  AuthError: class AuthError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  requireAdminApi: jest.fn(),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

jest.mock("@/services/featured-items-service", () => ({
  FeaturedItemsService: jest.fn().mockImplementation(() => ({
    getFeaturedItems: getFeaturedItemsMock,
  })),
}));

jest.mock("@/lib/utils/log", () => ({
  logError: jest.fn(),
}));

import { AuthError, requireAdminApi } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import { FeaturedItemsService } from "@/services/featured-items-service";

import { GET } from "../../app/api/admin/featured-items/route";

const mockRequireAdminApi = jest.mocked(requireAdminApi);
const mockCreateSupabaseAdminClient = jest.mocked(createSupabaseAdminClient);
const mockFeaturedItemsService = jest.mocked(FeaturedItemsService);

describe("featured items admin api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdminApi.mockResolvedValue({
      user: { id: "user-1", email: "admin@example.com" },
      profile: null,
      role: "admin",
    } as never);
    mockCreateSupabaseAdminClient.mockReturnValue({ from: jest.fn() } as never);
    getFeaturedItemsMock.mockResolvedValue([]);
  });

  it("uses the privileged server client after admin authorization", async () => {
    const response = await GET();

    expect(mockRequireAdminApi).toHaveBeenCalledTimes(1);
    expect(mockCreateSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(mockFeaturedItemsService).toHaveBeenCalledWith(
      mockCreateSupabaseAdminClient.mock.results[0]?.value,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [], count: 0 });
  });

  it("never creates the privileged client for an unauthorized request", async () => {
    mockRequireAdminApi.mockRejectedValue(new AuthError("Forbidden", 403));

    const response = await GET();

    expect(mockCreateSupabaseAdminClient).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
