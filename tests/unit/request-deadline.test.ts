import { fetchJsonWithDeadline, withRequestDeadline } from "@/lib/http/request-deadline";

function holdJsonResponseBody() {
  return jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("The body read needs the request abort signal");

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"products":'));
        signal.addEventListener("abort", () => controller.error(signal.reason), {
          once: true,
        });
      },
    });

    return Promise.resolve(new Response(body, { status: 200 }));
  });
}

describe("browser request deadline", () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("still cancels a held JSON body after the successful response headers arrive", async () => {
    const fetch = holdJsonResponseBody();
    const parent = new AbortController();
    const result = fetchJsonWithDeadline(
      "/products",
      "Could not read products",
      parent.signal,
    );
    const failure = expect(result).rejects.toMatchObject({ name: "TimeoutError" });

    await jest.advanceTimersByTimeAsync(14_999);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await failure;

    expect(parent.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("preserves the caller's abort reason even when JSON decoding rejects", async () => {
    holdJsonResponseBody();
    const parent = new AbortController();
    const result = fetchJsonWithDeadline(
      "/products",
      "Could not read products",
      parent.signal,
    );
    const reason = new DOMException("Superseded", "AbortError");
    const failure = expect(result).rejects.toBe(reason);

    await jest.advanceTimersByTimeAsync(0);
    parent.abort(reason);
    await failure;

    expect(jest.getTimerCount()).toBe(0);
  });

  it("detaches the parent listener and deadline after a completed read", async () => {
    const parent = new AbortController();
    const requestSignal = await withRequestDeadline(
      (signal) => Promise.resolve(signal),
      parent.signal,
    );
    parent.abort();

    expect(requestSignal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
