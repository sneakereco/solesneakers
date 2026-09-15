import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("checkout theme", () => {
  it.each([
    "src/app/checkout/processing/page.tsx",
    "src/app/checkout/success/page.tsx",
    "src/app/checkout/cancel/page.tsx",
    "src/app/checkout/error.tsx",
  ])("uses the current neutral storefront palette in %s", (path) => {
    const source = readFileSync(resolve(path), "utf8");

    expect(source).not.toMatch(/(?:bg|text|border|hover:bg|hover:text)-(?:red|rose)-/);
  });
});
