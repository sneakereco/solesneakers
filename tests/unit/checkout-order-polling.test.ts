import { startCheckoutOrderPolling } from "@/lib/checkout/checkout-order-polling";

describe("checkout order polling", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it("stops pending orders after 60 seconds instead of polling forever", async () => {
    global.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ status: "pending" })));
    const onState = jest.fn();
    startCheckoutOrderPolling("order-1", null, onState);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onState).toHaveBeenLastCalledWith("delayed");
    const requests = jest.mocked(fetch).mock.calls.length;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(requests);
  });

  it("bounds a hung request and ignores a response after cancellation", async () => {
    let resolveResponse!: (response: Response) => void;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const onState = jest.fn();
    startCheckoutOrderPolling("order-1", null, onState);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onState).toHaveBeenLastCalledWith("delayed");
    expect(jest.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolveResponse(Response.json({ status: "paid" }));
    await jest.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenLastCalledWith("delayed");
  });

  it("reconciles after 500ms and returns the verified paid order", async () => {
    const paidOrder = {
      id: "order-1",
      status: "paid",
      subtotal: 100,
      shipping: 0,
      tax: 8,
      total: 108,
      fulfillment: "pickup",
      updatedAt: "2026-09-16T00:00:00.000Z",
      events: [],
      supportEmail: "support@example.com",
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "pending" }))
      .mockResolvedValueOnce(Response.json(paidOrder));
    const onState = jest.fn();
    startCheckoutOrderPolling("order-1", "guest-token", onState);
    await jest.advanceTimersByTimeAsync(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jest.mocked(fetch).mock.calls[1][0]).toContain("reconcile=1");
    expect(onState).toHaveBeenLastCalledWith("paid", paidOrder);
  });

  it("cancels polling when the page unmounts", async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json({ status: "pending" }));
    const onState = jest.fn();
    const stop = startCheckoutOrderPolling("order-1", null, onState);
    stop();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onState).not.toHaveBeenCalled();
  });
});
