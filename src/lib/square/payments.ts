import type * as Square from "square";
import { SquareError } from "square";

import type {
  PaymentCheckout,
  ReserveCheckoutInput,
} from "@/repositories/checkout-reservation-repo";

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
  shippingAddress: ReserveCheckoutInput["shippingAddress"];
  billingAddress: PaymentCheckout["billingAddress"];
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
  address: NonNullable<PaymentCheckout["billingAddress"]>,
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
      billingAddress: input.billingAddress
        ? toSquareAddress(input.billingAddress)
        : undefined,
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

const DEFINITE_DECLINE_CODES = new Set([
  "ADDRESS_VERIFICATION_FAILURE",
  "BUYER_REFUSED_PAYMENT",
  "CARD_DECLINED",
  "CARD_DECLINED_CALL_ISSUER",
  "CARD_DECLINED_VERIFICATION_REQUIRED",
  "CARD_EXPIRED",
  "CVV_FAILURE",
  "GENERIC_DECLINE",
  "INSUFFICIENT_FUNDS",
  "INVALID_ACCOUNT",
  "INVALID_CARD",
  "INVALID_CARD_DATA",
  "INVALID_EXPIRATION",
  "INVALID_EXPIRATION_DATE",
  "INVALID_EXPIRATION_YEAR",
  "INVALID_POSTAL_CODE",
  "TRANSACTION_LIMIT",
  "VERIFY_AVS_FAILURE",
  "VERIFY_CVV_FAILURE",
]);

export function isDefiniteSquarePaymentDecline(error: unknown): boolean {
  return (
    error instanceof SquareError &&
    error.errors.some(({ code }) => DEFINITE_DECLINE_CODES.has(code))
  );
}
