jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("@/Modules/SpecialtyProducts/Source/Features/Discovery/discovery", () => ({
  listSpecialtyDiscoveryPool: jest.fn(),
}));
import { GET } from "@/app/api/specialty/discovery/route";
import { listSpecialtyDiscoveryPool } from "@/Modules/SpecialtyProducts/Source/Features/Discovery/discovery";
test("public pool has five-second CDN freshness with no stale extension", async () => {
  jest.mocked(listSpecialtyDiscoveryPool).mockResolvedValue([]);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ products: [] });
  expect(response.headers.get("Cache-Control")).toBe(
    "public, max-age=0, s-maxage=5, must-revalidate",
  );
  expect(response.headers.get("Vercel-CDN-Cache-Control")).toBe(
    "public, s-maxage=5, must-revalidate",
  );
});
test("pool failures return no cards and are not cached", async () => {
  jest.mocked(listSpecialtyDiscoveryPool).mockRejectedValue(new Error("private"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.json()).toEqual({ products: [] });
});
