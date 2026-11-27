import { observeCheckoutOutcome } from "@/Modules/Checkout/Source/Features/Outcomes/outcome-observer";
import type { OrderStatusResponse } from "@/types/domain/checkout";
export type CheckoutConfirmationState =
  | "paid"
  | "delayed"
  | "review"
  | "error"
  | "unauthorized";
export function startCheckoutOrderPolling(
  orderId: string,
  token: string | null,
  onState: (state: CheckoutConfirmationState, order?: OrderStatusResponse) => void,
) {
  return observeCheckoutOutcome({
    orderId,
    credential: token,
    identityGeneration: () => true,
    signal: new AbortController().signal,
    onState: ({ state, order }) => {
      if (state === "confirmed") onState("paid", order);
      else if (state !== "waiting")
        onState(
          state === "denied" ? "unauthorized" : state === "refunded" ? "review" : state,
        );
    },
  });
}
