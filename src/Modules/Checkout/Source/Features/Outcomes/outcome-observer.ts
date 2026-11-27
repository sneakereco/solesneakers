import { pollOrder } from "./order-polling";
import type { Outcome } from "./outcome-contract";
export function observeCheckoutOutcome({
  orderId,
  credential,
  identityGeneration,
  signal,
  onState,
}: {
  orderId: string;
  credential: string | null;
  identityGeneration: () => boolean;
  signal: AbortSignal;
  onState: (value: Outcome) => void;
}) {
  if (signal.aborted || !identityGeneration()) return () => {};
  onState({ state: "waiting" });
  return pollOrder(orderId, credential, signal, (value) => {
    if (!signal.aborted && identityGeneration()) onState(value);
  });
}
