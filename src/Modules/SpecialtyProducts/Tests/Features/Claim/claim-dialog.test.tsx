import { renderToStaticMarkup } from "react-dom/server";
import { ClaimDialog } from "@/Modules/SpecialtyProducts/Source/Features/Claim/ClaimDialog";
import { ClaimButton } from "@/Modules/SpecialtyProducts/Source/Features/Claim/ClaimButton";
jest.mock("@/components/ui/ModalPortal", () => ({
  ModalPortal: ({
    open,
    children,
    labelledBy,
    describedBy,
  }: {
    open: boolean;
    children: React.ReactNode;
    labelledBy?: string;
    describedBy?: string;
  }) =>
    open ? (
      <dialog
        open
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </dialog>
    ) : null,
}));
const product = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Cash prize",
  description: null,
  imageUrl: null,
  claimable: true,
};
test("SSR claim actions wait for browser hydration before accepting a click", () => {
  const html = renderToStaticMarkup(<ClaimButton product={product} />);
  expect(html).toMatch(/<button[^>]*disabled=""/);
});
test("claim dialog requests IG and eligibility address without checkout contact/payment controls", () => {
  const html = renderToStaticMarkup(
    <ClaimDialog product={product} open onClose={() => {}} />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  for (const field of [
    "Instagram handle",
    "Street address",
    "Apartment",
    "City",
    "State",
    "ZIP code",
  ])
    expect(html).toContain(field);
  expect(html).not.toMatch(/type="email"|Card number|Pickup|Shipping method/);
  expect(html).toContain("Opening this form does not reserve");
});
test("rendering/opening does not issue any award request", () => {
  const fetcher = jest.spyOn(globalThis, "fetch");
  renderToStaticMarkup(<ClaimButton product={product} />);
  renderToStaticMarkup(<ClaimDialog product={product} open onClose={() => {}} />);
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
