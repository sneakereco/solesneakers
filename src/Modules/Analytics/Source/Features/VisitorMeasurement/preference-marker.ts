// Essential, identifier-free preference state survives an offline withdrawal.
export const withdrawalKey = "sole_analytics_withdrawal_pending";
let inMemory = false;
export function withdrawalPending() {
  try {
    if (window.localStorage.getItem(withdrawalKey) === "1") return true;
  } catch {
    /* Cookie fallback. */
  }
  return (
    inMemory ||
    (typeof document !== "undefined" &&
      document.cookie?.split("; ").includes(withdrawalKey + "=1"))
  );
}
export function markWithdrawal(value: boolean) {
  inMemory = value;
  try {
    if (value) window.localStorage.setItem(withdrawalKey, "1");
    else window.localStorage.removeItem(withdrawalKey);
    inMemory = false;
  } catch {
    /* Cookie fallback. */
  }
  if (typeof document !== "undefined")
    document.cookie =
      withdrawalKey +
      "=" +
      (value ? "1" : "") +
      "; Path=/; Secure; SameSite=Strict; Max-Age=" +
      (value ? 31536000 : 0);
}
