import {
  moneyValue,
  toCents,
  toNonnegativeCents,
  toQuantity,
} from "../../../ReportContract/money";

it("keeps_unknown_money_unknown", () => {
  expect(moneyValue(null, 3)).toEqual({ cents: null, complete: false, missingCount: 3 });
  expect(moneyValue(null)).toEqual({ cents: null, complete: false, missingCount: 0 });
  expect(moneyValue(0)).toEqual({ cents: 0, complete: true, missingCount: 0 });
  expect(moneyValue(1200, 2)).toEqual({ cents: 1200, complete: false, missingCount: 2 });
});

it("converts both units to exact integer cents", () => {
  expect(toCents("100.25", "dollars")).toBe(10025);
  expect(toCents(100, "cents")).toBe(100);
  expect(toCents("0.2900", "dollars")).toBe(29);
  expect(toCents("90071992547409.91", "dollars")).toBe(Number.MAX_SAFE_INTEGER);
});

it.each([
  ["1.005", "dollars"],
  [1.005, "dollars"],
  ["0.1", "cents"],
  ["90071992547409.92", "dollars"],
  [Number.MAX_SAFE_INTEGER + 1, "cents"],
  ["100\n", "cents"],
  ["", "dollars"],
  [Infinity, "cents"],
] as const)(
  "rejects malformed, fractional-cent, or unsafe money (%s %s)",
  (value, unit) => {
    expect(() => toCents(value, unit)).toThrow(RangeError);
  },
);

it("preserves negative net periods", () => {
  expect(moneyValue(toCents("-4.25", "dollars"))).toEqual({
    cents: -425,
    complete: true,
    missingCount: 0,
  });
});

it("requires nonnegative source money", () => {
  expect(toNonnegativeCents("0.00", "dollars")).toBe(0);
  expect(() => toNonnegativeCents(-1, "cents")).toThrow(RangeError);
});

it("requires nonnegative whole source quantities", () => {
  expect(toQuantity("3")).toBe(3);
  expect(() => toQuantity(-1)).toThrow(RangeError);
  expect(() => toQuantity(1.25)).toThrow(RangeError);
});

it("validates provided cents and coverage counts", () => {
  expect(() => moneyValue(1.25)).toThrow(RangeError);
  expect(() => moneyValue(0, -1)).toThrow(RangeError);
});
