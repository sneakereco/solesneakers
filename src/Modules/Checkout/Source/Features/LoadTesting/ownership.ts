import { getActiveLoadTestContext } from "./context";
import { readLoadTestSettings } from "./settings";
import { createLoadRunStore } from "./run-store";
import type {
  ReserveCheckoutInput,
  PaymentCheckout,
} from "@/repositories/checkout-reservation-repo";

export function currentLoadRegistry() {
  const context = getActiveLoadTestContext();
  if (!context) return null;
  const settings = readLoadTestSettings();
  if (!settings) throw new Error("Load context lost deployment settings");
  return { context, settings, store: createLoadRunStore(settings) };
}
export async function assertLoadCart(
  items: { productId: string; variantId: string }[],
): Promise<void> {
  const registry = currentLoadRegistry();
  if (!registry) return;
  for (const item of items) {
    for (const [kind, id] of [
      ["product", item.productId],
      ["variant", item.variantId],
    ]) {
      const owner = await registry.store.get<{ runId: string }>(
        "fixture",
        `${kind}:${id}`,
      );
      if (owner?.runId !== registry.context.runId)
        throw new Error("Cart fixture is outside active load run");
    }
  }
}
export async function reserveWithLoadOwnership<T extends { orderId: string }>(
  input: Pick<ReserveCheckoutInput, "guestEmail" | "userId">,
  reserve: () => Promise<T>,
  registry = currentLoadRegistry(),
): Promise<T> {
  if (!registry) return reserve();
  const { context, store } = registry;
  if (
    input.guestEmail &&
    !input.guestEmail.toLowerCase().endsWith(`@${context.runId}.load.test`)
  )
    throw new Error("Guest identity is outside load run");
  if (input.userId) {
    const owner = await store.get<{ runId: string }>(
      "fixture",
      `account:${input.userId}`,
    );
    if (owner?.runId !== context.runId) throw new Error("Account is outside load run");
  }
  const result = await reserve();
  const owner = { runId: context.runId, slot: context.slot };
  await store.mutate(
    "fixture",
    `order:${result.orderId}`,
    owner,
    (previous) => {
      if (previous.runId !== context.runId || previous.slot !== context.slot)
        throw new Error("Reservation ownership conflict");
      return owner;
    },
    { kind: "owned-orders", id: context.runId, value: () => result.orderId },
  );
  if (input.guestEmail)
    await store.put("fixture", `email:${input.guestEmail}`, {
      runId: context.runId,
      slot: context.slot,
    });
  return result;
}
export async function assertLoadPaymentOrder(
  order: PaymentCheckout | null,
): Promise<void> {
  const registry = currentLoadRegistry();
  if (!registry || !order) return;
  const owner = await registry.store.get<{ runId: string; slot: number }>(
    "fixture",
    `order:${order.orderId}`,
  );
  if (owner?.runId !== registry.context.runId || owner.slot !== registry.context.slot)
    throw new Error("Order belongs to a different load session");
}
