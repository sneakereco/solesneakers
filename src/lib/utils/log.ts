import { sanitizeLifecycleEvent } from "@/Modules/Checkout/Source/Features/Operations/lifecycle-event";

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

export function log(entry: LogEntry) {
  const safe = sanitizeLifecycleEvent({
    ...entry,
    release: entry.release ?? process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...safe });
  if (safe.level === "error") console.error(line);
  else if (safe.level === "warn") console.warn(line);
  else console.info(line);
}

export function logError(_error: unknown, entry: Partial<LogEntry> = {}) {
  log({ message: "application_error", layer: "unknown", ...entry, level: "error" });
}
