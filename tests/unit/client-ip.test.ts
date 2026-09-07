import { NextRequest } from "next/server";

import { getTrustedClientIp } from "@/lib/http/client-ip";

function requestWith(url: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(url, { headers });
}

describe("getTrustedClientIp", () => {
  it("prefers Vercel's trusted forwarding header over a caller-controlled header", () => {
    const request = requestWith("https://shop.example.com/api/checkout/prepare", {
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-forwarded-for": "198.51.100.99",
    });

    expect(getTrustedClientIp(request)).toBe("203.0.113.10");
  });

  it("rejects x-forwarded-for as an identity on a production hostname", () => {
    const request = requestWith("https://shop.example.com/api/checkout/prepare", {
      "x-forwarded-for": "198.51.100.99",
    });

    expect(getTrustedClientIp(request)).toBeNull();
  });

  it("allows x-forwarded-for for local integration tests", () => {
    const request = requestWith("http://localhost:3000/api/checkout/prepare", {
      "x-forwarded-for": "127.0.0.2",
    });

    expect(getTrustedClientIp(request)).toBe("127.0.0.2");
  });
});
