import { CheckoutSettingsRepository } from "@/repositories/checkout-settings-repo";

describe("CheckoutSettingsRepository", () => {
  it("loads the tenant flat shipping rate", async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { flat_shipping_cents: 1295 },
      error: null,
    });
    const eq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq }));
    const repository = new CheckoutSettingsRepository({
      from: jest.fn(() => ({ select })),
    } as never);

    await expect(repository.getByTenant("tenant-1")).resolves.toEqual({
      flatShippingCents: 1295,
    });
    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
  });

  it("persists an integer nonnegative flat shipping rate", async () => {
    const single = jest.fn().mockResolvedValue({
      data: { flat_shipping_cents: 1500 },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const upsert = jest.fn(() => ({ select }));
    const repository = new CheckoutSettingsRepository({
      from: jest.fn(() => ({ upsert })),
    } as never);

    await expect(repository.upsert("tenant-1", 1500)).resolves.toEqual({
      flatShippingCents: 1500,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: "tenant-1", flat_shipping_cents: 1500 }),
      { onConflict: "tenant_id" },
    );
  });
});
