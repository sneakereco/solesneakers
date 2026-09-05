import { synchronizeSquareShippingAddress } from "@/lib/square/shipping-address-sync";

const address = {
  name: "Buyer",
  phone: "8435550100",
  line1: "1 Main Street",
  line2: null,
  city: "Charleston",
  state: "SC",
  postalCode: "29401",
  country: "US",
};

const dependencies = () => ({
  getOrderById: jest.fn(),
  getOrderBySquareOrderId: jest.fn(),
  getSquareShippingAddress: jest.fn().mockResolvedValue(address),
  saveSquareShippingAddress: jest.fn().mockResolvedValue(undefined),
});

describe("synchronizeSquareShippingAddress", () => {
  it("retries synchronization for a duplicate completed webhook", async () => {
    const deps = dependencies();
    deps.getOrderBySquareOrderId.mockResolvedValue({
      id: "order-1",
      fulfillment: "ship",
    });

    await expect(
      synchronizeSquareShippingAddress(
        {
          duplicate: true,
          fulfillmentAuthorized: false,
          orderId: null,
          paymentStatus: "COMPLETED",
          squareOrderId: "square-order-1",
        },
        deps,
      ),
    ).resolves.toBe("synced");
    expect(deps.saveSquareShippingAddress).toHaveBeenCalledWith("order-1", address);
  });

  it("uses the durable processor order ID when available", async () => {
    const deps = dependencies();
    deps.getOrderById.mockResolvedValue({ id: "order-1", fulfillment: "ship" });

    await synchronizeSquareShippingAddress(
      {
        duplicate: false,
        fulfillmentAuthorized: true,
        orderId: "order-1",
        paymentStatus: "COMPLETED",
        squareOrderId: "square-order-1",
      },
      deps,
    );

    expect(deps.getOrderById).toHaveBeenCalledWith("order-1");
    expect(deps.getOrderBySquareOrderId).not.toHaveBeenCalled();
  });

  it("skips pickup and non-completed payment events", async () => {
    const pickupDeps = dependencies();
    pickupDeps.getOrderById.mockResolvedValue({ id: "order-1", fulfillment: "pickup" });
    await expect(
      synchronizeSquareShippingAddress(
        {
          duplicate: false,
          fulfillmentAuthorized: true,
          orderId: "order-1",
          paymentStatus: "COMPLETED",
          squareOrderId: "square-order-1",
        },
        pickupDeps,
      ),
    ).resolves.toBe("skipped");
    expect(pickupDeps.getSquareShippingAddress).not.toHaveBeenCalled();

    const pendingDeps = dependencies();
    await expect(
      synchronizeSquareShippingAddress(
        {
          duplicate: false,
          fulfillmentAuthorized: false,
          orderId: null,
          paymentStatus: "PENDING",
          squareOrderId: "square-order-1",
        },
        pendingDeps,
      ),
    ).resolves.toBe("skipped");
    expect(pendingDeps.getOrderBySquareOrderId).not.toHaveBeenCalled();
  });

  it("fails retryably when a shipped Square order has no complete address", async () => {
    const deps = dependencies();
    deps.getOrderById.mockResolvedValue({ id: "order-1", fulfillment: "ship" });
    deps.getSquareShippingAddress.mockResolvedValue(null);

    await expect(
      synchronizeSquareShippingAddress(
        {
          duplicate: false,
          fulfillmentAuthorized: true,
          orderId: "order-1",
          paymentStatus: "COMPLETED",
          squareOrderId: "square-order-1",
        },
        deps,
      ),
    ).rejects.toThrow("square_shipping_address_unavailable");
    expect(deps.saveSquareShippingAddress).not.toHaveBeenCalled();
  });
});
