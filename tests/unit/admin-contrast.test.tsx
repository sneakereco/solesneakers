import { renderToStaticMarkup } from "react-dom/server";

import { AdminSearchField } from "@/components/admin/AdminSearchField";
import { RdkSelect } from "@/components/ui/Select";

describe("admin control contrast", () => {
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
});
