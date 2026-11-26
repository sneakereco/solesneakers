import { NextRequest } from "next/server";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { GET as identity } from "@/app/api/analytics/identity/route";
import { GET as session } from "@/app/api/auth/session/route";
import { getServerSession } from "@/lib/auth/session";
import { AuthService } from "@/services/auth-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validEnv } from "../Configuration/config-fixture";

const mockGetUser = jest.fn();
const mockProfile = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mockProfile, single: mockProfile }) }),
      }),
    }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: () => ({}),
}));
jest.mock(
  "@/Modules/Analytics/Source/Features/VisitorMeasurement/server-consent",
  () => ({
    privateHeaders: { "Cache-Control": "private, no-store" },
    acceptsMeasurementHost: () => true,
    readServerConsent: () =>
      Promise.resolve({
        choice: "accepted",
        receiptId: "123e4567-e89b-42d3-a456-426614174000",
      }),
  }),
);
jest.mock("@/lib/utils/log", () => ({ logError: jest.fn() }));
const request = new NextRequest("https://soles-stg.vercel.app/api/analytics/identity");
const user = {
  id: "verified-fixture",
  email: "shopper@example.com",
  email_confirmed_at: "2026-01-01",
};
const env = process.env;
beforeEach(() => {
  process.env = { ...env, ...validEnv };
  jest.clearAllMocks();
  mockProfile.mockResolvedValue({ data: { ...user, role: "customer" }, error: null });
});
afterEach(() => {
  process.env = env;
});
it("preserves a retryable Supabase getUser result through the actual AuthService and identity route", async () => {
  mockGetUser
    .mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError("fixture outage", 503),
    })
    .mockResolvedValueOnce({ data: { user }, error: null });
  const down = await identity(request);
  expect(down.status).toBe(503);
  expect(await down.json()).toBeNull();
  expect(mockProfile).not.toHaveBeenCalled();
  const recovered = await identity(request);
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({
    buyerKey: expect.stringMatching(/^sole-buyer:v1:[a-f0-9]{64}$/),
  });
});
it("marks the real session endpoint unavailable on retryable auth or profile failure and returns the same account on recovery", async () => {
  mockGetUser
    .mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError("fixture outage", 503),
    })
    .mockResolvedValue({ data: { user }, error: null });
  expect((await session(request)).status).toBe(503);
  mockProfile.mockResolvedValueOnce({
    data: null,
    error: new Error("database unavailable"),
  });
  expect((await session(request)).status).toBe(503);
  const recovered = await session(request);
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toEqual({
    user: { id: user.id, email: user.email },
    role: "customer",
  });
});
it.each([
  new AuthApiError("Invalid API key", 401, undefined),
  new AuthApiError("Forbidden", 403, undefined),
  new AuthApiError("Unexpected failure", 403, "unexpected_failure"),
])(
  "reports indeterminate gateway rejection as unavailable through both routes: %s",
  async (error) => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error });
    const [identityResponse, sessionResponse] = await Promise.all([
      identity(request),
      session(request),
    ]);
    expect([identityResponse.status, sessionResponse.status]).toEqual([503, 503]);
    expect(mockProfile).not.toHaveBeenCalled();
  },
);
it.each([
  new AuthSessionMissingError(),
  new AuthApiError("invalid token", 401, "bad_jwt"),
  new AuthApiError("account banned", 403, "user_banned"),
  new AuthApiError("account removed", 404, "user_not_found"),
])("retains definitive guest/denied semantics for %s", async (error) => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error });
  expect((await identity(request)).status).toBe(403);
  const guest = await session(request);
  expect(guest.status).toBe(200);
  expect(await guest.json()).toEqual({ user: null, role: null });
});
it("preserves legacy lookup semantics for authorization and existing recovery callers", async () => {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: new AuthRetryableFetchError("outage", 503),
  });
  expect(await getServerSession()).toBeNull();
  expect(
    await new AuthService(await createSupabaseServerClient()).getCurrentUserProfile(),
  ).toEqual({ user: null, profile: null });
});
