"use client";
import { isUuid, type ConsentState } from "./contract";
import { revokeMeasurement } from "./client";
import { markWithdrawal, withdrawalPending } from "./preference-marker";

async function requestChoice(choice?: "accepted" | "declined"): Promise<ConsentState> {
  const response = await fetch("/api/analytics/preferences", {
    cache: "no-store",
    credentials: "same-origin",
    ...(choice
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choice }),
        }
      : {}),
  });
  if (!response.ok) throw new Error("Preference unavailable");
  const data = await response.json();
  if (
    data?.choice === "accepted" &&
    isUuid(data.receiptId) &&
    (!choice || choice === "accepted")
  )
    return { choice: "accepted", receiptId: data.receiptId };
  if (data?.choice === "declined" && (!choice || choice === "declined"))
    return { choice: "declined" };
  if (!choice && data?.choice === "unknown") return { choice: "unknown" };
  throw new Error("Invalid preference response");
}
async function writeChoice(choice: "accepted" | "declined"): Promise<ConsentState> {
  const write = (): Promise<ConsentState> =>
    choice === "accepted" && withdrawalPending()
      ? Promise.resolve({ choice: "declined", pending: true })
      : requestChoice(choice);
  // Serialized HTTP responses let simultaneous tabs reuse the same HttpOnly grant cookie.
  if (window.navigator?.locks) {
    const result = await window.navigator.locks.request(
      "sole-analytics-preference",
      write,
    );
    return result;
  }
  if (choice === "accepted")
    throw new Error("Browser cannot coordinate an analytics grant");
  return write();
}
export async function setAnalyticsConsent(
  choice: "accepted" | "declined",
): Promise<ConsentState> {
  if (choice === "declined") {
    markWithdrawal(true);
    revokeMeasurement();
    try {
      const state = await writeChoice(choice);
      markWithdrawal(false);
      return state;
    } catch {
      return { choice: "declined", pending: true };
    }
  }
  if (withdrawalPending()) return { choice: "declined", pending: true };
  return writeChoice(choice);
}
export async function getAnalyticsConsent(): Promise<ConsentState> {
  if (withdrawalPending()) return setAnalyticsConsent("declined");
  const state = await requestChoice();
  return withdrawalPending() ? { choice: "declined", pending: true } : state;
}
