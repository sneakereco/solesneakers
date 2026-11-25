import { readJsonResponse } from "./read-json-response";

const REQUEST_DEADLINE_MS = 15_000;

export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw parentSignal.reason;

  const controller = new AbortController();
  const cancel = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, REQUEST_DEADLINE_MS);

  try {
    const result = await request(controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    return result;
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
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
