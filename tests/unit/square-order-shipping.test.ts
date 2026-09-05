import { SquareOrderShippingReader } from "@/lib/square/order-shipping";

describe("SquareOrderShippingReader", () => {
  it("maps the final Square shipment recipient into the local address shape", async () => {
    const get = jest.fn().mockResolvedValue({
      order: {
        fulfillments: [
          {
            type: "SHIPMENT",
            state: "PROPOSED",
            shipmentDetails: {
              recipient: {
                displayName: "Buyer Name",
                emailAddress: "buyer@example.com",
                phoneNumber: "8435550100",
                address: {
                  addressLine1: "1 Main Street",
                  addressLine2: "Unit 2",
                  locality: "Charleston",
                  administrativeDistrictLevel1: "SC",
                  postalCode: "29401",
                  country: "US",
                },
              },
            },
          },
        ],
      },
      errors: [],
    });
    const reader = new SquareOrderShippingReader({ get } as never);

    await expect(reader.get("square-order-1")).resolves.toEqual({
      name: "Buyer Name",
      phone: "8435550100",
      line1: "1 Main Street",
      line2: "Unit 2",
      city: "Charleston",
      state: "SC",
      postalCode: "29401",
      country: "US",
    });
    expect(get).toHaveBeenCalledWith({ orderId: "square-order-1" });
  });

  it("returns null when Square has no complete shipment recipient", async () => {
    const reader = new SquareOrderShippingReader({
      get: jest.fn().mockResolvedValue({
        order: { fulfillments: [{ type: "PICKUP", pickupDetails: {} }] },
        errors: [],
      }),
    } as never);

    await expect(reader.get("square-order-1")).resolves.toBeNull();
  });
});
