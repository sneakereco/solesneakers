import type { TypedSupabaseClient } from "@/lib/supabase/server";

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
    // Keep historical transaction fields readable. New provider observations
    // write only the method and source class required by checkout.
    p_details: {
      source_type: input.details.source_type ?? null,
      payment_method: input.details.payment_method ?? null,
    },
  });
  if (error) throw error;
}
