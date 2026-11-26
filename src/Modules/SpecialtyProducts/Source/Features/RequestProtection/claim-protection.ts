import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProtectionDecision } from "../Claim/claim-contract";
export const SPECIALTY_QUOTAS = {
  validate: { browser: 10, ip: 300 },
  submit: { browser: 10, ip: 2000 },
  recover: { browser: 60, ip: 5000 },
} as const;
export const SPECIALTY_BROWSER_COOKIE = "specialty_browser";
export const SPECIALTY_BROWSER_TTL_SECONDS = 86400;
export type ProtectionDependencies = {
  siteOrigin: string;
  key: string;
  getIp(request: Request): string | null;
  storeOpen(): Promise<boolean>;
  verifyBrowser(): Promise<{ allowed: boolean; reason: string }>;
  limit(key: string, limit: number): Promise<{ success: boolean; reset: number }>;
};
function digest(value: string, key: string): string {
  return createHmac("sha256", key)
    .update("specialty-browser-v1." + value)
    .digest("hex");
}
export function signBrowserCookie(id: string, now: number, key: string): string {
  const value = Buffer.from(
    JSON.stringify({ id, expires: now + SPECIALTY_BROWSER_TTL_SECONDS * 1000 }),
  ).toString("base64url");
  return value + "." + digest(value, key);
}
export function readBrowserCookie(
  cookie: string | undefined,
  now: number,
  key: string,
): string | null {
  try {
    if (!cookie || cookie.length > 512) return null;
    const [value, signature, extra] = cookie.split(".");
    if (!/^[a-f0-9]{64}$/.test(signature)) return null;
    const expected = Buffer.from(digest(value, key), "hex"),
      supplied = Buffer.from(signature, "hex");
    if (
      extra ||
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      return null;
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed.id === "string" &&
      /^[a-zA-Z0-9-]{16,128}$/.test(parsed.id) &&
      parsed.expires > now
      ? parsed.id
      : null;
  } catch {
    return null;
  }
}
export async function checkSpecialtyProtection(
  request: Request,
  operation: keyof typeof SPECIALTY_QUOTAS,
  browserId: string,
  deps: ProtectionDependencies,
): Promise<ProtectionDecision> {
  const unavailable = { allowed: false, status: 503, retryAfterSeconds: 1 } as const;
  try {
    const origin = request.headers.get("origin");
    const expected = new URL(deps.siteOrigin).origin;
    if (
      origin !== expected ||
      new URL(request.url).origin !== expected ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return { allowed: false, status: 403 };
    const ip = deps.getIp(request);
    if (!ip || !browserId || !deps.key) return unavailable;
    const quota = SPECIALTY_QUOTAS[operation];
    const checks = await Promise.all([
      deps.limit(
        "specialty:" + operation + ":browser:" + digest(browserId, deps.key),
        quota.browser,
      ),
      deps.limit("specialty:" + operation + ":ip:" + digest(ip, deps.key), quota.ip),
    ]);
    const denied = checks.filter((value) => !value.success);
    if (denied.length)
      return {
        allowed: false,
        status: 429,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (Math.max(...denied.map((value) => value.reset)) - Date.now()) / 1000,
          ),
        ),
      };
    if (operation !== "recover") {
      if (!(await deps.storeOpen())) return unavailable;
      const verdict = await deps.verifyBrowser();
      if (!verdict.allowed)
        return verdict.reason === "bot" ? { allowed: false, status: 403 } : unavailable;
    }
    return { allowed: true };
  } catch {
    return unavailable;
  }
}
