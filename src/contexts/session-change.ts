"use client";

export const sessionGenerationKey = "rdk_session_generation";
export function readSessionGeneration() {
  try {
    return localStorage.getItem(sessionGenerationKey);
  } catch {
    return null;
  }
}
export function publishSessionChange() {
  const generation = crypto.randomUUID();
  try {
    localStorage.setItem(sessionGenerationKey, generation);
  } catch {
    // Storage can be disabled independently of same-origin messaging.
    try {
      const channel = new BroadcastChannel(sessionGenerationKey);
      channel.postMessage(generation);
      channel.close();
    } catch {
      /* Visibility recovery verifies cookies when the shopper returns. */
    }
  }
  window.dispatchEvent(new Event("sessionUpdate"));
}
export async function signOutAndNotify() {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok || (await response.json()).ok !== true)
    throw Error("Failed to log out. Please try again.");
  publishSessionChange();
}
