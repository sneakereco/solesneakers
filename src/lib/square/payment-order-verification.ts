import type { SquareClient } from "square";

import type { SquarePaymentSnapshot } from "@/lib/square/payment-event";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createSquareClient } from "@/lib/square/client";
import { OrdersRepository } from "@/repositories/orders-repo";

type LocalOrder = {
  id: string;
  subtotal: number | null;
  shipping: number | null;
};

type VerificationDependencies = {
  getLocalOrder(squareOrderId: string): Promise<LocalOrder | null>;
  getSquareOrder(squareOrderId: string): ReturnType<SquareClient["orders"]["get"]>;
};

function cents(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

export async function verifySquarePaymentOrder(
  payment: SquarePaymentSnapshot,
  deps: VerificationDependencies,
): Promise<void> {
  const [local, response] = await Promise.all([
    deps.getLocalOrder(payment.squareOrderId),
    deps.getSquareOrder(payment.squareOrderId),
  ]);
  const order = response.order;
  const totalCents = cents(order?.totalMoney?.amount);
  const taxCents = cents(order?.totalTaxMoney?.amount);
  const baseCents = local
    ? Math.round(Number(local.subtotal) * 100) + Math.round(Number(local.shipping) * 100)
    : null;

  if (
    !local ||
    !order?.id ||
    order.id !== payment.squareOrderId ||
    order.referenceId !== local.id ||
    order.locationId !== payment.locationId ||
    order.totalMoney?.currency !== payment.currency ||
    order.totalTaxMoney?.currency !== payment.currency ||
    totalCents !== payment.amountCents ||
    taxCents === null ||
    baseCents === null ||
    baseCents + taxCents !== totalCents
  ) {
    throw new Error("square_payment_order_total_mismatch");
  }
}

export function createSquarePaymentOrderVerifier(supabase: TypedSupabaseClient) {
  const square = createSquareClient();
  const orders = new OrdersRepository(supabase);
  return (payment: SquarePaymentSnapshot) =>
    verifySquarePaymentOrder(payment, {
      getLocalOrder: (squareOrderId) => orders.getBySquareOrderId(squareOrderId),
      getSquareOrder: (squareOrderId) => square.orders.get({ orderId: squareOrderId }),
    });
}
