import { NextResponse } from "next/server";

import { applySecurityHeaders } from "@/proxy/security-headers";

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
});
