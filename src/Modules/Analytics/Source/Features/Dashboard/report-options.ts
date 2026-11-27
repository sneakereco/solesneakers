import { isReportFilterValue } from "../ReportContract/filters";
import type {
  AttributionBreakdown,
  ProductsData,
  ProductRow,
} from "../ReportContract/types";
import { acquisitionLabel } from "./request-state";

type ReportedOption = { value: string; label: string };
type ReportedFilter = Parameters<typeof isReportFilterValue>[0];
export type ReportedOptions = Partial<Record<ReportedFilter, ReportedOption[]>>;

function choices(filter: ReportedFilter, rows: ReportedOption[]) {
  return [
    ...new Map(
      rows
        .filter(({ value }) => isReportFilterValue(filter, value))
        .map((row) => [row.value, row]),
    ).values(),
  ];
}

export function acquisitionOptions(view: AttributionBreakdown): ReportedOptions {
  const options = (
    filter: "source" | "channel" | "campaign",
    rows: AttributionBreakdown["sources"],
  ) =>
    choices(
      filter,
      rows.rows
        .filter(({ key }) => key !== "unattributed")
        .map(({ key, label }) => ({ value: key, label: acquisitionLabel(label) })),
    );
  return {
    source: options("source", view.sources),
    channel: options("channel", view.channels),
    campaign: options("campaign", view.campaigns),
  };
}

export function productOptions(data: ProductsData): ReportedOptions {
  const products = [...(data.products?.rows ?? []), ...(data.variants?.rows ?? [])];
  const taxonomy = (
    filter: "brandId" | "categoryId" | "sizeId",
    field: "brand" | "category" | "size",
    rows: ProductsData["brands"],
  ) =>
    choices(filter, [
      ...products.flatMap((row) =>
        row[field]?.id ? [{ value: row[field].id, label: row[field].label }] : [],
      ),
      ...(rows?.rows ?? []).flatMap((row) =>
        row.id ? [{ value: row.id, label: row.label }] : [],
      ),
    ]);
  return {
    productId: choices(
      "productId",
      products.map(({ productId, name }) => ({ value: productId, label: name })),
    ),
    variantId: choices(
      "variantId",
      (data.variants?.rows ?? []).flatMap((row) =>
        row.variantId
          ? [
              {
                value: row.variantId,
                label: row.size
                  ? `${row.name} · ${row.size.label}`
                  : `${row.name} · Recorded variant`,
              },
            ]
          : [],
      ),
    ),
    brandId: taxonomy("brandId", "brand", data.brands),
    categoryId: taxonomy("categoryId", "category", data.categories),
    sizeId: taxonomy("sizeId", "size", data.sizes),
  };
}

export function canOpenProduct(row: ProductRow) {
  return (
    isReportFilterValue("productId", row.productId) &&
    (row.variantId === null || isReportFilterValue("variantId", row.variantId))
  );
}
