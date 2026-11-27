export const SESSION_UPDATE = "sessionUpdate";
export const SESSION_REVALIDATING = "sessionRevalidating";
export function notifySessionUpdate() {
  window.dispatchEvent(new Event(SESSION_UPDATE));
}
