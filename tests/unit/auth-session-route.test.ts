import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { NextRequest } from "next/server";

import { DELETE as deleteAddress } from "@/app/api/account/addresses/[addressId]/route";
import {
  GET as getAddresses,
  POST as postAddress,
} from "@/app/api/account/addresses/route";
import { GET as getOrders } from "@/app/api/account/orders/route";
import { POST as postPassword } from "@/app/api/account/password/route";
import {
  GET as getShippingProfile,
  POST as postShippingProfile,
} from "@/app/api/account/shipping/route";
import { GET } from "@/app/api/auth/session/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileRepository } from "@/repositories/profile-repo";
import { OrdersService } from "@/services/orders-service";

jest.mock("@/lib/supabase/server");
jest.mock("@/repositories/profile-repo");
jest.mock("@/lib/utils/log");
jest.mock("@/services/orders-service");
jest.mock("@/services/shipping-service");
jest.mock("@/lib/email/mailer");

const getUser = jest.fn();
const getByUserId = jest.fn();
const sessionRequest = new Request("https://shop.example.test/api/auth/session");

beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(createSupabaseServerClient)
    .mockResolvedValue({ auth: { getUser } } as never);
  jest.mocked(ProfileRepository).mockImplementation(() => ({ getByUserId }) as never);
});

it.each([
  new AuthSessionMissingError(),
  new AuthApiError("Invalid token", 401, "bad_jwt"),
])("returns confirmed signed out for %p", async (error) => {
  getUser.mockResolvedValue({ data: { user: null }, error });
  const response = await GET(sessionRequest);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ user: null, role: null });
});

it.each([
  new AuthRetryableFetchError("Authentication temporarily unavailable", 0),
  new AuthApiError("Too many requests", 429, "over_request_rate_limit"),
  new AuthApiError("Authentication unavailable", 503, "unexpected_failure"),
])("reports a provider failure as unavailable for %p", async (error) => {
  getUser.mockResolvedValue({ data: { user: null }, error });
  const response = await GET(sessionRequest);
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("user");
});

it("reports a profile lookup failure without returning a lesser role or guest", async () => {
  getUser.mockResolvedValue({
    data: { user: { id: "known-id", email: "known@example.test" } },
    error: null,
  });
  getByUserId.mockRejectedValue(new Error("Profile unavailable"));
  const response = await GET(sessionRequest);
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty("user");
});

it("returns a fresh confirmed identity and role", async () => {
  getUser.mockResolvedValue({
    data: { user: { id: "known-id", email: "known@example.test" } },
    error: null,
  });
  getByUserId.mockResolvedValue({ role: "admin" });
  const response = await GET(sessionRequest);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    user: { id: "known-id", email: "known@example.test" },
    role: "admin",
  });
});

it.each([
  ["addresses", getAddresses],
  ["orders", getOrders],
  ["shipping", getShippingProfile],
] as const)(
  "%s distinguishes unavailable from signed out before serving account data",
  async (resource, handler) => {
    const accountRequest = new NextRequest(
      `https://shop.example.test/api/account/${resource}`,
    );
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError("Provider unavailable", 0),
    });
    expect((await handler(accountRequest)).status).toBe(401);
    expect((await handler(accountRequest)).status).toBe(503);
  },
);

it.each([
  ["GET", "addresses", getAddresses],
  ["GET", "orders", getOrders],
  ["GET", "shipping", getShippingProfile],
  ["POST", "addresses", postAddress],
  ["POST", "shipping", postShippingProfile],
  ["POST", "password", postPassword],
  [
    "DELETE",
    "addresses/56c9919f-ec52-4d4d-a10f-6e17d3e09fb3",
    (request: NextRequest) =>
      deleteAddress(request, {
        params: Promise.resolve({ addressId: "56c9919f-ec52-4d4d-a10f-6e17d3e09fb3" }),
      }),
  ],
] as const)(
  "%s %s rejects a different expected owner before feature access",
  async (method, resource, handler) => {
    getUser.mockResolvedValue({
      data: { user: { id: "authenticated-account-b", email: "known@example.test" } },
      error: null,
    });
    getByUserId.mockResolvedValue({ role: "customer" });
    const response = await handler(
      new NextRequest(`https://shop.example.test/api/account/${resource}`, {
        method,
        headers: { "X-Account-Owner": "expected-account-a" },
      }),
    );
    expect(response.status).toBe(409);
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
  },
);

it("cannot use an expected owner header as authentication and does not collapse provider failure to 401", async () => {
  const request = new NextRequest("https://shop.example.test/api/account/shipping", {
    method: "POST",
    headers: { "X-Account-Owner": "expected-account" },
  });
  getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthSessionMissingError(),
  });
  getUser.mockResolvedValueOnce({
    data: { user: null },
    error: new AuthRetryableFetchError("Provider unavailable", 0),
  });
  expect((await postShippingProfile(request)).status).toBe(401);
  expect((await postShippingProfile(request)).status).toBe(503);
  expect(getByUserId).not.toHaveBeenCalled();
});

it.each([undefined, "account-a"])(
  "reads orders for the real session with expected owner %p",
  async (expected) => {
    const listOrdersForUser = jest.fn().mockResolvedValue([]);
    jest.mocked(OrdersService).mockImplementation(() => ({ listOrdersForUser }) as never);
    getUser.mockResolvedValue({
      data: { user: { id: "account-a", email: "known@example.test" } },
      error: null,
    });
    getByUserId.mockResolvedValue({ role: "customer" });
    const response = await getOrders(
      new NextRequest("https://shop.example.test/api/account/orders", {
        headers: expected ? { "X-Account-Owner": expected } : undefined,
      }),
    );
    expect(response.status).toBe(200);
    expect(listOrdersForUser).toHaveBeenCalledWith("account-a");
  },
);
