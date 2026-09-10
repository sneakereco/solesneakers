import { validateShippingAddress } from "@/lib/shipping/validate-shipping-address";

const address = {
  name: "Buyer",
  phone: "2025550100",
  line1: "1600 Pennsylvania Avenue NW",
  line2: null,
  city: "Washington",
  state: "DC",
  postalCode: "20500",
  country: "US" as const,
};
const recommended = {
  address_line_1: "1600 Pennsylvania Ave NW",
  address_line_2: null,
  city_locality: "Washington",
  state_province: "DC",
  postal_code: "20500-0005",
  country_code: "US",
  confidence_result: { score: "high" },
};
const fetchResponse = (body: unknown, status = 200) =>
  jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("Shippo shipping validation", () => {
  it("accepts explicitly valid addresses and only sends address data to Shippo", async () => {
    const fetcher = fetchResponse({
      analysis: { validation_result: { value: "valid" } },
    });
    await expect(
      validateShippingAddress(address, "test-token", fetcher),
    ).resolves.toEqual({ status: "valid" });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.origin).toBe("https://api.goshippo.com");
    expect(url.searchParams.get("address_line_1")).toBe(address.line1);
    expect(url.searchParams.has("phone")).toBe(false);
  });
  it("requires confirmation of high-confidence corrections without changing recipient identity", async () => {
    const fetcher = fetchResponse({
      analysis: { validation_result: { value: "partially_valid" } },
      recommended_address: recommended,
    });
    await expect(
      validateShippingAddress(address, "test-token", fetcher),
    ).resolves.toEqual({
      status: "suggestion",
      address: {
        ...address,
        line1: recommended.address_line_1,
        postalCode: recommended.postal_code,
      },
    });
  });
  it.each(["invalid", "partially_valid", "unknown"])(
    "does not accept %s without a verified correction",
    async (value) => {
      await expect(
        validateShippingAddress(
          address,
          "test-token",
          fetchResponse({ analysis: { validation_result: { value } } }),
        ),
      ).resolves.toEqual({ status: "invalid" });
    },
  );
  it("does not suggest dropping an apartment number", async () => {
    await expect(
      validateShippingAddress(
        { ...address, line2: "Apt 99" },
        "test-token",
        fetchResponse({
          analysis: { validation_result: { value: "partially_valid" } },
          recommended_address: recommended,
        }),
      ),
    ).resolves.toEqual({ status: "invalid" });
  });
  it.each([{}, { analysis: {} }])("fails closed on malformed responses", async (body) => {
    await expect(
      validateShippingAddress(address, "test-token", fetchResponse(body)),
    ).resolves.toEqual({ status: "unavailable" });
  });
  it("fails closed on outages and never leaks provider errors", async () => {
    await expect(
      validateShippingAddress(
        address,
        "test-token",
        fetchResponse({ error: "secret" }, 503),
      ),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      validateShippingAddress(
        address,
        "test-token",
        jest.fn().mockRejectedValue(new Error("secret")),
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
