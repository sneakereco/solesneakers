import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

import { AdminAuthService } from "@/services/admin-auth-service";
import type { Database } from "@/types/db/database.types";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "staff@example.invalid",
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
  factors: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      factor_type: "totp",
      status: "verified",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ],
};

function createClient(aal: "aal1" | "aal2", rejectUser = false) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: user.id, aal, amr: [] }),
    encode("fixture-signature"),
  ].join(".");
  return createServerClient<Database>("https://fixture.supabase.co", "fixture-key", {
    cookies: {
      getAll: () => [
        {
          name: "sb-fixture-auth-token",
          value: JSON.stringify({
            access_token: accessToken,
            refresh_token: "fixture-refresh-token",
            token_type: "bearer",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            user,
          }),
        },
      ],
      setAll() {},
    },
    global: {
      fetch: (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/auth/v1/user") {
          return Promise.resolve(
            Response.json(
              rejectUser ? { code: "bad_jwt", message: "Invalid JWT" } : user,
              { status: rejectUser ? 401 : 200 },
            ),
          );
        }
        if (url.pathname === "/rest/v1/profiles") {
          return Promise.resolve(
            Response.json({ ...user, role: "admin", tenant_id: "tenant-1" }),
          );
        }
        throw new Error(`Unexpected Supabase request: ${url.pathname}`);
      },
    },
  });
}

describe("server-side Supabase MFA warnings", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    ["aal1", true],
    ["aal2", false],
  ] as const)(
    "checks verified admin MFA at %s without warning about an unverified user",
    async (aal, requiresTwoFAChallenge) => {
      const client = createClient(aal);
      try {
        const service = new AdminAuthService(client);
        await expect(service.requireAdminUser()).resolves.toEqual({ userId: user.id });
        await expect(service.getMfaRequirements()).resolves.toEqual({
          requiresTwoFASetup: false,
          requiresTwoFAChallenge,
        });
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringContaining("Using the user object as returned"),
        );
      } finally {
        await client.auth.stopAutoRefresh();
      }
    },
  );

  it("rejects a cookie user when the Auth server rejects the token", async () => {
    const client = createClient("aal1", true);
    try {
      await expect(new AdminAuthService(client).requireAdminUser()).rejects.toThrow(
        "AUTH_ERROR",
      );
    } finally {
      await client.auth.stopAutoRefresh();
    }
  });

  it("still warns when a caller reads an unverified cookie user", async () => {
    const client = createClient("aal1");
    try {
      const { data } = await client.auth.getSession();
      expect(data.session?.user.id).toBe(user.id);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Using the user object as returned"),
      );
    } finally {
      await client.auth.stopAutoRefresh();
    }
  });
});
