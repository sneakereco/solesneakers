import type { SquarePaymentEventResult } from "@/lib/square/payment-event";
import { createSquareClient } from "@/lib/square/client";
import { SquareOrderShippingReader } from "@/lib/square/order-shipping";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { AddressesRepository } from "@/repositories/addresses-repo";
import type { AddressInput } from "@/repositories/addresses-repo";
import { OrdersRepository } from "@/repositories/orders-repo";

type ShippingOrder = {
  id: string;
  fulfillment: string | null;
};

export type SquareShippingSyncDependencies = {
  getOrderById(orderId: string): Promise<ShippingOrder | null>;
  getOrderBySquareOrderId(squareOrderId: string): Promise<ShippingOrder | null>;
  getSquareShippingAddress(squareOrderId: string): Promise<AddressInput | null>;
  saveSquareShippingAddress(orderId: string, address: AddressInput): Promise<void>;
};

export function createSquareShippingSyncDependencies(
  supabase: TypedSupabaseClient,
): SquareShippingSyncDependencies {
  const orders = new OrdersRepository(supabase);
  const addresses = new AddressesRepository(supabase);
  const squareOrders = new SquareOrderShippingReader(createSquareClient().orders);

  return {
    getOrderById: (orderId) => orders.getById(orderId),
    getOrderBySquareOrderId: (squareOrderId) => orders.getBySquareOrderId(squareOrderId),
    getSquareShippingAddress: (squareOrderId) => squareOrders.get(squareOrderId),
    saveSquareShippingAddress: (orderId, address) =>
      addresses.upsertSquareOrderShippingSnapshot(orderId, address),
  };
}

export async function synchronizeSquareShippingAddress(
  result: SquarePaymentEventResult,
  deps: SquareShippingSyncDependencies,
): Promise<"skipped" | "synced"> {
  if (
    "ignored" in result ||
    result.paymentStatus !== "COMPLETED" ||
    !result.squareOrderId
  ) {
    return "skipped";
  }

  const order = result.orderId
    ? await deps.getOrderById(result.orderId)
    : await deps.getOrderBySquareOrderId(result.squareOrderId);
  if (!order || order.fulfillment !== "ship") {
    return "skipped";
  }

  const address = await deps.getSquareShippingAddress(result.squareOrderId);
  if (!address) {
    throw new Error("square_shipping_address_unavailable");
  }

  await deps.saveSquareShippingAddress(order.id, address);
  return "synced";
}
