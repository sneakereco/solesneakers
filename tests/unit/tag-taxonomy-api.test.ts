import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tag taxonomy API namespace", () => {
  it("exposes the structured modules only under /api/admin/tags", () => {
    for (const moduleName of ["brands", "models", "aliases", "candidates", "sizes"]) {
      expect(existsSync(resolve(`app/api/admin/tags/${moduleName}/route.ts`))).toBe(true);
    }
    expect(existsSync(resolve("app/api/admin/catalog"))).toBe(false);
    expect(existsSync(resolve("app/api/admin/tags/brand-groups"))).toBe(false);
  });

  it("does not accept verification or group fields", () => {
    const brandsRoute = readFileSync(
      resolve("app/api/admin/tags/brands/route.ts"),
      "utf8",
    );
    expect(brandsRoute).not.toMatch(/isVerified|is_verified|groupId|group_id/);
  });
});
