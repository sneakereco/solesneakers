import { buildCheckoutStatusUrl } from "@/lib/checkout/checkout-status-url";

describe("buildCheckoutStatusUrl", () => {
  it("adds the guest token and one-shot reconciliation query", () => {
    expect(buildCheckoutStatusUrl("order-1", "guest token", true)).toBe(
      "/api/orders/order-1?token=guest+token&reconcile=1",
    );
  });

  it("omits the query string when no options are present", () => {
    expect(buildCheckoutStatusUrl("order-1", null, false)).toBe("/api/orders/order-1");
  });
});
