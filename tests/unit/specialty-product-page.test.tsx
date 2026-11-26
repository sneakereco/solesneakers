jest.mock("next/cache", () => ({ unstable_cache: (read: () => unknown) => read }));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
jest.mock("next/server", () => ({ connection: () => Promise.resolve() }));
jest.mock("@/lib/supabase/public", () => ({ createSupabasePublicClient: jest.fn() }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));
jest.mock("@/repositories/product-repo", () => ({ ProductRepository: jest.fn() }));
jest.mock("@/components/store/ProductDetail", () => ({
  ProductDetail: () => <div>Ordinary product detail</div>,
}));
jest.mock(
  "@/Modules/SpecialtyProducts/Source/Features/Discovery/SpecialtyProductCard",
  () => ({
    SpecialtyProductCard: ({
      product,
    }: {
      product: { name: string; claimable: boolean };
    }) => (
      <div>
        {product.name}
        <button disabled={!product.claimable}>Claim</button>
      </div>
    ),
  }),
);
import { renderToStaticMarkup } from "react-dom/server";
import ProductDetailPage, {
  generateMetadata,
} from "@/app/(store)/store/[productId]/page";
import { ProductRepository } from "@/repositories/product-repo";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
const id = "11111111-1111-4111-8111-111111111111";
const params = Promise.resolve({ productId: id });
const getById = jest.fn();
const query: Record<string, jest.Mock> = {};
for (const method of ["from", "select", "eq", "is", "lte"])
  query[method] = jest.fn(() => query);
query.maybeSingle = jest.fn();
const row = {
  decision_ordinal: 1,
  product: {
    id,
    name: "Cash prize",
    description: "A giveaway",
    category: "specialty",
    is_active: true,
    archived_at: null,
    go_live_at: "2020-01-01T00:00:00Z",
    images: [],
  },
  variant: { stock: 0 },
  campaign: { slug: "black-friday-2026", enabled: true },
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ProductRepository).mockImplementation(() => ({ getById }) as never);
  jest.mocked(createSupabaseAdminClient).mockReturnValue(query as never);
  getById.mockResolvedValue(null);
  query.maybeSingle.mockResolvedValue({ data: structuredClone(row), error: null });
});
test("an exhausted giveaway link renders the claimed message instead of a 404 without enabling another claim", async () => {
  const html = renderToStaticMarkup(await ProductDetailPage({ params }));
  expect(html).toContain("This product has already been claimed.");
  expect(html).toContain('disabled=""');
  expect(html).not.toContain("Ordinary product detail");
  expect(html).not.toContain("another customer");
});
test("a cached available prize is rechecked so a final claim immediately shows claimed", async () => {
  getById.mockResolvedValue({ ...row.product, variants: [{ stock: 1 }], images: [] });
  const html = renderToStaticMarkup(await ProductDetailPage({ params }));
  expect(html).toContain("This product has already been claimed.");
});
test("claimed giveaway metadata stays noindex and identifies the product", async () => {
  const metadata = await generateMetadata({ params });
  expect(metadata.title).toContain("Cash prize");
  expect(metadata.robots).toEqual({ index: false, follow: true });
});
test("unrelated unavailable products still return not found", async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(ProductDetailPage({ params })).rejects.toThrow("NOT_FOUND");
});
test("ordinary available products retain their existing detail without a private prize lookup", async () => {
  getById.mockResolvedValue({
    ...row.product,
    category: "sneakers",
    variants: [{ stock: 1 }],
    images: [],
  });
  expect(renderToStaticMarkup(await ProductDetailPage({ params }))).toContain(
    "Ordinary product detail",
  );
  expect(createSupabaseAdminClient).not.toHaveBeenCalled();
});
