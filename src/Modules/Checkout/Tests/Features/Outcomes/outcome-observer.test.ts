import { startCheckoutOrderPolling } from "@/lib/checkout/checkout-order-polling";
const id = "10000000-0000-4000-8000-000000000001";
test("a paid response for a different order cannot confirm the requested order", async () => {
  const original = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ id: "different", status: "paid" }),
  });
  const states: string[] = [];
  const stop = startCheckoutOrderPolling(id, null, (state) => states.push(state));
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(states).toEqual(["error"]);
  } finally {
    stop();
    global.fetch = original;
  }
});

import { observeCheckoutOutcome } from "../../../Source/Features/Outcomes/outcome-observer";
import type { Outcome } from "../../../Source/Features/Outcomes/outcome-contract";
const valid = {
  id,
  status: "paid",
  subtotal: 10,
  shipping: 0,
  tax: 0,
  total: 10,
  fulfillment: "pickup",
  updatedAt: "2026-11-25T00:00:00Z",
  events: [],
  supportEmail: "support@example.test",
};
describe("authorized outcome lifetime", () => {
  const original = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    global.fetch = original;
    jest.useRealTimers();
  });
  function observe(
    onState: (value: Outcome) => void,
    signal = new AbortController().signal,
  ) {
    return observeCheckoutOutcome({
      orderId: id,
      credential: "bound",
      identityGeneration: () => true,
      signal,
      onState,
    });
  }
  it.each([
    ["paid", true, "review"],
    ["refunded", false, "refunded"],
    ["partially_refunded", false, "refunded"],
    ["paid", false, "confirmed"],
  ])(
    "classifies %s review %s without trusting malformed purchase evidence",
    async (status, financialReview, state) => {
      global.fetch = jest.fn().mockResolvedValue(
        Response.json({
          ...valid,
          status,
          financialReview,
          purchasedLines: [{ quantity: -1 }],
        }),
      );
      const onState = jest.fn();
      observe(onState);
      await jest.advanceTimersByTimeAsync(0);
      expect(onState).toHaveBeenLastCalledWith({
        state,
        order: expect.objectContaining({ purchasedLines: null }),
      });
    },
  );
  it("finishes at 60 seconds even when a successful HTTP body never settles", async () => {
    const onState = jest.fn();
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
    observe(onState);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onState).toHaveBeenLastCalledWith({ state: "delayed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("respects Retry-After and discards a superseded credential before the next read", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { "Retry-After": "6" } }),
      );
    const controller = new AbortController();
    const onState = jest.fn();
    observe(onState, controller.signal);
    await jest.advanceTimersByTimeAsync(5999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    controller.abort();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onState).toHaveBeenCalledTimes(1);
  });
});
