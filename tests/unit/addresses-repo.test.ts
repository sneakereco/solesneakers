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

  it.each(["update", "insert"] as const)(
    "returns the canonical row from an address %s",
    async (method) => {
      const userId = "account-current";
      const saved = {
        id: "persisted-address",
        user_id: userId,
        line1: "1 Main Street",
        postal_code: "29401",
      };
      const lookup = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: method === "update" ? { id: saved.id } : null,
          error: null,
        }),
      };
      const write = {
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: saved, error: null }),
      };
      const from = jest.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(write);
      const repository = new AddressesRepository({ from } as never);

      await expect(
        repository.upsertUserAddress(userId, {
          line1: saved.line1,
          postalCode: saved.postal_code,
        }),
      ).resolves.toEqual(saved);
      expect(lookup.eq.mock.calls).toEqual([
        ["user_id", userId],
        ["line1", saved.line1],
        ["postal_code", saved.postal_code],
      ]);
      expect(write[method]).toHaveBeenCalledTimes(1);
      expect(write[method === "update" ? "insert" : "update"]).not.toHaveBeenCalled();
      expect(write.single).toHaveBeenCalledTimes(1);
    },
  );
});
