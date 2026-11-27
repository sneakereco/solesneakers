import { sanitizeLifecycleEvent } from "@/Modules/Checkout/Source/Features/Operations/lifecycle-event";
import { errorDiagnostics } from "@/Modules/Checkout/Source/Features/Operations/error-diagnostics";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogLayer =
  | "proxy"
  | "auth"
  | "api"
  | "service"
  | "repository"
  | "job"
  | "cache"
  | "infra"
  | "lib"
  | "observability"
  | "frontend"
  | "unknown";
export interface LogEntry {
  level: LogLevel;
  layer: LogLayer;
  message: string;
  [key: string]: unknown;
}

export function log(input: LogEntry | (() => LogEntry)) {
  try {
    const entry = typeof input === "function" ? input() : input;
    const safe = sanitizeLifecycleEvent({
      ...entry,
      release: entry.release ?? process.env.VERCEL_GIT_COMMIT_SHA,
    });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...safe });
    if (safe.level === "error") console.error(line);
    else if (safe.level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    // Emission is best effort. Retrying a failing sink here could recurse or disturb committed work.
  }
}

export function logError(error: unknown, entry: Partial<LogEntry> = {}) {
  log(() => ({
    message: "application_error",
    layer: "unknown",
    ...entry,
    ...errorDiagnostics(error),
    level: "error",
  }));
}
