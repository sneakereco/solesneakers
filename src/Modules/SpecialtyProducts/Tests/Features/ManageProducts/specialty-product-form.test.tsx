import { renderToStaticMarkup } from "react-dom/server";
import {
  SpecialtyProductForm,
  buildSpecialtyProductWrite,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/SpecialtyProductForm";
import { ProductForm } from "@/components/inventory/ProductForm";
import type { SpecialtyProductDraft } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-contract";
const initial: SpecialtyProductDraft = {
  productId: "11111111-1111-4111-8111-111111111111",
  revision: 2,
  remainingQuantity: 0,
  hasClaims: true,
  name: "Cash prize",
  description: null,
  images: [],
  instructions: "<b>Contact us</b>",
  goLiveAt: "2026-11-25T12:00:00Z",
};
test("specialty edit delegates to a prize-only form and escapes instructions", () => {
  const markup = renderToStaticMarkup(
    <ProductForm
      initialData={{ category: "specialty" }}
      specialtyInitial={initial}
      onSpecialtySubmit={async () => {}}
      onSubmit={async () => {}}
      onCancel={() => {}}
    />,
  );
  expect(markup).toContain("Cash prize");
  expect(markup).toContain("&lt;b&gt;Contact us&lt;/b&gt;");
  expect(markup).not.toMatch(
    /Shipping|Pickup|Email|Card|Unit Cost|Sale Price|Brand|Size/,
  );
  expect(markup).toContain("Quantity");
  expect(markup).toMatch(/disabled/);
});
test("creation offers quantity and go-live without ordinary purchase fields", () => {
  const markup = renderToStaticMarkup(
    <SpecialtyProductForm onSubmit={async () => {}} onCancel={() => {}} />,
  );
  for (const field of [
    "Title",
    "Description",
    "Images",
    "Quantity",
    "Winning instructions",
    "Go live",
  ])
    expect(markup).toContain(field);
  expect(markup).not.toMatch(/Shipping|Pickup|Email|Card|Brand|Sale Price/);
});
test("metadata submissions omit stale quantity; explicit allowed changes are deliberate", () => {
  const metadata = {
    name: initial.name,
    description: initial.description,
    images: initial.images,
    instructions: initial.instructions,
    goLiveAt: initial.goLiveAt,
  };
  expect(buildSpecialtyProductWrite(metadata, 0, initial)).not.toHaveProperty("quantity");
  expect(
    buildSpecialtyProductWrite(metadata, 2, { ...initial, hasClaims: false }),
  ).toHaveProperty("quantity", 2);
  expect(() => buildSpecialtyProductWrite(metadata, 2, initial)).toThrow();
});
