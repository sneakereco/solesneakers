import { renderToStaticMarkup } from "react-dom/server";

import { ModalPortal } from "@/components/ui/ModalPortal";

it("keeps an initially open portal out of server markup", () => {
  expect(
    renderToStaticMarkup(
      <ModalPortal open onClose={() => {}}>
        Content
      </ModalPortal>,
    ),
  ).toBe("");
});
