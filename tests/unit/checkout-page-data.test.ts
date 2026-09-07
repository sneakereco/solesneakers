import {
  loadCheckoutPageData,
  type CheckoutPageDataDependencies,
} from "@/lib/checkout/checkout-page-data";

function dependencies(
  overrides: Partial<CheckoutPageDataDependencies> = {},
): CheckoutPageDataDependencies {
  return {
    getSession: jest.fn().mockResolvedValue(null),
    getShippingProfile: jest.fn().mockResolvedValue(null),
    getPaymentConfig: jest.fn().mockReturnValue({
      applicationId: "sandbox-sq0idb-example",
      locationId: "LOCATION",
      environment: "sandbox",
    }),
    ...overrides,
  };
}

describe("loadCheckoutPageData", () => {
  it("returns empty customer defaults for a guest", async () => {
    const deps = dependencies();

    await expect(loadCheckoutPageData(deps)).resolves.toEqual({
      isGuest: true,
      customer: {
        email: "",
        address: {
          name: "",
          phone: "",
          line1: "",
          line2: "",
          city: "",
          state: "",
          postalCode: "",
          country: "US",
        },
      },
      paymentConfig: {
        applicationId: "sandbox-sq0idb-example",
        locationId: "LOCATION",
        environment: "sandbox",
      },
    });
    expect(deps.getShippingProfile).not.toHaveBeenCalled();
  });

  it("prefills a signed-in customer from the shipping profile", async () => {
    const deps = dependencies({
      getSession: jest.fn().mockResolvedValue({
        user: { id: "user-1", email: "account@example.com" },
        profile: { full_name: "Account Name" },
      }),
      getShippingProfile: jest.fn().mockResolvedValue({
        full_name: "Shipping Name",
        phone: "3025550100",
        address_line1: "1 Market St",
        address_line2: "Suite 2",
        city: "Wilmington",
        state: "de",
        postal_code: "19801",
        country: "us",
      }),
    });

    await expect(loadCheckoutPageData(deps)).resolves.toMatchObject({
      isGuest: false,
      customer: {
        email: "account@example.com",
        address: {
          name: "Shipping Name",
          phone: "3025550100",
          line1: "1 Market St",
          line2: "Suite 2",
          city: "Wilmington",
          state: "DE",
          postalCode: "19801",
          country: "US",
        },
      },
    });
  });

  it("falls back to the account name and safely empties partial profile fields", async () => {
    const deps = dependencies({
      getSession: jest.fn().mockResolvedValue({
        user: { id: "user-1", email: "account@example.com" },
        profile: { full_name: "Account Name" },
      }),
      getShippingProfile: jest.fn().mockResolvedValue({
        full_name: null,
        phone: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
      }),
    });

    const result = await loadCheckoutPageData(deps);
    expect(result.customer.address).toEqual({
      name: "Account Name",
      phone: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "US",
    });
  });

  it("rejects missing public Square configuration", async () => {
    await expect(
      loadCheckoutPageData(
        dependencies({
          getPaymentConfig: jest.fn().mockImplementation(() => {
            throw new Error("square_configuration_invalid");
          }),
        }),
      ),
    ).rejects.toThrow("square_configuration_invalid");
  });
});
