import { buildPackageProfile } from "@/lib/shipping/package-profile";

describe("buildPackageProfile", () => {
  it("sums category weight by quantity and uses the largest dimensions", () => {
    expect(
      buildPackageProfile(
        [
          { quantity: 2, category: "sneakers" },
          { quantity: 1, category: "clothing" },
        ],
        {
          sneakers: { weight: 20, length: 14, width: 10, height: 6 },
          clothing: { weight: 8, length: 12, width: 11, height: 4 },
        },
      ),
    ).toEqual({ weight: 48, length: 14, width: 11, height: 6 });
  });

  it("uses the safe package fallback when no items exist", () => {
    expect(buildPackageProfile([], {})).toEqual({
      weight: 16,
      length: 12,
      width: 12,
      height: 12,
    });
  });

  it("uses the fallback for an item without configured category dimensions", () => {
    expect(buildPackageProfile([{ quantity: 2, category: "unknown" }], {})).toEqual({
      weight: 32,
      length: 12,
      width: 12,
      height: 12,
    });
  });
});
