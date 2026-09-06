import type * as Square from "square";

import type { PaymentLinkRequest } from "@/lib/checkout/payment-link-request";

type PaymentsClient = {
  create(request: Square.CreatePaymentRequest): PromiseLike<Square.CreatePaymentResponse>;
  get(request: Square.GetPaymentsRequest): PromiseLike<Square.GetPaymentResponse>;
};

export type DirectPaymentInput = {
  localOrderId: string;
  squareOrderId: string;
  sourceId: string;
  idempotencyKey: string;
  totalCents: number;
  shippingAddress: PaymentLinkRequest["shippingAddress"] | null;
};

export type DirectPaymentResult = {
  id: string;
  orderId: string;
  status: "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED";
  totalCents: number;
};

function parsePayment(payment: Square.Payment | null | undefined): DirectPaymentResult {
  const amount = Number(payment?.amountMoney?.amount);
  const status = payment?.status;
  if (
    !payment?.id ||
    !payment.orderId ||
    payment.amountMoney?.currency !== "USD" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !status ||
    !["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"].includes(status)
  ) {
    throw new Error("square_payment_invalid_response");
  }

  return {
    id: payment.id,
    orderId: payment.orderId,
    status: status as DirectPaymentResult["status"],
    totalCents: amount,
  };
}

function toSquareAddress(
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

export class SquarePaymentsGateway {
  constructor(
    private readonly payments: PaymentsClient,
    private readonly locationId: string,
  ) {}

  async create(input: DirectPaymentInput): Promise<DirectPaymentResult> {
    if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
      throw new Error("square_payment_invalid_total");
    }

    const response = await this.payments.create({
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      amountMoney: { amount: BigInt(input.totalCents), currency: "USD" },
      autocomplete: true,
      orderId: input.squareOrderId,
      locationId: this.locationId,
      referenceId: input.localOrderId,
      shippingAddress: input.shippingAddress
        ? toSquareAddress(input.shippingAddress)
        : undefined,
      note: `Sole Sneakers order ${input.localOrderId}`,
    });
    const payment = parsePayment(response.payment);
    if (
      payment.orderId !== input.squareOrderId ||
      payment.totalCents !== input.totalCents
    ) {
      throw new Error("square_payment_invalid_response");
    }
    return payment;
  }

  async get(paymentId: string): Promise<DirectPaymentResult> {
    const response = await this.payments.get({ paymentId });
    return parsePayment(response.payment);
  }
}
