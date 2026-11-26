import { renderToStaticMarkup } from "react-dom/server";
import { ProductForm } from "@/components/inventory/ProductForm";

it.each([
  [0, false, ""],
  [0, true, "0.00"],
  [1234, false, "12.34"],
] as const)("renders recorded cost %s with presence %s", (cost, recorded, expected) => {
  const markup = renderToStaticMarkup(
    <ProductForm
      initialData={{
        variants: [
          {
            sku: "100001",
            size_id: "size-1",
            sale_price_cents: 10000,
            stock: 2,
            unit_cost_cents: cost,
            unit_cost_recorded: recorded,
          },
        ],
      }}
      onSubmit={() => Promise.resolve()}
      onCancel={() => {}}
    />,
  );
  const input = markup
    .match(/<input\b[^>]*placeholder="Optional"[^>]*>/g)
    ?.find((element) => element.includes('inputMode="decimal"'));
  expect(input).toContain(`value="${expected}"`);
});
