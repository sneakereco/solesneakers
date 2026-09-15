import { renderToStaticMarkup } from "react-dom/server";

import { AddressInput } from "@/components/shared/AddressInput";
import { ModalPortal } from "@/components/ui/ModalPortal";

it("renders current address validation on the first render", () => {
  const html = renderToStaticMarkup(
    <AddressInput
      value={{
        name: "",
        phone: "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        postal_code: "",
        country: "US",
      }}
      onChange={() => {}}
      showErrors
    />,
  );
  expect(html).toContain("Name is required");
  expect(html).toContain("Valid ZIP code required");
});

it("keeps an initially open portal out of server markup", () => {
  expect(
    renderToStaticMarkup(
      <ModalPortal open onClose={() => {}}>
        Content
      </ModalPortal>,
    ),
  ).toBe("");
});
