import type { TypedSupabaseClient } from "@/lib/supabase/server";

import { z } from "zod";

type ProviderEvidenceInput = {
  note?: string | null;
  referenceId?: string | null;
  updatedAt?: string | null;
  processingFee?:
    | {
        effectiveAt?: string | null;
        type?: string | null;
        amountMoney?: {
          currency?: string | null;
          amount?: number | bigint | null;
        } | null;
      }[]
    | null;
};
export function squareSourceEvidence(payment: ProviderEvidenceInput) {
  const reference = payment.referenceId;
  const prefix = `Sole Sneakers order ${reference} attempt `;
  const attempt = payment.note?.startsWith(prefix)
    ? payment.note.slice(prefix.length)
    : null;
  const fees = (payment.processingFee ?? []).flatMap((fee) => {
    const amount = fee.amountMoney?.amount;
    const cents = Number(amount);
    if (
      amount === null ||
      amount === undefined ||
      !Number.isSafeInteger(cents) ||
      fee.amountMoney?.currency !== "USD" ||
      !fee.effectiveAt ||
      !z.iso.datetime({ offset: true }).safeParse(fee.effectiveAt).success ||
      (fee.type !== "INITIAL" && fee.type !== "ADJUSTMENT")
    )
      return [];
    return [
      {
        effectiveAt: fee.effectiveAt,
        type: fee.type,
        adjustment: cents < 0 ? "credit" : "charge",
        amountCents: Math.abs(cents),
      },
    ];
  });
  return {
    ...(reference &&
    z.uuid().safeParse(reference).success &&
    attempt &&
    z.uuid().safeParse(attempt).success &&
    attempt[14] === "8"
      ? { orderReference: reference, attemptId: attempt }
      : {}),
    ...(fees.length ? { fees } : {}),
    ...(payment.updatedAt &&
    z.iso.datetime({ offset: true }).safeParse(payment.updatedAt).success
      ? { resolvedAt: payment.updatedAt }
      : {}),
  };
}

export function squarePaymentDetails(payment: {
  sourceType?: string;
  walletDetails?: { brand?: string | null };
  buyNowPayLaterDetails?: { brand?: string | null };
  cardDetails?: {
    card?: {
      cardBrand?: string | null;
      last4?: string | null;
      expMonth?: bigint | number | null;
      expYear?: bigint | number | null;
    };
    avsStatus?: string | null;
    cvvStatus?: string | null;
  };
}) {
  const card = payment.cardDetails?.card;
  return {
    source_type: payment.sourceType ?? null,
    payment_method:
      payment.walletDetails?.brand === "CASH_APP"
        ? "cashAppPay"
        : ["AFTERPAY", "CLEARPAY"].includes(payment.buyNowPayLaterDetails?.brand ?? "")
          ? "afterpay"
          : null,
    card_type: card?.cardBrand ?? null,
    card_last4: card?.last4 ?? null,
    card_expiry_month: card?.expMonth ? Number(card.expMonth) : null,
    card_expiry_year: card?.expYear ? Number(card.expYear) : null,
    avs_result_code: payment.cardDetails?.avsStatus ?? null,
    cvv2_result_code: payment.cardDetails?.cvvStatus ?? null,
  };
}

export type SquarePaymentDetails = ReturnType<typeof squarePaymentDetails>;

export async function recordSquarePaymentDetails(
  db: TypedSupabaseClient,
  input: {
    squareOrderId: string;
    paymentId: string;
    status: string;
    amountCents: number;
    currency: string;
    details: Partial<SquarePaymentDetails>;
  },
) {
  const { error } = await db.rpc("record_square_payment_details", {
    p_square_order_id: input.squareOrderId,
    p_square_payment_id: input.paymentId,
    p_payment_status: input.status,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_details: input.details,
  });
  if (error) throw error;
}
