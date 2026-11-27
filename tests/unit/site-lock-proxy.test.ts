jest.mock("@/lib/supabase/proxy", () => ({
  createSupabaseProxyClient: jest.fn(),
}));

jest.mock("@/lib/store-access/get-store-access-settings", () => ({
  getStoreAccessSettings: jest.fn(),
}));

jest.mock("@/repositories/profile-repo", () => ({
  ProfileRepository: jest.fn(),
}));

jest.mock("@/lib/http/admin-session", () => ({
  verifyAdminSessionToken: jest.fn(),
}));

import { NextRequest } from "next/server";

import { createSupabaseProxyClient } from "@/lib/supabase/proxy";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { logError } from "@/lib/utils/log";
import { ProfileRepository } from "@/repositories/profile-repo";
import { verifyAdminSessionToken } from "@/lib/http/admin-session";
import { checkSiteLock } from "@/proxy/site-lock";

const mockCreateSupabaseProxyClient = jest.mocked(createSupabaseProxyClient);
const mockGetStoreAccessSettings = jest.mocked(getStoreAccessSettings);
const mockProfileRepository = jest.mocked(ProfileRepository);
const mockVerifyAdminSessionToken = jest.mocked(verifyAdminSessionToken);
jest.mock("@/lib/utils/log", () => ({
  logError: jest.fn(),
}));
const mockLogError = jest.mocked(logError);

