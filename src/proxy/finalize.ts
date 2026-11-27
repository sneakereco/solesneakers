// src/proxy/finalize.ts
import type { NextResponse } from "next/server";

import { applySecurityHeaders } from "@/proxy/security-headers";
import { security } from "@/config/security";

export function finalizeProxyResponse(
  response: NextResponse,
  requestId: string,
  pathname = "/",
): NextResponse {
  response.headers.set(security.proxy.requestIdHeader, requestId);
  if (
    [
      "/api/specialty/eligibility",
      "/api/specialty/claims",
      "/api/specialty/claims/result",
      "/admin/specialty-claims",
    ].includes(pathname) ||
    pathname.startsWith("/api/admin/specialty/")
  ) {
    // This also covers responses returned before the route handler (auth, CSRF, and throttling).
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  applySecurityHeaders(response, undefined, pathname);
  return response;
}
