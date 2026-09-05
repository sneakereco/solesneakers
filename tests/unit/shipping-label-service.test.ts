import { ShippoService } from "@/services/shipping-label-service";

function fakeClient() {
  return {
    shipments: { create: jest.fn() },
    rates: { get: jest.fn() },
    transactions: { create: jest.fn() },
  };
}

describe("ShippoService rate provenance", () => {
  it("returns only shipment-bound rates from a newly created shipment", async () => {
    const client = fakeClient();
    client.shipments.create.mockResolvedValue({
      objectId: "shipment-1",
      rates: [
        {
          objectId: "rate-1",
          shipment: "shipment-1",
          provider: "USPS",
          servicelevel: { name: "Ground Advantage" },
          amount: "8.25",
          currency: "USD",
        },
        { objectId: "rate-without-shipment", provider: "UPS", amount: "9.50" },
      ],
    });
    const service = new ShippoService(client);

    const shipment = await service.createShipment(
      {
        name: "Store",
        street1: "1 Main St",
        city: "New York",
        state: "NY",
        zip: "10001",
        country: "US",
      },
      {
        name: "Customer",
        street1: "2 Main St",
        city: "New York",
        state: "NY",
        zip: "10002",
        country: "US",
      },
      { weight: 16, length: 12, width: 8, height: 4 },
    );

    expect(shipment.rates).toEqual([
      expect.objectContaining({
        id: "rate-1",
        carrier: "USPS",
        shipmentId: "shipment-1",
      }),
    ]);
  });

  it("retrieves and normalizes a rate before purchase", async () => {
    const client = fakeClient();
    client.rates.get.mockResolvedValue({
      objectId: "rate-1",
      shipment: "shipment-1",
      provider: "FedEx",
      servicelevel: { name: "Ground" },
      amount: "10.00",
      currency: "USD",
    });
    const service = new ShippoService(client);

    await expect(service.getRate("rate-1")).resolves.toEqual(
      expect.objectContaining({
        id: "rate-1",
        carrier: "FedEx",
        shipmentId: "shipment-1",
      }),
    );
    expect(client.rates.get).toHaveBeenCalledWith("rate-1");
  });
});
