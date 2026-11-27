export type CheckoutOrderState =
  | "waiting"
  | "paid"
  | "review"
  | "exception"
  | "declined"
  | "failed"
  | "canceled";

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
  if (status === "failed" || status === "canceled" || status === "declined")
    return status;
  return "exception";
}
