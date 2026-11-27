import { readJsonResponse } from "./read-json-response";

const REQUEST_DEADLINE_MS = 15_000;

export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = REQUEST_DEADLINE_MS,
): Promise<T> {
  if (parentSignal?.aborted) throw parentSignal.reason;

  const controller = new AbortController();
  const cancel = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  let onAbort: (() => void) | undefined;
  try {
    // SDK calls can ignore the signal. Stop waiting even when the underlying work continues.
    const result = await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      request(controller.signal).then(resolve, reject);
    });
    if (controller.signal.aborted) throw controller.signal.reason;
    return result;
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", cancel);
  }
}

export function fetchJsonWithDeadline<T>(
  url: string,
  fallbackMessage: string,
  parentSignal: AbortSignal,
): Promise<T> {
  return withRequestDeadline(
    async (signal) => readJsonResponse<T>(await fetch(url, { signal }), fallbackMessage),
    parentSignal,
  );
}
