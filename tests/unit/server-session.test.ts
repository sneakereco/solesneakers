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

import { readServerSession, getServerSession } from "@/lib/auth/session";
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

  it.each(["auth", "profile"])(
    "ends a held %s lookup as unavailable",
    async (boundary) => {
      jest.useFakeTimers();
      try {
        const held = new Promise<never>(() => {});
        const identity = { data: { user: { id: "fixture" } }, error: null };
        mockCreateSupabaseServerClient.mockResolvedValue({
          auth: {
            getUser: () => (boundary === "auth" ? held : Promise.resolve(identity)),
          },
        } as never);
        mockProfileRepository.mockImplementation(
          () => ({ getByUserId: () => held }) as never,
        );
        let result = "pending";
        void readServerSession().then(
          () => {
            result = "resolved";
          },
          (error) => {
            result = error.name;
          },
        );
        await jest.advanceTimersByTimeAsync(15_000);
        expect(result).toBe("TimeoutError");
      } finally {
        jest.useRealTimers();
      }
    },
  );

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
