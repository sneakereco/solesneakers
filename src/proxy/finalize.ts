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
  applySecurityHeaders(response, undefined, pathname);
  return response;
}
