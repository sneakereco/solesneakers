import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import { createSupabaseProxyClient } from "@/lib/supabase/proxy";
import { refreshSession } from "@/lib/supabase/session-refresh";
import { verifyAdminSessionToken } from "@/lib/http/admin-session";

jest.mock("@/lib/supabase/proxy", () => ({ createSupabaseProxyClient: jest.fn() }));
jest.mock("@/lib/supabase/session-refresh", () => ({ refreshSession: jest.fn() }));
jest.mock("@/proxy/site-lock", () => ({
  checkSiteLock: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/proxy/rate-limit", () => ({
  applyRateLimit: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/repositories/profile-repo", () => ({
  ProfileRepository: class {
    getByUserId() {
      return Promise.resolve({ role: "admin" });
    }
  },
}));
jest.mock("@/lib/http/admin-session", () => ({ verifyAdminSessionToken: jest.fn() }));
jest.mock("@/lib/utils/log", () => ({ log: jest.fn() }));
test.each(["/api/admin/analytics/payments", "/api/admin/analytics/products/export"])(
  "protects %s with the inherited admin cookie and MFA",
  async (path) => {
    jest.mocked(refreshSession).mockResolvedValue(NextResponse.next());
    jest.mocked(verifyAdminSessionToken).mockResolvedValue({ sub: "staff" } as never);
    const aal = jest
      .fn()
      .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" } });
    jest.mocked(createSupabaseProxyClient).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: "staff" } } }),
        signOut: async () => {},
        mfa: { getAuthenticatorAssuranceLevel: aal },
      },
    } as never);
    const url = "http://localhost" + path;
    const missing = await proxy(new NextRequest(url));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    const req = new NextRequest(url, { headers: { cookie: "admin_session=test" } });
    const mfa = await proxy(req);
    expect(mfa.status).toBe(403);
    expect(mfa.headers.get("Cache-Control")).toBe("private, no-store");
    aal.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" } });
    expect((await proxy(req)).headers.get("x-middleware-next")).toBe("1");
  },
);
