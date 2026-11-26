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
      .mockImplementation(() =>
        Promise.resolve(Response.json({ id: "order-1", status: "pending" })),
      );
    const onState = jest.fn();
    startCheckoutOrderPolling("order-1", null, onState);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onState).toHaveBeenLastCalledWith("delayed");
    const requests = jest.mocked(fetch).mock.calls.length;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(requests);
  });

  it.each([
    {
      id: "another",
      status: "paid",
      subtotal: 1,
      tax: 0,
      shipping: 0,
      total: 1,
      fulfillment: "pickup",
    },
    { id: "order-1", status: "paid" },
  ])("rejects malformed or mismatched paid evidence", async (data) => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(data));
    const state = jest.fn();
    startCheckoutOrderPolling("order-1", null, state);
    await jest.advanceTimersByTimeAsync(0);
    expect(state).toHaveBeenCalledWith("error");
  });

  it.each(["review", "pending", "processing", "failed"])(
    "rejects another order before classifying %s",
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(Response.json({ id: "different-order", status }));
      const state = jest.fn();
      startCheckoutOrderPolling("order-1", null, state);
      await jest.advanceTimersByTimeAsync(0);
      expect(state).toHaveBeenCalledWith("error");
    },
  );

  it("handles forbidden evidence without retrying", async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json({}, { status: 403 }));
    const state = jest.fn();
    startCheckoutOrderPolling("order-1", null, state);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenCalledWith("unauthorized");
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
      .mockResolvedValueOnce(Response.json({ id: "order-1", status: "pending" }))
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
    global.fetch = jest
      .fn()
      .mockResolvedValue(Response.json({ id: "order-1", status: "pending" }));
    const onState = jest.fn();
    const stop = startCheckoutOrderPolling("order-1", null, onState);
    stop();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onState).not.toHaveBeenCalled();
  });
});
