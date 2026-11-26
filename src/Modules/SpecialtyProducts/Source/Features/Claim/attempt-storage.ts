import { z } from "zod";
import { attemptCredentialsSchema, type AttemptCredentials } from "./claim-contract";
export type SavedAttempt = AttemptCredentials & { productId: string };
const savedSchema = attemptCredentialsSchema
  .extend({ productId: z.string().uuid() })
  .strict();
export const ATTEMPT_STORAGE_KEY = "sole:specialty:attempts:v1";
export const ATTEMPT_CHANGED_EVENT = "specialty-attempt-updated";
const memory = new Map<string, SavedAttempt>();
const unsaved = new Set<string>();
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
      durable = false;
      return [...memory.values()];
    }
    const parsed = z.array(savedSchema).max(100).safeParse(decoded);
    if (!parsed.success) {
      durable = false;
      return [...memory.values()];
    }
    const merged = new Map(parsed.data.map((attempt) => [attempt.productId, attempt]));
    for (const [id, attempt] of memory)
      if (unsaved.has(id) || !merged.has(id)) merged.set(id, attempt);
    const next = [...merged.values()].slice(-100);
    memory.clear();
    next.forEach((attempt) => memory.set(attempt.productId, attempt));
    for (const id of unsaved) if (!memory.has(id)) unsaved.delete(id);
    // A successful read says nothing about write durability.
    return next;
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
  persistAttempts(next);
}
// Caller must have recovered a committed closed decision. Never use for an
// unknown result or a winner: those credentials must remain recoverable.
export function replaceClosedAttempt(previous: SavedAttempt): SavedAttempt {
  const safe = savedSchema.parse(previous),
    current = readAttempt(safe.productId);
  if (
    !current ||
    current.attemptId !== safe.attemptId ||
    current.recoverySecret !== safe.recoverySecret
  )
    throw new Error("Check the current claim result before starting a new attempt.");
  const next = createAttempt(safe.productId);
  persistAttempts(
    [
      ...readSavedAttempts().filter((item) => item.productId !== safe.productId),
      next,
    ].slice(-100),
  );
  return next;
}
function persistAttempts(next: SavedAttempt[]): void {
  memory.clear();
  next.forEach((attempt) => {
    memory.set(attempt.productId, attempt);
    unsaved.add(attempt.productId);
  });
  try {
    window.sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(next));
    durable = true;
    unsaved.clear();
  } catch {
    durable = false;
  }
  if (typeof window !== "undefined")
    window.dispatchEvent?.(new Event(ATTEMPT_CHANGED_EVENT));
}
