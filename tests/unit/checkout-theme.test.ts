import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("checkout theme", () => {
  it.each([
    "app/checkout/processing/page.tsx",
    "app/checkout/success/page.tsx",
    "app/checkout/cancel/page.tsx",
    "app/checkout/error.tsx",
  ])("uses the current neutral storefront palette in %s", (path) => {
    const source = readFileSync(resolve(path), "utf8");

    expect(source).not.toMatch(/(?:bg|text|border|hover:bg|hover:text)-(?:red|rose)-/);
  });
});
