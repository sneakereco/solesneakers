import type * as Square from "square";

import type { PaymentLinkRequest } from "@/lib/checkout/payment-link-request";
import type { CheckoutReservationItem } from "@/repositories/checkout-reservation-repo";

type OrdersClient = {
  create(request: Square.CreateOrderRequest): PromiseLike<Square.CreateOrderResponse>;
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
  shippingAddress: PaymentLinkRequest["shippingAddress"] | null;
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

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`square_checkout_order_invalid_${field}`);
  }
}

function moneyCents(money: Square.Money | null | undefined, field: string): number {
  if (money?.currency !== "USD" || money.amount === undefined || money.amount === null) {
    throw new Error(`square_checkout_order_invalid_${field}`);
  }
  const value = Number(money.amount);
  assertCents(value, field);
  return value;
}

function itemName(item: CheckoutReservationItem): string {
  return `${item.productName} - ${item.sizeLabel}`.trim().slice(0, 512);
}

function squareAddress(
  address: NonNullable<PaymentLinkRequest["shippingAddress"]>,
): Square.Address {
  return {
    addressLine1: address.line1,
    addressLine2: address.line2 ?? undefined,
    locality: address.city,
    administrativeDistrictLevel1: address.state,
    postalCode: address.postalCode,
    country: "US",
  };
}

export class SquareCheckoutOrdersGateway {
  constructor(
    private readonly orders: OrdersClient,
    private readonly locationId: string,
  ) {}

  async create(input: SquareCheckoutOrderInput): Promise<SquareCheckoutOrder> {
    assertCents(input.subtotalCents, "subtotal");
    assertCents(input.shippingCents, "shipping");
    if (input.items.length === 0 || input.subtotalCents <= 0) {
      throw new Error("square_checkout_order_invalid_total");
    }
    if (input.fulfillment === "ship" && !input.shippingAddress) {
      throw new Error("square_checkout_order_invalid_shipping_address");
    }

    const itemSubtotal = input.items.reduce((total, item) => {
      assertCents(item.unitPriceCents, "item_price");
      assertCents(item.lineTotalCents, "line_total");
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new Error("square_checkout_order_invalid_quantity");
      }
      return total + item.lineTotalCents;
    }, 0);
    if (itemSubtotal !== input.subtotalCents) {
      throw new Error("square_checkout_order_subtotal_mismatch");
    }

    const shippingAddress = input.shippingAddress;
    const response = await this.orders.create({
      idempotencyKey: input.idempotencyKey,
      order: {
        locationId: this.locationId,
        referenceId: input.localOrderId,
        lineItems: input.items.map((item) => ({
          name: itemName(item),
          quantity: String(item.quantity),
          note: `SKU ${item.variantSku}`.slice(0, 500),
          basePriceMoney: {
            amount: BigInt(item.unitPriceCents),
            currency: "USD",
          },
        })),
        serviceCharges:
          input.fulfillment === "ship" && input.shippingCents > 0
            ? [
                {
                  name: "Shipping",
                  amountMoney: {
                    amount: BigInt(input.shippingCents),
                    currency: "USD",
                  },
                  calculationPhase: "SUBTOTAL_PHASE",
                  taxable: true,
                },
              ]
            : undefined,
        fulfillments:
          input.fulfillment === "ship" && shippingAddress
            ? [
                {
                  type: "SHIPMENT",
                  state: "PROPOSED",
                  shipmentDetails: {
                    recipient: {
                      displayName: shippingAddress.name,
                      emailAddress: input.buyerEmail,
                      phoneNumber: shippingAddress.phone ?? undefined,
                      address: squareAddress(shippingAddress),
                    },
                  },
                },
              ]
            : [{ type: "PICKUP", state: "PROPOSED", pickupDetails: {} }],
        pricingOptions: {
          autoApplyTaxes: true,
          autoApplyDiscounts: false,
        },
      },
    });

    const order = response.order;
    if (!order?.id || !Number.isSafeInteger(order.version) || (order.version ?? 0) < 0) {
      throw new Error("square_checkout_order_invalid_response");
    }
    const taxCents = moneyCents(order.totalTaxMoney, "tax");
    const shippingCents = moneyCents(
      order.totalServiceChargeMoney ?? { amount: BigInt(0), currency: "USD" },
      "shipping",
    );
    const totalCents = moneyCents(order.totalMoney, "total");
    if (shippingCents !== input.shippingCents) {
      throw new Error("square_checkout_order_shipping_mismatch");
    }
    if (totalCents !== input.subtotalCents + shippingCents + taxCents) {
      throw new Error("square_checkout_order_total_mismatch");
    }

    return {
      id: order.id,
      version: order.version!,
      subtotalCents: input.subtotalCents,
      shippingCents,
      taxCents,
      totalCents,
      taxCalculationId: `square:${order.id}:v${order.version}`,
    };
  }

  async cancel(orderId: string, version: number, idempotencyKey: string): Promise<void> {
    await this.orders.update({
      orderId,
      idempotencyKey,
      order: {
        locationId: this.locationId,
        version,
        state: "CANCELED",
      },
    });
  }
}
