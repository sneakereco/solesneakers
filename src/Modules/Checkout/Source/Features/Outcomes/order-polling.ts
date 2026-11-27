import { buildCheckoutStatusUrl } from "./status-url";
import { classifyObservedOrder, orderStatus, type Outcome } from "./outcome-contract";
export function pollOrder(
  orderId: string,
  credential: string | null,
  signal: AbortSignal,
  publish: (state: Outcome) => void,
) {
  const request = new AbortController();
  const expires = Date.now() + 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let calls = 0;
  let inFlight = false;
  let retryAfter = 0;
  const deadline = setTimeout(() => finish({ state: "delayed" }), 60_000);
  function stop() {
    clearTimeout(deadline);
    clearTimeout(timer);
    request.abort();
    signal.removeEventListener("abort", stop);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", visible);
  }
  function finish(outcome: Outcome) {
    if (request.signal.aborted) return;
    stop();
    publish(outcome);
  }
  function visible() {
    if (document.visibilityState === "visible" && !inFlight && Date.now() >= retryAfter) {
      clearTimeout(timer);
      void poll();
    }
  }
  async function poll() {
    if (request.signal.aborted) return;
    if (Date.now() >= expires) return finish({ state: "delayed" });
    calls++;
    inFlight = true;
    try {
      const response = await fetch(
        buildCheckoutStatusUrl(orderId, credential, calls === 2 || calls % 3 === 0),
        { cache: "no-store", signal: request.signal },
      );
      if (request.signal.aborted) return;
      if (Date.now() >= expires) return finish({ state: "delayed" });
      if (response.status === 401 || response.status === 403)
        return finish({ state: "denied" });
      if (response.status === 400 || response.status === 404)
        return finish({ state: "error" });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (request.signal.aborted) return;
        if (Date.now() >= expires) return finish({ state: "delayed" });
        const receipt = orderStatus.safeParse(data);
        if (!receipt.success || receipt.data.id !== orderId)
          return finish({ state: "error" });
        const order = receipt.data;
        const state = classifyObservedOrder(order);
        if (state !== "waiting") return finish({ state, order });
      } else {
        const after = response.headers?.get("Retry-After");
        if (after) {
          const when = /^\d+$/.test(after)
            ? Date.now() + Number(after) * 1000
            : Date.parse(after);
          if (Number.isFinite(when)) retryAfter = when;
        }
      }
    } catch {
      /* Transient transport failures share the observation deadline. */
    } finally {
      inFlight = false;
    }
    if (!request.signal.aborted) {
      const interval =
        calls === 1
          ? 500
          : Math.min(
              5000,
              1000 * 2 ** Math.min(3, calls - 2) * (0.9 + 0.2 * Math.random()),
            );
      timer = setTimeout(
        () => void poll(),
        Math.min(expires - Date.now(), Math.max(interval, retryAfter - Date.now())),
      );
    }
  }
  if (signal.aborted) {
    stop();
    return stop;
  }
  signal.addEventListener("abort", stop, { once: true });
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", visible);
  void poll();
  return stop;
}
