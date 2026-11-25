import { NextRequest } from "next/server";

import { POST } from "@/app/api/account/shipping/route";
import { requireAccountSession } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ShippingService } from "@/services/shipping-service";

jest.mock("@/lib/account/session");
jest.mock("@/lib/supabase/server");
jest.mock("@/services/shipping-service");
jest.mock("@/lib/utils/log");

const owner = "account-current";
const id = "3fd71135-d895-4d08-a964-56bdebedd2dc";
const saved = {
  id,
  user_id: owner,
  name: "  Saved Customer  ",
  phone: null,
  line1: "1 Test Street",
  line2: "Suite 4",
  city: "Charleston",
  state: "SC",
  postal_code: "29401",
  country: "US",
};
const snapshot = {
  savedAddressId: id,
  full_name: "Saved Customer",
  phone: null,
  address_line1: "1 Test Street",
  address_line2: "Suite 4",
  city: "Charleston",
  state: "SC",
  postal_code: "29401",
  country: "US",
};

const upsertProfile = jest.fn();
const query = {
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(),
};
const from = jest.fn();

function request(body: object, bound = true) {
  return new NextRequest("https://shop.example.test/api/account/shipping", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bound ? { "X-Account-Owner": owner } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAccountSession).mockResolvedValue({
    user: { id: owner, email: "customer@example.test" },
    profile: null,
    role: "customer",
  });
  from.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: saved, error: null });
  jest.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  jest.mocked(ShippingService).mockImplementation(() => ({ upsertProfile }) as never);
  upsertProfile.mockResolvedValue({ address_line1: saved.line1 });
});

it("checks the saved row for the authenticated owner and writes canonical details when it matches", async () => {
  const response = await POST(request(snapshot));
  expect(response.status).toBe(200);
  expect(from).toHaveBeenCalledWith("user_addresses");
  expect(query.eq).toHaveBeenCalledWith("user_id", owner);
  expect(query.eq).toHaveBeenCalledWith("id", id);
  expect(upsertProfile).toHaveBeenCalledTimes(1);
  expect(upsertProfile).toHaveBeenCalledWith({
    user_id: owner,
    tenant_id: null,
    full_name: saved.name,
    phone: null,
    address_line1: saved.line1,
    address_line2: saved.line2,
    city: saved.city,
    state: saved.state,
    postal_code: saved.postal_code,
    country: saved.country,
    updated_at: expect.any(String),
  });
});

it.each([
  ["changed", { ...saved, line2: "Suite 20" }],
  ["recipient changed", { ...saved, name: "Updated Customer" }],
  ["missing", null],
  ["other owner", { ...saved, user_id: "other-account" }],
] as const)("rejects a %s saved row before any default write", async (_label, row) => {
  query.maybeSingle.mockResolvedValue({ data: row, error: null });
  const response = await POST(request(snapshot));
  expect(response.status).toBe(412);
  expect(await response.json()).toMatchObject({ code: "saved_address_changed" });
  expect(upsertProfile).not.toHaveBeenCalled();
});

it("requires the complete snapshot when a saved address ID is present", async () => {
  const response = await POST(
    request({ savedAddressId: id, address_line1: saved.line1 }),
  );
  expect(response.status).toBe(400);
  expect(query.maybeSingle).not.toHaveBeenCalled();
  expect(upsertProfile).not.toHaveBeenCalled();
});

it.each([
  [
    "custom shipping details",
    { address_line1: "  Other Street  " },
    { address_line1: "Other Street" },
  ],
  ["clear", { address_line1: null }, { address_line1: null }],
] as const)(
  "leaves the headerless %s write contract intact",
  async (_label, input, expected) => {
    const response = await POST(request(input, false));
    expect(response.status).toBe(200);
    expect(query.maybeSingle).not.toHaveBeenCalled();
    expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining(expected));
  },
);
