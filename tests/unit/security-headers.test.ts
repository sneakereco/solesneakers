import { NextResponse } from "next/server";

import { applySecurityHeaders } from "@/proxy/security-headers";

function directives(csp: string | null): Map<string, string[]> {
  return new Map(
    (csp ?? "")
      .split(";")
      .map((value) => value.trim().split(/\s+/))
      .filter(([name]) => Boolean(name))
      .map(([name, ...values]) => [name, values]),
  );
}

describe("production security headers", () => {
  it("sets isolation and transport headers", () => {
    const response = NextResponse.next();

    applySecurityHeaders(response, "production");

    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("origin-agent-cluster")).toBe("?1");
    expect(response.headers.get("content-security-policy")).toContain(
      "upgrade-insecure-requests",
    );
  });

  it("allows only the payment providers required by embedded checkout", () => {
    const response = NextResponse.next();

    applySecurityHeaders(response, "production");

    const csp = directives(response.headers.get("content-security-policy"));
    expect(csp.get("style-src")).toEqual(
      expect.arrayContaining([
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
      ]),
    );
    expect(csp.get("font-src")).toEqual(
      expect.arrayContaining([
        "https://square-fonts-production-f.squarecdn.com",
        "https://d1g145x70srn7h.cloudfront.net",
      ]),
    );
    expect(csp.get("connect-src")).toEqual(
      expect.arrayContaining([
        "https://web.squarecdn.com",
        "https://sandbox.web.squarecdn.com",
        "https://pci-connect.squareup.com",
        "https://pci-connect.squareupsandbox.com",
        "https://o160250.ingest.sentry.io",
        "https://challenges.cloudflare.com",
      ]),
    );
  });

  it("keeps application pages unavailable to frames", () => {
    const response = NextResponse.next();

    applySecurityHeaders(response, "production", "/checkout");

    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("allows same-origin framing only for the BotID proxy route", () => {
    const response = NextResponse.next();

    applySecurityHeaders(
      response,
      "production",
      "/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/p.js",
    );

    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'self'",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "frame-ancestors 'none'",
    );
  });

  it("allows Cloudflare Web Analytics without obsolete browser origins", () => {
    const response = NextResponse.next();

    applySecurityHeaders(response, "production", "/");

    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(csp).toContain("https://cloudflareinsights.com");
    expect(csp).not.toContain("https://api.goshippo.com");
    expect(csp).not.toContain("https://*.vercel-scripts.com");
    expect(csp).not.toContain("openstreetmap.org");
  });
});
