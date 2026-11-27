import { readJsonResponse } from "@/lib/http/read-json-response";
import { withRequestDeadline } from "@/lib/http/request-deadline";

export const accountOwnerHeader = "X-Account-Owner";

export function fetchAccountJson<T>(
  ownerId: string,
  path: string,
  fallback: string,
  ownerSignal: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set(accountOwnerHeader, ownerId);
  return withRequestDeadline(async (signal) => {
    const response = await fetch(path, { ...init, headers, signal });
    return readJsonResponse<T>(response, fallback);
  }, ownerSignal);
}
