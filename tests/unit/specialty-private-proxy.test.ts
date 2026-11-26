import { NextResponse } from "next/server";
import { finalizeProxyResponse } from "@/proxy/finalize";
test.each([
  "/api/specialty/eligibility",
  "/api/specialty/claims",
  "/api/specialty/claims/result",
  "/api/admin/specialty/claims",
  "/api/admin/specialty/claims/claim-id",
  "/api/admin/specialty/products",
  "/api/admin/specialty/campaign",
  "/admin/specialty-claims",
])("proxy denials for private specialty path %s cannot be cached", (path) => {
  const response = finalizeProxyResponse(
    NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    "test-request",
    path,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
});
test("proxy finalization preserves the separate public discovery freshness policy", () => {
  const response = finalizeProxyResponse(
    NextResponse.json(
      { products: [] },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=5, must-revalidate" } },
    ),
    "test-request",
    "/api/specialty/discovery",
  );
  expect(response.headers.get("Cache-Control")).toBe(
    "public, max-age=0, s-maxage=5, must-revalidate",
  );
});
