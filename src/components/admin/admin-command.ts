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
/** Admit or relax a provider guard only when its prior and next values can be verified in this tab. */
export function transitionProviderCheck(
  key: string,
  expected: string | null,
  next: string | null,
) {
  const storageKey = "admin-check:" + key;
  if (pendingChecks.has(key) && pendingChecks.get(key) !== expected) return false;
  try {
    if (sessionStorage.getItem(storageKey) !== expected) return false;
    if (next === null) sessionStorage.removeItem(storageKey);
    else sessionStorage.setItem(storageKey, next);
    if (sessionStorage.getItem(storageKey) !== next) return false;
  } catch {
    return false;
  }
  if (next === null) pendingChecks.delete(key);
  else pendingChecks.set(key, next);
  return true;
}
export function pendingProviderCheck(key: string) {
  if (pendingChecks.has(key)) return pendingChecks.get(key);
  try {
    return sessionStorage.getItem("admin-check:" + key);
  } catch {
    return null;
  }
}
