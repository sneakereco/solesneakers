jest.mock("@/lib/store-access/get-store-access-settings", () => ({
  getStoreAccessSettings: jest.fn(),
}));
jest.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock("@/services/auth-service", () => ({ AuthService: jest.fn() }));
jest.mock("@/lib/utils/log", () => ({ logError: jest.fn() }));
jest.mock("next/navigation", () => ({
  redirect: jest.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

import { NextRequest } from "next/server";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthService } from "@/services/auth-service";
import { POST } from "@/app/api/auth/register/route";
import RegisterPage from "@/app/auth/register/page";

const signUp = jest.fn();
const getAccess = jest.mocked(getStoreAccessSettings);
beforeEach(() => {
  jest.clearAllMocks();
  getAccess.mockResolvedValue({
    tenantId: "store-1",
    isSiteLocked: false,
    settings: {
      siteLockEnabled: false,
      siteUnlockAt: null,
      checkoutLockEnabled: false,
      checkoutLockMessage: "Paused",
    },
  });
  jest.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  } as never);
  jest.mocked(AuthService).mockImplementation(() => ({ signUp }) as never);
  signUp.mockResolvedValue(undefined);
});
const request = () =>
  new NextRequest("https://store.test/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "customer@example.com",
      password: "SecurePassword123!",
    }),
  });

it("rejects a signup opened before locking without calling Auth", async () => {
  getAccess.mockResolvedValue({
    tenantId: "store-1",
    isSiteLocked: true,
    settings: {
      siteLockEnabled: true,
      siteUnlockAt: null,
      checkoutLockEnabled: false,
      checkoutLockMessage: "Paused",
    },
  });
  const response = await POST(request());
  expect(response.status).toBe(423);
  expect(getAccess).toHaveBeenCalledWith({ fresh: true });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(signUp).not.toHaveBeenCalled();
});
it.each(["missing", "failure"])(
  "fails closed when lock settings are %s",
  async (mode) => {
    if (mode === "missing") getAccess.mockResolvedValue(null);
    else getAccess.mockRejectedValue(new Error("settings unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(signUp).not.toHaveBeenCalled();
  },
);
it("preserves signup when the effective lock is off", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(signUp).toHaveBeenCalledWith("customer@example.com", "SecurePassword123!");
});
it("redirects the signup page to the locked storefront", async () => {
  getAccess.mockResolvedValue({
    tenantId: "store-1",
    isSiteLocked: true,
    settings: {
      siteLockEnabled: true,
      siteUnlockAt: null,
      checkoutLockEnabled: false,
      checkoutLockMessage: "Paused",
    },
  });
  await expect(RegisterPage()).rejects.toThrow("redirect:/locked");
});
