import type * as Square from "square";

import type {
  CheckoutQuoteRequest,
  CheckoutTotals,
} from "@/lib/checkout/checkout-request";
import type { CheckoutReservationItem } from "@/repositories/checkout-reservation-repo";

export type SquareCheckoutOrderPayloadInput = {
  fulfillment: "ship" | "pickup";
  buyerEmail?: string;
  subtotalCents: number;
  shippingCents: number;
  shippingAddress: CheckoutQuoteRequest["shippingAddress"];
  items: CheckoutReservationItem[];
  referenceId?: string;
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
  address: NonNullable<CheckoutQuoteRequest["shippingAddress"]>,
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

export function buildSquareCheckoutOrder(
  locationId: string,
  input: SquareCheckoutOrderPayloadInput,
): Square.Order {
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
  return {
    locationId,
    referenceId: input.referenceId,
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
        : [
            {
              type: "PICKUP",
              state: "PROPOSED",
              pickupDetails: {
                scheduleType: "ASAP",
                prepTimeDuration: "PT0S",
              },
            },
          ],
    pricingOptions: {
      autoApplyTaxes: true,
      autoApplyDiscounts: false,
    },
  };
}

export function readSquareCheckoutTotals(
  order: Square.Order,
  expectedSubtotalCents: number,
  expectedShippingCents: number,
): CheckoutTotals {
  const taxCents = moneyCents(order.totalTaxMoney, "tax");
  const shippingCents = moneyCents(
    order.totalServiceChargeMoney ?? { amount: BigInt(0), currency: "USD" },
    "shipping",
  );
  const totalCents = moneyCents(order.totalMoney, "total");
  if (shippingCents !== expectedShippingCents) {
    throw new Error("square_checkout_order_shipping_mismatch");
  }
  if (totalCents !== expectedSubtotalCents + shippingCents + taxCents) {
    throw new Error("square_checkout_order_total_mismatch");
  }
  return {
    subtotalCents: expectedSubtotalCents,
    shippingCents,
    taxCents,
    totalCents,
  };
}
