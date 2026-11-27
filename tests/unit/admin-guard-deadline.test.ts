import { NextRequest } from "next/server";
import { protectAdminRoute } from "@/proxy/auth";
import { ProfileRepository } from "@/repositories/profile-repo";
jest.mock("@/repositories/profile-repo");
jest.mock("@/lib/http/admin-session", () => ({ verifyAdminSessionToken: jest.fn() }));
it("exits an unavailable admin profile read without revealing protected content or changing the session", async () => {
  jest.useFakeTimers();
  try {
    const signOut = jest.fn();
    const client = {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "staff" } } }),
        signOut,
      },
    };
    jest
      .mocked(ProfileRepository)
      .mockImplementation(() => ({ getByUserId: () => new Promise(() => {}) }) as never);
    const request = new NextRequest("http://localhost/admin/dashboard");
    let result: Response | null | undefined;
    void protectAdminRoute(request, "fixture", client as never).then((value) => {
      result = value;
    });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(result?.status).toBe(503);
    expect(signOut).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it("keeps a temporarily unavailable staff identity recoverable when the provider fails promptly", async () => {
  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: null },
          error: { status: 503, message: "Unavailable" },
        }),
      signOut: jest.fn(),
    },
  };
  const response = await protectAdminRoute(
    new NextRequest("http://localhost/admin/dashboard"),
    "fixture",
    client as never,
  );
  expect(response?.status).toBe(503);
  expect(client.auth.signOut).not.toHaveBeenCalled();
});
