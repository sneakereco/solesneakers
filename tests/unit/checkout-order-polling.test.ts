import { startCheckoutOrderPolling } from "@/lib/checkout/checkout-order-polling";

const orderId = "10000000-0000-4000-8000-000000000001";
const pending = {
  id: orderId,
  status: "pending",
  subtotal: 0,
  shipping: 0,
  tax: 0,
  total: 0,
  fulfillment: "ship",
  updatedAt: "2026-11-24T00:00:00Z",
  events: [],
  financial: { source: "legacy" },
  supportEmail: "support@example.com",
  purchasedLines: null,
};
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
      .mockImplementation(() => Promise.resolve(Response.json(pending)));
    const onState = jest.fn();
    startCheckoutOrderPolling(orderId, null, onState);
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
    startCheckoutOrderPolling(orderId, null, onState);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onState).toHaveBeenLastCalledWith("delayed");
    expect(jest.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolveResponse(Response.json({ status: "paid" }));
    await jest.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenLastCalledWith("delayed");
  });

  it("reconciles after 500ms and returns the verified paid order", async () => {
    const paidOrder = {
      id: orderId,
      status: "paid",
      subtotal: 100,
      shipping: 0,
      tax: 8,
      total: 108,
      fulfillment: "pickup",
      updatedAt: "2026-09-16T00:00:00.000Z",
      purchasedLines: null,
      events: [],
      financial: { source: "legacy" },
      supportEmail: "support@example.com",
    };
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(Response.json(pending))
      .mockResolvedValueOnce(Response.json(paidOrder));
    const onState = jest.fn();
    startCheckoutOrderPolling(orderId, "guest-token", onState);
    await jest.advanceTimersByTimeAsync(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(jest.mocked(fetch).mock.calls[1][0]).toContain("reconcile=1");
    expect(onState).toHaveBeenLastCalledWith("paid", paidOrder);
  });

  it.each([
    { id: "wrong" },
    { total: null },
    { updatedAt: "1" },
    { status: "paid", events: [{ type: 4 }] },
    { fulfillment: "unexpected" },
  ])("rejects incomplete or foreign observations", async (changed) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(Response.json({ ...pending, status: "paid", ...changed }));
    const onState = jest.fn();
    startCheckoutOrderPolling(orderId, null, onState);
    await jest.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenCalledWith("error");
  });
  it("rejects a non-UUID response even when it repeats the malformed requested identifier", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(Response.json({ ...pending, id: "invalid", status: "paid" }));
    const onState = jest.fn();
    startCheckoutOrderPolling("invalid", null, onState);
    await jest.advanceTimersByTimeAsync(0);
    expect(onState).toHaveBeenCalledWith("error");
  });
  it("cancels polling when the page unmounts", async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(pending));
    const onState = jest.fn();
    const stop = startCheckoutOrderPolling(orderId, null, onState);
    stop();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onState).not.toHaveBeenCalled();
  });
});
