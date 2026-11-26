import { createHmac } from "node:crypto";
import type { VerifiedAttemptFacts } from "@/Modules/Checkout/Source/Features/Payments/attempt-contract";
import type { PaymentMethod } from "@/lib/checkout/payment-permit";
import type * as Square from "square";
import { SquareError } from "square";
import {
  squarePaymentDetails,
  type SquarePaymentDetails,
} from "@/lib/square/payment-details";

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
  attemptId: string;
  method: PaymentMethod;
  squareOrderId: string;
  sourceId: string;
  idempotencyKey: string;
  totalCents: number;
  shippingAddress: ReserveCheckoutInput["shippingAddress"];
  billingAddress: PaymentCheckout["billingAddress"];
};

export type DirectPaymentResult = {
  details?: SquarePaymentDetails;
  referenceId?: string;
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
    ...(payment.referenceId ? { referenceId: payment.referenceId } : {}),
    id: payment.id,
    orderId: payment.orderId,
    status: status as DirectPaymentResult["status"],
    totalCents: amount,
    details: squarePaymentDetails(payment),
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

  private request(input: DirectPaymentInput): Square.CreatePaymentRequest {
    if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
      throw new Error("square_payment_invalid_total");
    }

    return {
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      amountMoney: { amount: BigInt(input.totalCents), currency: "USD" },
      autocomplete: true,
      orderId: input.squareOrderId,
      locationId: this.locationId,
      referenceId: input.attemptId,
      billingAddress: input.billingAddress
        ? toSquareAddress(input.billingAddress)
        : undefined,
      shippingAddress: input.shippingAddress
        ? toSquareAddress(input.shippingAddress)
        : undefined,
      note: `Sole Sneakers order ${input.localOrderId}`,
    };
  }

  fingerprints(input: DirectPaymentInput, secret: string) {
    const digest = (domain: string, value: string) =>
      createHmac("sha256", secret)
        .update(domain)
        .update("\0")
        .update(value)
        .digest("hex");
    const exactRequest = JSON.stringify(this.request(input), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    return {
      sourceDigest: digest("checkout-payment-source", input.sourceId),
      requestDigest: digest(
        "checkout-payment-request",
        JSON.stringify([input.method, exactRequest]),
      ),
    };
  }

  async create(input: DirectPaymentInput): Promise<DirectPaymentResult> {
    const response = await this.payments.create(this.request(input));
    const payment = parsePayment(response.payment);
    const source = payment.details?.source_type;
    const correctMethod =
      input.method === "cashAppPay"
        ? source === "WALLET" && payment.details?.payment_method === "cashAppPay"
        : input.method === "afterpay"
          ? source === "BUY_NOW_PAY_LATER" &&
            payment.details?.payment_method === "afterpay"
          : source === "CARD";
    if (
      response.payment?.locationId !== this.locationId ||
      !correctMethod ||
      payment.referenceId !== input.attemptId ||
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

type DeclineCode = Extract<VerifiedAttemptFacts, { kind: "square_decline" }>["code"];
export function squareDeclineCode(error: unknown): DeclineCode | null {
  if (
    !(error instanceof SquareError) ||
    !error.statusCode ||
    ![400, 402].includes(error.statusCode) ||
    !error.errors?.length ||
    !error.errors.every(({ code }) => DEFINITE_DECLINE_CODES.has(code))
  )
    return null;
  return error.errors[0].code as DeclineCode;
}
