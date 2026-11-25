import { createClient } from "@supabase/supabase-js";
import {
  isSpecialtyDiscoveryAllowed,
  insertDiscoveryItem,
  listSpecialtyDiscoveryPool,
} from "@/Modules/SpecialtyProducts/Source/Features/Discovery/discovery";
import { ProductRepository } from "@/repositories/product-repo";
import { FeaturedItemsService } from "@/services/featured-items-service";
import type { ProductFilters } from "@/repositories/product-repo";
test.each([
  { q: "prize" },
  { category: ["specialty"] },
  { brandIds: ["brand"] },
  { modelIds: ["model"] },
  { sizeIds: ["size"] },
  { condition: ["new"] },
  { priceMinCents: 0 },
  { priceMaxCents: 0 },
])("filter disables discovery: %j", (filters) => {
  expect(isSpecialtyDiscoveryAllowed(filters)).toBe(false);
});
test("sort and pagination preserve ordinary catalog order/count and allow one extra item", () => {
  expect(isSpecialtyDiscoveryAllowed({ sort: "price_asc", page: 2 })).toBe(true);
  const ordinary = ["a", "b"];
  expect(insertDiscoveryItem(ordinary, "prize", 1)).toEqual(["a", "prize", "b"]);
  expect(ordinary).toEqual(["a", "b"]);
  expect(insertDiscoveryItem([], "prize", 0)).toEqual([]);
});
test("discovery projects safe public fields and rejects stale or disabled entries", async () => {
  const product = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Cash prize",
    description: "Win",
    category: "specialty",
    is_active: true,
    archived_at: null,
    go_live_at: "2020-01-01T00:00:00Z",
    images: [],
    unit_cost_cents: 1234,
  };
  const row = {
    product,
    variant: { stock: 1 },
    campaign: { slug: "black-friday-2026", enabled: true },
    winning_instructions: "private",
  };
  const rows = [
    row,
    { ...row, variant: { stock: 0 } },
    { ...row, product: { ...product, go_live_at: "2999-01-01T00:00:00Z" } },
    { ...row, product: { ...product, archived_at: "2026-01-01" } },
    { ...row, campaign: { ...row.campaign, enabled: false } },
  ];
  const client = createClient("https://example.supabase.co", "test", {
    global: {
      fetch: async () =>
        new Response(JSON.stringify(rows), {
          headers: { "Content-Type": "application/json" },
        }),
    },
  });
  expect(await listSpecialtyDiscoveryPool(client as never)).toEqual([
    {
      id: product.id,
      name: "Cash prize",
      description: "Win",
      imageUrl: null,
      claimable: true,
    },
  ]);
});
test("ordinary public query seams exclude specialty while admin inventory retains it", async () => {
  const urls: URL[] = [];
  const client = createClient("https://example.supabase.co", "test", {
    global: {
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return new Response("[]", {
          headers: { "Content-Type": "application/json", "content-range": "0-0/0" },
        });
      },
    },
  });
  const repo = new ProductRepository(client as never);
  const cases: Array<[() => Promise<unknown>, string]> = [
    [() => repo.list(), "category"],
    [() => repo.list({ q: "prize" }), "category"],
    [() => repo.list({ sort: "price_asc" }), "category"],
    [() => repo.listCanonicalSearchProductIds("Cash"), "category"],
    [() => repo.listFilterData(), "category"],
    [() => repo.listAvailableSizes(), "product.category"],
    [() => repo.listAvailableConditions(), "product.category"],
    [() => repo.getProductsForCheckout(["id"]), "category"],
    [() => repo.getVariantsForCart(["id"]), "product.category"],
  ];
  for (const [run, key] of cases) {
    urls.length = 0;
    await run();
    expect(urls.some((url) => url.searchParams.get(key) === "neq.specialty")).toBe(true);
  }
  urls.length = 0;
  await repo.list({ searchMode: "inventory" } as ProductFilters);
  expect(urls.every((url) => url.searchParams.get("category") !== "neq.specialty")).toBe(
    true,
  );
});
test("curated featured products cannot bypass specialty discovery checks", async () => {
  const service = new FeaturedItemsService({} as never);
  (service as unknown as { productRepo: unknown }).productRepo = {
    getById: async () => ({ category: "specialty", is_active: true }),
  };
  await expect(
    service.addFeaturedItem({ productId: "id", userId: "admin" }),
  ).rejects.toThrow(/specialty/i);
});
