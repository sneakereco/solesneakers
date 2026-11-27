jest.mock("@/lib/supabase/session-refresh", () => ({ refreshSession: jest.fn() }));
jest.mock("@/proxy/auth", () => ({ protectAdminRoute: jest.fn() }));
jest.mock("@/proxy/site-lock", () => ({
  checkSiteLock: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/proxy/csrf", () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock("@/proxy/canonicalize", () => ({ canonicalizePath: jest.fn(() => null) }));
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import { refreshSession } from "@/lib/supabase/session-refresh";
import { checkCsrf } from "@/proxy/csrf";
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(refreshSession).mockRejectedValue(new Error("Auth unavailable"));
  jest.mocked(checkCsrf).mockReturnValue(null);
});
test.each([
  "/api/specialty/eligibility",
  "/api/specialty/claims",
  "/api/specialty/claims/result",
])(
  "account-independent %s claims do not depend on Auth refresh but retain CSRF",
  async (path) => {
    const response = await proxy(
      new NextRequest("http://localhost" + path, { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(checkCsrf).toHaveBeenCalledTimes(1);
    jest
      .mocked(checkCsrf)
      .mockReturnValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
    expect(
      (await proxy(new NextRequest("http://localhost" + path, { method: "POST" })))
        .status,
    ).toBe(403);
  },
);
test.each([
  ["/api/specialty/claims", "GET"],
  ["/api/specialty/claims/other", "POST"],
  ["/api/admin/specialty/claims", "POST"],
])("unrelated %s %s retains session processing", async (path, method) => {
  await expect(
    proxy(new NextRequest("http://localhost" + path, { method })),
  ).rejects.toThrow("Auth unavailable");
});
