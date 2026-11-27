import { CheckoutPreparationRepository } from "@/Modules/Checkout/Source/Features/Preparation/reservation-repository";
import type { ReserveCheckoutInput } from "@/repositories/checkout-reservation-repo";
const productId = "11111111-1111-4111-8111-111111111111",
  variantId = "22222222-2222-4222-8222-222222222222";
const input = {
  items: [{ productId, variantId, quantity: 1 }],
  ownerBinding: "guest:" + "f".repeat(64),
} as ReserveCheckoutInput & { ownerBinding: string };
const conflict = {
  productId,
  variantId,
  requestedQuantity: 1,
  availableQuantity: 0,
  reason: "sold_out",
};
const failure = (code: string, details: string) =>
  new CheckoutPreparationRepository({
    rpc: jest.fn().mockResolvedValue({
      data: null,
      error: { code, details, message: "checkout_inventory_conflict" },
    }),
  } as never).reserveCheckout(input);
it("translates only exact transaction conflicts belonging to the requested basket", async () => {
  await expect(failure("PC409", JSON.stringify([conflict]))).resolves.toEqual({
    kind: "conflict",
    conflicts: [conflict],
  });
  for (const details of [
    "broken",
    JSON.stringify([]),
    JSON.stringify([{ ...conflict, variantId: productId }]),
    JSON.stringify([{ ...conflict, requestedQuantity: 5 }]),
    JSON.stringify([{ ...conflict, availableQuantity: 1 }]),
    JSON.stringify([conflict, conflict]),
  ])
    await expect(failure("PC409", details)).rejects.toBeDefined();
  await expect(failure("XX000", JSON.stringify([conflict]))).rejects.toBeDefined();
});
