import { checkoutStatusLabel } from "@/lib/orders/checkout-status-label";

it("distinguishes expired closure from an outstanding pending checkout", () => {
  expect(checkoutStatusLabel("canceled", "checkout_expired")).toBe("Checkout expired");
  expect(
    checkoutStatusLabel(
      "pending",
      null,
      "2026-11-27T10:00:00Z",
      Date.parse("2026-11-27T11:00:00Z"),
    ),
  ).toBe("Payment window expired · awaiting verification");
  expect(
    checkoutStatusLabel(
      "pending",
      null,
      "2026-11-27T12:00:00Z",
      Date.parse("2026-11-27T11:00:00Z"),
    ),
  ).toBe("Checkout pending");
});
it("does not relabel actual cancellations or paid orders as expiration", () => {
  expect(checkoutStatusLabel("canceled", "customer_requested")).toBe("Canceled");
  expect(checkoutStatusLabel("paid", "checkout_expired")).toBeNull();
});
