import { generateMetadata as productMetadata } from "@/app/(store)/store/[productId]/page";
import { generateMetadata as storeMetadata } from "@/app/(store)/store/page";

jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock("@/lib/supabase/public", () => ({ createSupabasePublicClient: () => ({}) }));
jest.mock("@/components/store/ProductDetail", () => ({ ProductDetail: () => null }));
jest.mock("@/repositories/product-repo", () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({
    getById: (id: string) =>
      Promise.resolve(
        id.endsWith("1111")
          ? {
              name: "Air Jordan 1 Chicago",
              condition: "new",
              description: "Red and white high-top sneakers.",
              images: [{ is_primary: true, url: "https://example.com/shoe.jpg" }],
              variants: [{ sale_price_cents: 20000, stock: 1 }],
            }
          : null,
      ),
  })),
}));
jest.mock("@/repositories/tag-taxonomy-repo", () => ({
  TagTaxonomyRepository: jest.fn().mockImplementation(() => ({
    listBrands: jest
      .fn()
      .mockResolvedValue([
        { id: "22222222-2222-4222-8222-222222222222", canonical_label: "Nike" },
      ]),
    listModels: jest.fn().mockResolvedValue([]),
    listSizes: jest.fn().mockResolvedValue([]),
  })),
}));

describe("shared link metadata", () => {
  it("describes the product using the shared store logo", async () => {
    const metadata = await productMetadata({
      params: Promise.resolve({ productId: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(metadata.title).toBe("Air Jordan 1 Chicago | Solesneakers");
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: "Brand New - Red and white high-top sneakers.",
      images: [{ url: "/images/logo.png", alt: "Solesneakers" }],
    });
    expect(metadata.twitter).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      images: ["/images/logo.png"],
    });
  });

  it("describes a selected brand and category instead of the home page", async () => {
    const metadata = await storeMetadata({
      searchParams: Promise.resolve({
        category: "sneakers",
        brandIds: "22222222-2222-4222-8222-222222222222",
      }),
    });
    expect(metadata.title).toBe("Sneakers, Nike | Solesneakers");
    expect(metadata.description).toContain("Sneakers, Nike");
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
    });
  });

  it("identifies a search without exposing unknown filter IDs", async () => {
    const metadata = await storeMetadata({
      searchParams: Promise.resolve({ q: "Jordan 4", brandIds: "unknown-brand" }),
    });
    expect(metadata.title).toBe('Search: "Jordan 4" | Solesneakers');
    expect(metadata.description).not.toContain("unknown-brand");
  });
});
