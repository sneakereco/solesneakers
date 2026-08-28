import type * as Square from "square";

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
  taxCents: number;
};

export type HostedPaymentLink = {
  id: string;
  orderId: string;
  url: string;
};

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`square_payment_link_invalid_${field}`);
  }
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
    assertCents(input.taxCents, "tax");

    const externallyPricedAmount = input.subtotalCents + input.taxCents;
    if (!Number.isSafeInteger(externallyPricedAmount) || externallyPricedAmount <= 0) {
      throw new Error("square_payment_link_invalid_total");
    }

    const response = await this.paymentLinks.create({
      idempotencyKey: input.idempotencyKey,
      description: `Sole Sneakers local order ${input.localOrderId}`,
      paymentNote: `Local order ${input.localOrderId}`,
      quickPay: {
        name: `Sole Sneakers order ${input.localOrderId.slice(0, 8)}`,
        locationId: this.locationId,
        priceMoney: {
          amount: BigInt(externallyPricedAmount),
          currency: "USD",
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
      prePopulatedData: input.buyerEmail ? { buyerEmail: input.buyerEmail } : undefined,
    });

    const paymentLink = response.paymentLink;
    if (
      !paymentLink?.id ||
      !paymentLink.orderId ||
      !paymentLink.url ||
      !isSquareHostedUrl(paymentLink.url)
    ) {
      throw new Error("square_payment_link_invalid_response");
    }

    return {
      id: paymentLink.id,
      orderId: paymentLink.orderId,
      url: paymentLink.url,
    };
  }

  async delete(paymentLinkId: string): Promise<void> {
    await this.paymentLinks.delete({ id: paymentLinkId });
  }
}
