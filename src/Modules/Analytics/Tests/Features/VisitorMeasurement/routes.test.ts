import { NextRequest } from "next/server";
import { validEnv, identitySecret } from "../Configuration/config-fixture";
import { createBuyerKey } from "@/Modules/Analytics/Source/Features/CommerceFacts/buyer-key";
import { resolveCheckoutSourceContext } from "@/Modules/Analytics/Source/Features/CommerceFacts/source-context";
import { GET, POST } from "@/app/api/analytics/preferences/route";
import { GET as identity } from "@/app/api/analytics/identity/route";

const id = "123e4567-e89b-42d3-a456-426614174000";
const sessionId = "123e4567-e89b-42d3-a456-426614174001";
const email = "guest@example.com";
const totals = {
  subtotalCents: 2500,
  shippingCents: 250,
  taxCents: 310,
  totalCents: 3060,
};
const commerceKey = createBuyerKey({ normalizedEmail: email }, identitySecret);
const checkoutTracking = (visitorId: string) => ({
  receiptId: id,
  visitorId,
  sessionId,
  device: "desktop",
  discovery: null,
  purchaseSession: null,
});
const mockGetDataset = jest.fn();
const mockActive = jest.fn();
const mockRevoke = jest.fn();
const mockProfile = jest.fn();
let mockCookie: string | undefined;
jest.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({ get: () => (mockCookie ? { value: mockCookie } : undefined) }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: () => ({}),
}));
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({}),
}));
jest.mock("@/services/auth-service", () => ({
  AuthService: class {
    getCurrentUserProfile() {
      return mockProfile();
    }
  },
}));
jest.mock("@/Modules/Analytics/Source/Features/CommerceFacts/repository", () => ({
  ...jest.requireActual("@/Modules/Analytics/Source/Features/CommerceFacts/repository"),
  createFactRepository: () => ({
    getDataset: mockGetDataset,
    issueReceipt: () => Promise.resolve({ receiptId: id }),
    isReceiptActive: mockActive,
    revokeReceipt: mockRevoke,
  }),
}));
const originalEnv = process.env;
const origin = "https://soles-stg.vercel.app";
function post(body: unknown, source = origin) {
  return POST(
    new NextRequest(origin + "/api/analytics/preferences", {
      method: "POST",
      headers: { origin: source, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
function getIdentity(search = "") {
  return identity(new NextRequest(origin + "/api/analytics/identity" + search));
}
beforeEach(() => {
  process.env = { ...originalEnv, ...validEnv };
  mockCookie = undefined;
  jest.clearAllMocks();
  mockGetDataset.mockResolvedValue({
    datasetId: "sole-staging",
    schemaVersion: 2,
    environment: "staging",
    activatedAt: "2020-01-01T00:00:00Z",
  });
  mockActive.mockResolvedValue(true);
  mockRevoke.mockResolvedValue(true);
});
afterEach(() => {
  process.env = originalEnv;
});
it("binds the preference cookie to the activated server-selected dataset and revokes it before acknowledgment", async () => {
  const accepted = await post({ choice: "accepted" });
  expect(await accepted.json()).toEqual({ choice: "accepted", receiptId: id });
  expect(mockGetDataset).toHaveBeenCalledWith("sole-staging");
  expect(accepted.headers.get("set-cookie")).toMatch(/httponly/i);
  mockCookie = id;
  mockRevoke.mockRejectedValueOnce(new Error("offline"));
  expect((await post({ choice: "declined" })).status).toBe(503);
  const declined = await post({ choice: "declined" });
  expect(await declined.json()).toEqual({ choice: "declined" });
  expect(mockRevoke).toHaveBeenCalledWith("sole-staging", id);
  mockActive.mockResolvedValue(false);
  expect(
    await (await GET(new NextRequest(origin + "/api/analytics/preferences"))).json(),
  ).toEqual({ choice: "unknown" });
});
it("requires matching origin, exact body and an activated dataset", async () => {
  expect(await post({ choice: "accepted" }, "https://external.example")).toHaveProperty(
    "status",
    403,
  );
  expect((await post({ choice: "accepted", datasetId: "sole-production" })).status).toBe(
    400,
  );
  mockGetDataset.mockResolvedValueOnce({
    datasetId: "sole-staging",
    schemaVersion: 2,
    environment: "staging",
    activatedAt: "2099-01-01T00:00:00Z",
  });
  expect((await post({ choice: "accepted" })).status).toBe(503);
});
it("resolves only the consenting verified customer and never takes contact from the request", async () => {
  expect((await getIdentity()).status).toBe(403);
  expect(mockProfile).not.toHaveBeenCalled();
  mockCookie = id;
  mockProfile.mockResolvedValue({
    user: { email: "guest@example.com", email_confirmed_at: null },
    profile: { role: "customer" },
  });
  expect((await getIdentity()).status).toBe(403);
  mockProfile.mockResolvedValue({
    user: { email: "guest@example.com", email_confirmed_at: "2026-01-01" },
    profile: { role: "customer" },
  });
  expect((await getIdentity("?email=another%40example.com")).status).toBe(400);
  const result = await getIdentity();
  const { buyerKey: visitorId } = await result.json();
  expect(visitorId).toMatch(/^sole-buyer:v1:[a-f0-9]{64}$/);
  expect(visitorId).not.toBe(commerceKey);
  expect(result.headers.get("cache-control")).toContain("private");
  await expect(
    resolveCheckoutSourceContext(email, totals, checkoutTracking(visitorId)),
  ).resolves.toMatchObject({
    buyerKey: commerceKey,
    tracking: checkoutTracking(visitorId),
  });
  await expect(
    resolveCheckoutSourceContext(email, totals, checkoutTracking(commerceKey)),
  ).resolves.toMatchObject({ buyerKey: commerceKey, tracking: null });
  mockActive.mockResolvedValue(false);
  await expect(
    resolveCheckoutSourceContext(email, totals, checkoutTracking(visitorId)),
  ).resolves.toMatchObject({ buyerKey: commerceKey, tracking: null });
  mockActive.mockResolvedValue(true);
  mockProfile.mockResolvedValue({
    user: { email: "staff@example.com", email_confirmed_at: "2026-01-01" },
    profile: { role: "admin" },
  });
  expect((await getIdentity()).status).toBe(403);
});
it("keeps the commerce buyer key without optional measurement configuration", async () => {
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "false";
  delete process.env.POSTHOG_QUERY_API_KEY;
  mockCookie = id;
  await expect(
    resolveCheckoutSourceContext(email, totals, checkoutTracking(sessionId)),
  ).resolves.toEqual({
    datasetId: "sole-staging",
    buyerKey: commerceKey,
    totals,
    tracking: null,
  });
  expect(mockActive).not.toHaveBeenCalled();
});
it.each(["", "too-short", validEnv.NEXT_PUBLIC_POSTHOG_PROJECT_KEY])(
  "omits the commerce buyer key when the identity secret is invalid",
  async (secret) => {
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED = "false";
    process.env.ANALYTICS_IDENTITY_SECRET = secret;
    await expect(
      resolveCheckoutSourceContext(email, totals, null),
    ).resolves.toMatchObject({
      buyerKey: null,
      tracking: null,
    });
  },
);
it("refuses to issue production-linked grants or return identity on a preview host", async () => {
  const preview = "https://sole-preview.vercel.app";
  const grant = await POST(
    new NextRequest(preview + "/api/analytics/preferences", {
      method: "POST",
      headers: { origin: preview },
      body: JSON.stringify({ choice: "accepted" }),
    }),
  );
  expect(grant.status).toBe(403);
  mockCookie = id;
  expect(
    (await identity(new NextRequest(preview + "/api/analytics/identity"))).status,
  ).toBe(403);
  expect(mockGetDataset).not.toHaveBeenCalled();
});
