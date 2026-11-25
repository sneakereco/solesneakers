import { z } from "zod";
import { attemptCredentialsSchema, type AttemptCredentials } from "./claim-contract";
export type SavedAttempt = AttemptCredentials & { productId: string };
const savedSchema = attemptCredentialsSchema
  .extend({ productId: z.string().uuid() })
  .strict();
export const ATTEMPT_STORAGE_KEY = "sole:specialty:attempts:v1";
export const ATTEMPT_CHANGED_EVENT = "specialty-attempt-updated";
const memory = new Map<string, SavedAttempt>();
let durable = true;
export function hasDurableAttemptStorage(): boolean {
  return durable;
}
export function createAttempt(productId: string): SavedAttempt {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return savedSchema.parse({
    productId,
    attemptId: crypto.randomUUID(),
    recoverySecret: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
  });
}
export function readSavedAttempts(): SavedAttempt[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
    let decoded: unknown;
    try {
      decoded = raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
    const parsed = z.array(savedSchema).max(100).safeParse(decoded);
    if (!parsed.success) return [];
    durable = true;
    parsed.data.forEach((attempt) => memory.set(attempt.productId, attempt));
    return parsed.data;
  } catch {
    durable = false;
    return [...memory.values()];
  }
}
export function readAttempt(productId: string): SavedAttempt | null {
  return readSavedAttempts().find((attempt) => attempt.productId === productId) ?? null;
}
export function saveAttempt(attempt: SavedAttempt): void {
  const safe = savedSchema.parse(attempt);
  const attempts = readSavedAttempts();
  const previous = attempts.find((item) => item.productId === safe.productId);
  if (
    previous &&
    (previous.attemptId !== safe.attemptId ||
      previous.recoverySecret !== safe.recoverySecret)
  )
    throw new Error("Keep the original claim attempt to check its result.");
  const next = [
    ...attempts.filter((item) => item.productId !== safe.productId),
    safe,
  ].slice(-100);
  memory.set(safe.productId, safe);
  try {
    window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(next));
    durable = true;
  } catch {
    durable = false;
  }
  if (typeof window !== "undefined")
    window.dispatchEvent?.(new Event(ATTEMPT_CHANGED_EVENT));
}