describe("checkSiteLock", () => {
  const mockGetFirstTenantId = jest.fn();
  const mockGetSettings = jest.fn();
  const mockIsSiteLocked = jest.fn();
  const mockGetProfileByUserId = jest.fn();
  const mockGetUser = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSupabaseProxyClient.mockReturnValue({
      auth: {
        getUser: mockGetUser,
      },
    } as never);
    mockGetStoreAccessSettings.mockImplementation(async () => {
      const tenantId = await mockGetFirstTenantId();
      if (!tenantId) return null;
      const settings = await mockGetSettings();
      return { tenantId, settings, isSiteLocked: mockIsSiteLocked(settings) };
    });
    mockProfileRepository.mockImplementation(
      () =>
        ({
          getByUserId: mockGetProfileByUserId,
        }) as never,
    );
    mockGetFirstTenantId.mockResolvedValue("tenant-1");
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mockGetProfileByUserId.mockResolvedValue(null);
    mockVerifyAdminSessionToken.mockResolvedValue(null);
  });

  it("never puts exact signed webhooks or the authenticated cron behind the site lock", async () => {
    for (const pathname of [
      "/api/webhooks/square",
      "/api/webhooks/shippo",
      "/api/cron/expire-checkouts",
      "/api/cron/checkout-notifications",
      "/api/cron/checkout-health",
      "/api/cron/analytics",
      "/api/healthz",
      "/api/readyz",
    ]) {
      const request = new NextRequest(`http://localhost${pathname}`);
      await expect(checkSiteLock(request, `req-${pathname}`)).resolves.toBeNull();
    }

    expect(mockGetFirstTenantId).not.toHaveBeenCalled();
  });

  it("checks auth, staff and lock-page exemptions before reading store settings", async () => {
    for (const path of [
      "/api/auth/logout",
      "/auth/login",
      "/admin/dashboard",
      "/api/admin/profile",
      "/locked",
      "/images/logo.png",
    ]) {
      await expect(
        checkSiteLock(new NextRequest("http://localhost" + path), "fixture"),
      ).resolves.toBeNull();
    }
    expect(mockGetFirstTenantId).not.toHaveBeenCalled();
  });

  it("returns a recoverable unavailable response when the site lock cannot settle", async () => {
    jest.useFakeTimers();
    try {
      mockGetFirstTenantId.mockReturnValueOnce(new Promise(() => {}));
      let result: Response | null | undefined;
      void checkSiteLock(new NextRequest("http://localhost/store"), "fixture").then(
        (value) => {
          result = value;
        },
      );
      await jest.advanceTimersByTimeAsync(15000);
      expect(result?.status).toBe(503);
      expect(result?.headers.get("Retry-After")).toBe("1");
      expect(await result?.text()).toContain("store access");
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops waiting for a stalled staff bypass after a confirmed lock", async () => {
    jest.useFakeTimers();
    try {
      mockGetSettings.mockResolvedValueOnce({
        siteLockEnabled: true,
        siteUnlockAt: null,
      });
      mockIsSiteLocked.mockReturnValueOnce(true);
      mockGetUser.mockReturnValueOnce(new Promise(() => {}));
      let result: Response | null | undefined;
      void checkSiteLock(new NextRequest("http://localhost/store"), "fixture").then(
        (value) => {
          result = value;
        },
      );
      await jest.advanceTimersByTimeAsync(15000);
      expect(result?.status).toBe(503);
      expect(mockGetProfileByUserId).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not lock when persisted settings disable site lock", async () => {
    mockGetSettings.mockResolvedValue({
      siteLockEnabled: false,
      siteUnlockAt: null,
      checkoutLockEnabled: false,
      checkoutLockMessage: "",
    });
    mockIsSiteLocked.mockReturnValue(false);

    const request = new NextRequest("http://localhost/store", {
      headers: { accept: "text/html" },
    });

    await expect(checkSiteLock(request, "req-1")).resolves.toBeNull();
  });

  it("redirects html navigation to /locked when persisted settings say the site is locked", async () => {
    mockGetSettings.mockResolvedValue({
      siteLockEnabled: true,
      siteUnlockAt: "2099-01-01T00:00:00.000Z",
      checkoutLockEnabled: false,
      checkoutLockMessage: "",
    });
    mockIsSiteLocked.mockReturnValue(true);

    const request = new NextRequest("http://localhost/store?brandIds=brand-1", {
      headers: { accept: "text/html" },
    });

    const response = await checkSiteLock(request, "req-2");

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toContain("/locked");
    expect(response?.headers.get("location")).toContain(
      encodeURIComponent("/store?brandIds=brand-1"),
    );
  });

  it("redirects Next.js client navigation to /locked when the site is locked", async () => {
    mockGetSettings.mockResolvedValue({
      siteLockEnabled: true,
      siteUnlockAt: "2099-01-01T00:00:00.000Z",
      checkoutLockEnabled: false,
      checkoutLockMessage: "",
    });
    mockIsSiteLocked.mockReturnValue(true);

    const request = new NextRequest("http://localhost/store?brandIds=brand-1&_rsc=abc", {
      headers: {
        accept: "text/x-component",
        rsc: "1",
      },
    });

    const response = await checkSiteLock(request, "req-rsc");
    const location = response?.headers.get("location") ?? "";

    expect(response?.status).toBe(307);
    expect(location).toContain("/locked");
    expect(location).toContain(encodeURIComponent("/store?brandIds=brand-1"));
    expect(location).not.toContain(encodeURIComponent("_rsc=abc"));
  });

  it("allows signed-in admins through when the site is locked", async () => {
    mockGetSettings.mockResolvedValue({
      siteLockEnabled: true,
      siteUnlockAt: "2099-01-01T00:00:00.000Z",
      checkoutLockEnabled: false,
      checkoutLockMessage: "",
    });
    mockIsSiteLocked.mockReturnValue(true);
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockGetProfileByUserId.mockResolvedValue({
      role: "admin",
    });

    const request = new NextRequest("http://localhost/store", {
      headers: { accept: "text/html" },
    });

    await expect(checkSiteLock(request, "req-admin")).resolves.toBeNull();
  });

  it("fails open when lock settings lookup throws", async () => {
    mockGetSettings.mockRejectedValue(
      new Error("relation tenant_store_access_settings does not exist"),
    );

    const request = new NextRequest("http://localhost/", {
      headers: { accept: "text/html" },
    });

    await expect(checkSiteLock(request, "req-3")).resolves.toBeNull();
    expect(mockLogError).toHaveBeenCalled();
  });
  it("delegates only exact specialty POST site checks to their fail-closed handler", async () => {
    mockIsSiteLocked.mockReturnValue(true);
    mockGetSettings.mockResolvedValue({ siteUnlockAt: "2099-01-01T00:00:00.000Z" });
    for (const path of ["/api/specialty/claims", "/api/specialty/eligibility"]) {
      expect(
        await checkSiteLock(
          new NextRequest("http://localhost" + path, { method: "POST" }),
          "claim",
        ),
      ).toBeNull();
    }
    expect(mockGetFirstTenantId).not.toHaveBeenCalled();
    expect(
      (
        await checkSiteLock(
          new NextRequest("http://localhost/api/specialty/claims/other", {
            method: "POST",
          }),
          "other",
        )
      )?.status,
    ).toBe(423);
  });
});
