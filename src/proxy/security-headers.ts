// src/proxy/security-headers.ts
import type { NextResponse } from "next/server";

import { security } from "@/config/security";
import { env } from "@/config/env";

export function applySecurityHeaders(
  response: NextResponse,
  nodeEnv: string = env.NODE_ENV ?? "development",
  pathname = "/",
): void {
  const isDev = nodeEnv !== "production";
  const { securityHeaders } = security.proxy;
  const botIdPrefix = security.proxy.bot.internalProxyPrefix;
  const isBotIdProxyRoute =
    pathname === botIdPrefix || pathname.startsWith(`${botIdPrefix}/`);

  response.headers.set("X-Frame-Options", isBotIdProxyRoute ? "SAMEORIGIN" : "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");

  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const cspHeader = isBotIdProxyRoute
    ? "frame-ancestors 'self'"
    : (isDev ? securityHeaders.csp.dev : securityHeaders.csp.prod).join("; ");
  response.headers.set("Content-Security-Policy", cspHeader);

  if (!isDev) {
    response.headers.set("Strict-Transport-Security", securityHeaders.hsts.value);
  }
}
