import { squareCardStyle } from "@/components/checkout/square-card-style";
import type { SquarePaymentMethod, SquarePayments } from "@/lib/square/web-payments";

type CardInitializationPhase = "create" | "attach";

export async function initializeSquareCard<T extends Pick<SquarePayments, "card">>(
  payments: T,
  onPaymentsReady: (payments: T) => void,
  onPhase?: (phase: CardInitializationPhase) => void,
): Promise<SquarePaymentMethod> {
  onPaymentsReady(payments);
  onPhase?.("create");
  const card = await payments.card({ style: squareCardStyle });
  if (!card.attach) {
    throw new Error("square_card_attach_unavailable");
  }
  onPhase?.("attach");
  await card.attach("#square-card-container");
  return card;
}
