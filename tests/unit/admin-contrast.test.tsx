import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import resolveConfig from "tailwindcss/resolveConfig";

import { AdminSearchField } from "@/components/admin/AdminSearchField";
import { CarrierSelector } from "@/components/admin/shipping/CarrierSelector";
import { RdkSelect } from "@/components/ui/Select";
import tailwindConfig from "../../tailwind.config";

describe("admin control contrast", () => {
  it("renders selected carriers as black and unselected carriers as white", () => {
    const markup = renderToStaticMarkup(
      <CarrierSelector enabled={["UPS"]} onToggle={() => undefined} />,
    );

    expect(markup).toMatch(/aria-pressed="true"[^>]+bg-black/);
    expect(markup).toMatch(/aria-pressed="false"[^>]+bg-white/);
  });

  it("resolves the legacy red palette to neutral colors", () => {
    const colors = resolveConfig(tailwindConfig).theme.colors;

    expect(colors.red).toEqual(colors.zinc);
  });

  it("renders search fields with an explicit light surface and dark foreground", () => {
    const markup = renderToStaticMarkup(
      <AdminSearchField
        value=""
        onChange={() => undefined}
        placeholder="Search inventory"
      />,
    );

    expect(markup).toContain("data-admin-search");
    expect(markup).toContain("bg-white");
    expect(markup).toContain("text-zinc-950");
    expect(markup).not.toContain("text-white");
  });

  it("renders select triggers with an explicit light surface and dark foreground", () => {
    const markup = renderToStaticMarkup(
      <RdkSelect
        value="active"
        onChange={() => undefined}
        options={[{ value: "active", label: "Active" }]}
      />,
    );

    expect(markup).toContain("data-ui-select-trigger");
    expect(markup).toContain("bg-white");
    expect(markup).toContain("text-zinc-900");
    expect(markup).not.toContain("bg-zinc-900 border");
  });

  it("keeps fractional dark row hovers on the light admin surface", () => {
    const css = readFileSync(resolve("src/styles/site.css"), "utf8");

    expect(css).toContain(".hover\\:bg-zinc-800\\/50");
    expect(css).toContain(".hover\\:bg-zinc-800\\/60");
    expect(css).toContain(".hover\\:bg-zinc-900\\/60");
  });

  it("uses light surfaces for transaction status badges", () => {
    const source = readFileSync(
      resolve("src/app/admin/transactions/[orderId]/page.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/bg-(?:emerald|blue|red|amber|rose|orange|yellow)-950/);
    expect(source).toContain("rounded-full");
  });
});
