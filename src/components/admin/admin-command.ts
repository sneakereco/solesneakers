import { withRequestDeadline } from "@/lib/http/request-deadline";

export function adminCommand<T>(url: string, init: RequestInit, parent?: AbortSignal) {
  return withRequestDeadline(async (signal) => {
    const response = await fetch(url, { ...init, signal });
    const data = (await response.json().catch(() => null)) as T | null;
    return { response, data };
  }, parent);
}

const pendingChecks = new Map<string, string>();
/** A lost response may follow a provider side effect. Keep the last observed evidence through a tab reload. */
export function rememberProviderCheck(key: string, evidence: string | null) {
  if (evidence === null) pendingChecks.delete(key);
  else pendingChecks.set(key, evidence);
  try {
    if (evidence === null) sessionStorage.removeItem("admin-check:" + key);
    else sessionStorage.setItem("admin-check:" + key, evidence);
  } catch {
    /* In-memory protection remains available. */
  }
}
export function pendingProviderCheck(key: string) {
  if (pendingChecks.has(key)) return pendingChecks.get(key);
  try {
    return sessionStorage.getItem("admin-check:" + key);
  } catch {
    return null;
  }
}
