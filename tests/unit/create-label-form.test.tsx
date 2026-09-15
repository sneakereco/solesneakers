import { renderToStaticMarkup } from "react-dom/server";

import { CreateLabelForm } from "@/components/admin/shipping/CreateLabelForm";

jest.mock("@/components/ui/ModalPortal", () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => children,
}));

describe("shipping label package initialization", () => {
  it("shows supplied package dimensions on its first open render", () => {
    const markup = renderToStaticMarkup(
      <CreateLabelForm
        open
        order={{ id: "order-1" }}
        initialPackage={{ weight: 48, length: 18, width: 14, height: 9 }}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );

    for (const dimension of [48, 18, 14, 9]) {
      expect(markup).toContain(`value="${dimension}"`);
    }
    expect(markup).not.toContain('value="16"');
  });
});
