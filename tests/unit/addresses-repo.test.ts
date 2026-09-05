import { AddressesRepository } from "@/repositories/addresses-repo";

describe("AddressesRepository", () => {
  it("upserts Square's final address with a synchronization timestamp", async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn(() => ({ upsert }));
    const repository = new AddressesRepository({ from } as never);

    await repository.upsertSquareOrderShippingSnapshot("order-1", {
      name: "Buyer",
      phone: "8435550100",
      line1: "1 Main Street",
      line2: null,
      city: "Charleston",
      state: "SC",
      postalCode: "29401",
      country: "US",
    });

    expect(from).toHaveBeenCalledWith("order_shipping");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-1",
        name: "Buyer",
        postal_code: "29401",
        square_synced_at: expect.any(String),
      }),
      { onConflict: "order_id" },
    );
    const payload = upsert.mock.calls[0][0];
    expect(Number.isNaN(Date.parse(payload.square_synced_at))).toBe(false);
  });
});
