import { SquarePaymentReconciliationCooldown } from "@/lib/square/payment-reconciliation-cooldown";

describe("SquarePaymentReconciliationCooldown", () => {
  it("acquires one ten-second lease per order", async () => {
    const set = jest.fn().mockResolvedValue("OK");
    const cooldown = new SquarePaymentReconciliationCooldown({ set });

    await expect(cooldown.acquire("order-1")).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith("rdk:square:reconcile:order:order-1", "1", {
      nx: true,
      ex: 10,
    });
  });

  it("skips Square reads while another request owns the lease", async () => {
    const cooldown = new SquarePaymentReconciliationCooldown({
      set: jest.fn().mockResolvedValue(null),
    });

    await expect(cooldown.acquire("order-1")).resolves.toBe(false);
  });
});
