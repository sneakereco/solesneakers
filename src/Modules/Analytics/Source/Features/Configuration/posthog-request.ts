import "server-only";

export type PostHogRequestDependencies = {
  fetch: typeof fetch;
  now: () => Date;
  timeoutMs?: number;
};

export type PostHogFailure =
  | {
      status: "configuration-failure";
      reason: "not-configured" | "redirect" | "unauthorized" | "not-found";
    }
  | {
      status: "retryable";
      reason:
        | "timeout"
        | "network"
        | "rate-limited"
        | "provider-unavailable"
        | "invalid-response";
      retryAfterMs?: number;
    }
  | {
      status: "permanent-failure";
      reason: "provider-rejected";
    };

type PostHogResponse = { status: "ok"; data: unknown } | PostHogFailure;

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

function readRetryAfter(value: string | null, now: () => Date): number | undefined {
  if (!value) {
    return undefined;
  }
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now().getTime();
  return Number.isFinite(delay)
    ? Math.min(Math.max(delay, 0), MAX_RETRY_AFTER_MS)
    : undefined;
}

function classifyResponse(
  response: Response,
  now: PostHogRequestDependencies["now"],
): PostHogFailure | undefined {
  const { status } = response;

  if (
    response.redirected ||
    response.type === "opaqueredirect" ||
    (status >= 300 && status < 400)
  ) {
    return { status: "configuration-failure", reason: "redirect" };
  }
  if (response.ok) {
    return undefined;
  }
  if (status === 401 || status === 403) {
    return { status: "configuration-failure", reason: "unauthorized" };
  }
  if (status === 404) {
    return { status: "configuration-failure", reason: "not-found" };
  }
  if (status === 408 || status === 429 || status >= 500) {
    const reason =
      status === 408
        ? "timeout"
        : status === 429
          ? "rate-limited"
          : "provider-unavailable";
    const retryAfterMs = readRetryAfter(response.headers.get("retry-after"), now);
    return {
      status: "retryable",
      reason,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  return { status: "permanent-failure", reason: "provider-rejected" };
}

export async function requestPostHogJson(
  url: string,
  request: { headers: Record<string, string>; body: string },
  deps: PostHogRequestDependencies,
  maxTimeoutMs: number,
): Promise<PostHogResponse> {
  const timeoutMs = deps.timeoutMs ?? maxTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    return { status: "retryable", reason: "timeout" };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PostHogResponse>((resolve) => {
    timer = setTimeout(
      () => {
        resolve({ status: "retryable", reason: "timeout" });
        controller.abort();
      },
      Math.min(timeoutMs, maxTimeoutMs),
    );
  });

  const send = async (): Promise<PostHogResponse> => {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        ...request,
        method: "POST",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return { status: "retryable", reason: "network" };
    }

    const failure = classifyResponse(response, deps.now);
    if (failure || controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      return failure ?? { status: "retryable", reason: "timeout" };
    }

    try {
      return { status: "ok", data: (await response.json()) as unknown };
    } catch {
      return { status: "retryable", reason: "invalid-response" };
    }
  };

  try {
    const result = await Promise.race([deadline, send()]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
