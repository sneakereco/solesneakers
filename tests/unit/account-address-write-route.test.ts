import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/account/addresses/route";
import { requireAccountSession } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AddressesRepository } from "@/repositories/addresses-repo";

jest.mock("@/lib/account/session");
jest.mock("@/lib/supabase/server");
jest.mock("@/repositories/addresses-repo");
jest.mock("@/lib/utils/log");

const userId = "account-current";
const address = {
  id: "address-1",
  user_id: userId,
  name: "Synthetic customer",
  line1: "1 Test Street",
  city: "Charleston",
  state: "SC",
  postal_code: "29401",
  country: "US",
};
const payload = {
  name: address.name,
  line1: address.line1,
  city: address.city,
  state: address.state,
  postal_code: address.postal_code,
  country: address.country,
};
const upsertUserAddress = jest.fn();
const listUserAddresses = jest.fn();
const headers = { "Content-Type": "application/json", "X-Account-Owner": userId };
const path = "https://shop.example.test/api/account/addresses";

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireAccountSession).mockResolvedValue({
    user: { id: userId, email: "customer@example.test" },
    profile: null,
    role: "customer",
  });
  jest.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
  jest.mocked(AddressesRepository).mockImplementation(
    () =>
      ({
        upsertUserAddress,
        listUserAddresses,
      }) as never,
  );
});

it("confirms a committed address even when its subsequent list read fails", async () => {
  upsertUserAddress.mockResolvedValue(address);
  listUserAddresses.mockRejectedValueOnce(new Error("Address list unavailable"));
  listUserAddresses.mockResolvedValueOnce([address]);

  const post = await POST(
    new NextRequest(path, { method: "POST", headers, body: JSON.stringify(payload) }),
  );
  expect(post.status).toBe(200);
  expect(await post.json()).toEqual({ address });
  expect(listUserAddresses).toHaveBeenCalledTimes(1);
  const getRequest = new NextRequest(path, { headers });
  const read = await GET(getRequest);
  expect(await read.json()).toEqual({ addresses: [address] });
  expect(requireAccountSession).toHaveBeenLastCalledWith(getRequest, "read");
  expect(upsertUserAddress).toHaveBeenCalledTimes(1);
});

it("keeps the successful headerless addresses response alongside the committed row", async () => {
  upsertUserAddress.mockResolvedValue(address);
  listUserAddresses.mockResolvedValue([address]);
  const response = await POST(
    new NextRequest(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ address, addresses: [address] });
});

it("acknowledges no committed row when the upsert itself fails", async () => {
  upsertUserAddress.mockRejectedValue(new Error("Write unavailable"));
  const response = await POST(
    new NextRequest(path, { method: "POST", headers, body: JSON.stringify(payload) }),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("address");
  expect(listUserAddresses).not.toHaveBeenCalled();
});
