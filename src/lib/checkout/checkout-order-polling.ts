import { classifyCheckoutOrderStatus } from "@/lib/checkout/checkout-order-state";
import { buildCheckoutStatusUrl } from "@/lib/checkout/checkout-status-url";

export type CheckoutConfirmationState =
  | "paid"
  | "delayed"
  | "review"
  | "error"
  | "unauthorized";

export function startCheckoutOrderPolling(
  orderId: string,
  token: string | null,
  onState: (state: CheckoutConfirmationState) => void,
): () => void {
  let stopped = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const deadline = setTimeout(() => finish("delayed"), 60_000);

  function stop() {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(deadline);
    controller.abort();
  }

  function finish(state: CheckoutConfirmationState) {
    if (stopped) {
      return;
    }
    stop();
    onState(state);
  }

  async function poll() {
    attempts += 1;
    try {
      const response = await fetch(
        buildCheckoutStatusUrl(orderId, token, attempts % 3 === 0),
        { cache: "no-store", signal: controller.signal },
      );
      const data = await response.json().catch(() => null);
      if (stopped) {
        return;
      }
      if (response.status === 401) {
        return finish("unauthorized");
      }
      if (response.status === 404) {
        return finish("error");
      }
      if (response.ok) {
        const state = classifyCheckoutOrderStatus(String(data?.status ?? ""));
        if (state !== "waiting") {
          return finish(state === "exception" ? "error" : state);
        }
      }
    } catch {
      // Transient failures can retry until the wall-clock deadline.
    }
    if (!stopped) {
      timer = setTimeout(() => void poll(), 2_000);
    }
  }

  void poll();
  return stop;
}
