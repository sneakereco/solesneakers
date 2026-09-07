import type * as Square from "square";

import type { PrepareCheckoutRequest } from "@/lib/checkout/checkout-request";
import {
  buildSquareCheckoutOrder,
  readSquareCheckoutTotals,
  type SquareCheckoutOrderPayloadInput,
} from "@/lib/square/checkout-order-payload";
import type { CheckoutReservationItem } from "@/repositories/checkout-reservation-repo";

type OrdersClient = {
  calculate(
    request: Square.CalculateOrderRequest,
  ): PromiseLike<Square.CalculateOrderResponse>;
  create(request: Square.CreateOrderRequest): PromiseLike<Square.CreateOrderResponse>;
  get(request: { orderId: string }): PromiseLike<Square.GetOrderResponse>;
  update(
    request: Square.orders.UpdateOrderRequest,
  ): PromiseLike<Square.UpdateOrderResponse>;
};

export type SquareCheckoutOrderInput = {
  localOrderId: string;
  idempotencyKey: string;
  fulfillment: "ship" | "pickup";
  buyerEmail: string;
  subtotalCents: number;
  shippingCents: number;
  shippingAddress: PrepareCheckoutRequest["shippingAddress"] | null;
  items: CheckoutReservationItem[];
};

export type SquareCheckoutOrder = {
  id: string;
  version: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  taxCalculationId: string;
};

export type SquareOrderCancellationState = {
  state: string;
  version: number;
  hasPayment: boolean;
};

export class SquareCheckoutOrdersGateway {
  constructor(
    private readonly orders: OrdersClient,
    private readonly locationId: string,
  ) {}

  async calculate(input: SquareCheckoutOrderPayloadInput) {
    const response = await this.orders.calculate({
      order: buildSquareCheckoutOrder(this.locationId, input),
    });
    if (!response.order) {
      throw new Error("square_checkout_quote_invalid_response");
    }
    return readSquareCheckoutTotals(
      response.order,
      input.subtotalCents,
      input.shippingCents,
    );
  }

  async create(input: SquareCheckoutOrderInput): Promise<SquareCheckoutOrder> {
    const response = await this.orders.create({
      idempotencyKey: input.idempotencyKey,
      order: buildSquareCheckoutOrder(this.locationId, {
        ...input,
        referenceId: input.localOrderId,
      }),
    });

    const order = response.order;
    if (!order?.id || !Number.isSafeInteger(order.version) || (order.version ?? 0) < 0) {
      throw new Error("square_checkout_order_invalid_response");
    }
    const totals = readSquareCheckoutTotals(
      order,
      input.subtotalCents,
      input.shippingCents,
    );

    return {
      id: order.id,
      version: order.version!,
      ...totals,
      taxCalculationId: `square:${order.id}:v${order.version}`,
    };
  }

  async cancel(orderId: string, version: number, idempotencyKey: string): Promise<void> {
    const response = await this.orders.update({
      orderId,
      idempotencyKey,
      order: {
        locationId: this.locationId,
        version,
        state: "CANCELED",
      },
    });
    if (response.order?.id !== orderId || response.order.state !== "CANCELED") {
      throw new Error("square_checkout_order_cancel_unconfirmed");
    }
  }

  async getCancellationState(orderId: string): Promise<SquareOrderCancellationState> {
    const response = await this.orders.get({ orderId });
    const order = response.order;
    if (
      order?.id !== orderId ||
      !order.state ||
      !Number.isSafeInteger(order.version) ||
      (order.version ?? -1) < 0
    ) {
      throw new Error("square_checkout_order_state_invalid");
    }
    return {
      state: String(order.state),
      version: order.version!,
      hasPayment: (order.tenders ?? []).some((tender) => Boolean(tender.paymentId)),
    };
  }
}
