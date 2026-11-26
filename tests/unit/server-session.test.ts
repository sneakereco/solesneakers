jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock("@/repositories/profile-repo", () => ({
  ProfileRepository: jest.fn(),
}));

jest.mock("@/lib/utils/log", () => ({
  logError: jest.fn(),
}));

import { DynamicServerError } from "next/dist/client/components/hooks-server-context";

import { getServerSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/log";
import { ProfileRepository } from "@/repositories/profile-repo";

const mockCreateSupabaseServerClient = jest.mocked(createSupabaseServerClient);
const mockProfileRepository = jest.mocked(ProfileRepository);
const mockLogError = jest.mocked(logError);

describe("getServerSession", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when supabase auth lookup throws", async () => {
    mockCreateSupabaseServerClient.mockRejectedValue(new Error("supabase unavailable"));

    await expect(getServerSession()).resolves.toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("returns null without logging when next raises a dynamic server error", async () => {
    mockCreateSupabaseServerClient.mockRejectedValue(
      new DynamicServerError(
        "Route /admin/dashboard couldn't be rendered statically because it used `cookies`.",
      ),
    );

    await expect(getServerSession()).resolves.toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("returns session data when auth lookup succeeds", async () => {
    const mockGetUser = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
      error: null,
    });
    const mockGetByUserId = jest.fn().mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "admin",
      full_name: "User One",
      tenant_id: "tenant-1",
    });

    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: mockGetUser,
      },
    } as never);
    mockProfileRepository.mockImplementation(
      () =>
        ({
          getByUserId: mockGetByUserId,
        }) as never,
    );

    await expect(getServerSession()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
      },
      profile: {
        id: "user-1",
        email: "user@example.com",
        role: "admin",
        full_name: "User One",
        tenant_id: "tenant-1",
      },
      role: "admin",
    });
  });
});

describe("session observation route", () => {
  it.each([
    [{ name: "AuthSessionMissingError", status: 400 }, 200],
    [{ code: "session_expired", status: 401 }, 200],
    [{ name: "AuthRetryableFetchError", status: 503 }, 503],
    [{ message: "transport failed" }, 503],
  ])("distinguishes signed out from upstream errors %j", async (error, status) => {
    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error }) },
    } as never);
    const { GET } = await import("@/app/api/auth/session/route");
    const response = await GET(new Request("https://fixture.invalid/api/auth/session"));
    expect(response.status).toBe(status);
    if (status === 200) expect(await response.json()).toEqual({ user: null, role: null });
    else expect(await response.text()).not.toContain("transport failed");
  });
});
