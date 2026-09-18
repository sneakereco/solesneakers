export function paymentMethodLabel(method: string | null | undefined): string | null {
  const labels: Record<string, string> = {
    card: "Credit card",
    applePay: "Apple Pay",
    googlePay: "Google Pay",
    afterpay: "Afterpay",
    cashAppPay: "Cash App Pay",
  };
  return method ? (labels[method] ?? null) : null;
}
