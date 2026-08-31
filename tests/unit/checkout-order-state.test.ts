import { classifyCheckoutOrderStatus } from "@/lib/checkout/checkout-order-state";

describe("classifyCheckoutOrderStatus", () => {
  it.each(["pending", "processing"])("keeps polling for %s", (status) => {
    expect(classifyCheckoutOrderStatus(status)).toBe("waiting");
  });

  it.each(["paid", "shipped"])("accepts webhook-authorized %s", (status) => {
    expect(classifyCheckoutOrderStatus(status)).toBe("paid");
  });

  it("holds a risk-reviewed payment out of fulfillment", () => {
    expect(classifyCheckoutOrderStatus("review")).toBe("review");
  });

  it.each([
    "failed",
    "blocked",
    "canceled",
    "refunded",
    "partially_refunded",
    "refund_pending",
    "refund_failed",
  ])("treats %s as a terminal exception", (status) => {
    expect(classifyCheckoutOrderStatus(status)).toBe("exception");
  });
});
