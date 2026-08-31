export type CheckoutOrderState = "waiting" | "paid" | "review" | "exception";

export function classifyCheckoutOrderStatus(status: string): CheckoutOrderState {
  if (status === "paid" || status === "shipped") {
    return "paid";
  }
  if (status === "review") {
    return "review";
  }
  if (status === "pending" || status === "processing") {
    return "waiting";
  }
  return "exception";
}
