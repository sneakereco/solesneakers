import { NextRequest } from "next/server";

import { checkCsrf } from "@/proxy/csrf";

describe("checkCsrf", () => {
  it("bypasses CSRF checks for the shipping webhook route", () => {
    const request = new NextRequest("https://example.com/api/webhooks/shippo", {
      method: "POST",
    });

    const result = checkCsrf(request, "req-1");

    expect(result).toBeNull();
  });

  it("bypasses CSRF checks for the exact Square webhook route", () => {
    const request = new NextRequest("https://example.com/api/webhooks/square", {
      method: "POST",
    });

    expect(checkCsrf(request, "req-2")).toBeNull();
  });

  it("does not bypass a path that merely starts with a webhook route", () => {
    const request = new NextRequest("https://example.com/api/webhooks/square/evil", {
      method: "POST",
    });

    expect(checkCsrf(request, "req-3")?.status).toBe(403);
  });
});
