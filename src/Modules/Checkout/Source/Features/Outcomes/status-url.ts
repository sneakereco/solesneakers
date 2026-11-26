export function buildCheckoutStatusUrl(
  orderId: string,
  token: string | null,
  reconcile: boolean,
): string {
  const query = new URLSearchParams();
  if (token) {
    query.set("token", token);
  }
  if (reconcile) {
    query.set("reconcile", "1");
  }
  const suffix = query.toString();
  return `/api/orders/${encodeURIComponent(orderId)}${suffix ? `?${suffix}` : ""}`;
}
