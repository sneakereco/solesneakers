import type * as Square from "square";

import type { PaymentLinkRequest } from "@/lib/checkout/payment-link-request";
import type { CheckoutReservationItem } from "@/repositories/checkout-reservation-repo";

type PaymentLinksClient = {
  create(
    request: Square.checkout.CreatePaymentLinkRequest,
  ): PromiseLike<Square.CreatePaymentLinkResponse>;
  delete(request: Square.checkout.DeletePaymentLinksRequest): PromiseLike<unknown>;
};

export type HostedPaymentLinkInput = {
  localOrderId: string;
  tenantId: string;
  idempotencyKey: string;
  fulfillment: "ship" | "pickup";
  buyerEmail: string | null;
  redirectUrl: string;
  subtotalCents: number;
  shippingCents: number;
  shippingAddress: PaymentLinkRequest["shippingAddress"] | null;
  items: CheckoutReservationItem[];
};

export type HostedPaymentLink = {
  id: string;
  orderId: string;
  url: string;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  taxCalculationId: string;
};

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`square_payment_link_invalid_${field}`);
  }
}

function moneyCents(money: Square.Money | null | undefined, field: string): number {
  if (money?.currency !== "USD" || money.amount === undefined || money.amount === null) {
    throw new Error(`square_payment_link_invalid_${field}`);
  }
  const value = Number(money.amount);
  assertCents(value, field);
  return value;
}

function itemName(item: CheckoutReservationItem): string {
  const value = `${item.productName} - ${item.sizeLabel}`.trim();
  return value.slice(0, 512);
}

export function isSquareHostedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return false;
    }

    return (
      url.hostname === "square.link" ||
      url.hostname.endsWith(".square.link") ||
      url.hostname === "checkout.square.site"
    );
  } catch {
    return false;
  }
}

export class SquarePaymentLinksGateway {
  constructor(
    private readonly paymentLinks: PaymentLinksClient,
    private readonly locationId: string,
    private readonly merchantSupportEmail?: string,
  ) {}

  async create(input: HostedPaymentLinkInput): Promise<HostedPaymentLink> {
    assertCents(input.subtotalCents, "subtotal");
    assertCents(input.shippingCents, "shipping");
    if (input.items.length === 0 || input.subtotalCents <= 0) {
      throw new Error("square_payment_link_invalid_total");
    }

    const itemSubtotal = input.items.reduce((total, item) => {
      assertCents(item.unitPriceCents, "item_price");
      assertCents(item.lineTotalCents, "line_total");
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new Error("square_payment_link_invalid_quantity");
      }
      return total + item.lineTotalCents;
    }, 0);
    if (itemSubtotal !== input.subtotalCents) {
      throw new Error("square_payment_link_subtotal_mismatch");
    }

    const response = await this.paymentLinks.create({
      idempotencyKey: input.idempotencyKey,
      description: `Sole Sneakers local order ${input.localOrderId}`,
      paymentNote: `Local order ${input.localOrderId}`,
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
        pricingOptions: {
          autoApplyTaxes: true,
          autoApplyDiscounts: false,
        },
      },
      checkoutOptions: {
        allowTipping: false,
        redirectUrl: input.redirectUrl,
        merchantSupportEmail: this.merchantSupportEmail,
        askForShippingAddress: input.fulfillment === "ship",
        acceptedPaymentMethods: {
          applePay: true,
          googlePay: true,
          cashAppPay: true,
          afterpayClearpay: false,
        },
        shippingFee:
          input.fulfillment === "ship" && input.shippingCents > 0
            ? {
                name: "Shipping",
                charge: {
                  amount: BigInt(input.shippingCents),
                  currency: "USD",
                },
              }
            : undefined,
        enableCoupon: false,
        enableLoyalty: false,
      },
      prePopulatedData:
        input.buyerEmail || input.shippingAddress
          ? {
              buyerEmail: input.buyerEmail ?? undefined,
              buyerAddress: input.shippingAddress
                ? {
                    addressLine1: input.shippingAddress.line1,
                    addressLine2: input.shippingAddress.line2 ?? undefined,
                    locality: input.shippingAddress.city,
                    administrativeDistrictLevel1: input.shippingAddress.state,
                    postalCode: input.shippingAddress.postalCode,
                    country: "US",
                  }
                : undefined,
            }
          : undefined,
    });

    const paymentLink = response.paymentLink;
    const squareOrder = response.relatedResources?.orders?.find(
      (order) => order.id === paymentLink?.orderId,
    );
    if (
      !paymentLink?.id ||
      !paymentLink.orderId ||
      !paymentLink.url ||
      !isSquareHostedUrl(paymentLink.url) ||
      !squareOrder
    ) {
      throw new Error("square_payment_link_invalid_response");
    }

    const taxCents = moneyCents(squareOrder.totalTaxMoney, "tax");
    const totalCents = moneyCents(squareOrder.totalMoney, "total");
    const shippingCents = moneyCents(
      squareOrder.totalServiceChargeMoney ?? { amount: BigInt(0), currency: "USD" },
      "shipping",
    );
    if (shippingCents !== input.shippingCents) {
      throw new Error("square_payment_link_shipping_mismatch");
    }
    if (totalCents !== input.subtotalCents + shippingCents + taxCents) {
      throw new Error("square_payment_link_total_mismatch");
    }

    return {
      id: paymentLink.id,
      orderId: paymentLink.orderId,
      url: paymentLink.url,
      taxCents,
      shippingCents,
      totalCents,
      taxCalculationId: `square:${paymentLink.orderId}:v${squareOrder.version ?? "unknown"}`,
    };
  }

  async delete(paymentLinkId: string): Promise<void> {
    await this.paymentLinks.delete({ id: paymentLinkId });
  }
}
