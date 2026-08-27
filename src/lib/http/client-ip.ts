import type { NextRequest } from "next/server";

export function getTrustedClientIp(request: NextRequest): string | null {
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for");
  const firstVercelIp = vercelForwardedFor?.split(",")[0]?.trim();
  if (firstVercelIp) {
    return firstVercelIp;
  }

  const hostname = request.nextUrl.hostname;
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!isLocal) {
    return null;
  }

  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
