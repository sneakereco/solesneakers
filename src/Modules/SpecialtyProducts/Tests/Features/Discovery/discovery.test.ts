import { createClient } from "@supabase/supabase-js";
import {
  isSpecialtyDiscoveryAllowed,
  insertDiscoveryItem,
  listSpecialtyDiscoveryPool,
  getSpecialtyProductPage,
} from "@/Modules/SpecialtyProducts/Source/Features/Discovery/discovery";
import { ProductRepository } from "@/repositories/product-repo";
import { FeaturedItemsService } from "@/services/featured-items-service";
import type { ProductFilters } from "@/repositories/product-repo";

test("a valid uppercase prize URL matches the database's lowercase UUID", async () => {
  const id = "a1111111-1111-4111-8111-111111111111";
  const row = {
    decision_ordinal: 1,
    product: {
      id,
      name: "Prize",
      description: null,
      category: "specialty",
      is_active: true,
      archived_at: null,
      go_live_at: "2020-01-01T00:00:00Z",
      images: [],
    },
    variant: { stock: 0 },
    campaign: { slug: "black-friday-2026", enabled: true },
  };
  const client = createClient("https://example.supabase.co", "test", {
    global: {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(row), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    },
  });
  expect(await getSpecialtyProductPage(client as never, id.toUpperCase())).toMatchObject({
    claimed: true,
    product: { id, claimable: false },
  });
});

test.each([
  [0, 1, true, true],
  [0, 1, false, true],
  [2, 1, true, false],
])(
  "prize permalink projects only public facts for stock %s / wins %s / open %s",
  async (stock, wins, enabled, claimed) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const row = {
      decision_ordinal: wins,
      product: {
        id,
        name: "Prize",
        description: "Description",
        category: "specialty",
        is_active: true,
        archived_at: null,
        go_live_at: "2020-01-01T00:00:00Z",
        images: [],
        unit_cost_cents: 1234,
      },
      variant: { stock },
      campaign: { slug: "black-friday-2026", enabled },
      instagram_handle: "private",
      eligibility_address: { line1: "private" },
    };
    const urls: URL[] = [];
    const client = createClient("https://example.supabase.co", "test", {
      global: {
        fetch: (input) => {
          urls.push(new URL(String(input)));
          return Promise.resolve(
            new Response(JSON.stringify(row), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        },
      },
    });
    expect(await getSpecialtyProductPage(client as never, id)).toEqual({
      claimed,
      product: {
        id,
        name: "Prize",
        description: "Description",
        imageUrl: null,
        claimable: !claimed,
      },
    });
    expect(urls[0].searchParams.get("product_id")).toBe("eq." + id);
    expect(urls[0].searchParams.get("campaign.slug")).toBe("eq.black-friday-2026");
    expect(urls[0].searchParams.has("variant.stock")).toBe(false);
  },
);

test.each([
  { stock: 0, wins: 0, enabled: true },
  { stock: 1, wins: 0, enabled: false },
])(
  "a zero-quantity unclaimed or closed stocked prize is not falsely shown as claimed: %j",
  async ({ stock, wins, enabled }) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const row = {
      decision_ordinal: wins,
      product: {
        id,
        name: "Prize",
        description: null,
        category: "specialty",
        is_active: true,
        archived_at: null,
        go_live_at: "2020-01-01T00:00:00Z",
        images: [],
      },
      variant: { stock },
      campaign: { slug: "black-friday-2026", enabled },
    };
    const client = createClient("https://example.supabase.co", "test", {
      global: {
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify(row), {
              headers: { "Content-Type": "application/json" },
            }),
          ),
      },
    });
    expect(await getSpecialtyProductPage(client as never, id)).toBeNull();
  },
);
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
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(rows), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
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
      fetch: (input) => {
        urls.push(new URL(String(input)));
        return Promise.resolve(
          new Response("[]", {
            headers: { "Content-Type": "application/json", "content-range": "0-0/0" },
          }),
        );
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
    getById: () => Promise.resolve({ category: "specialty", is_active: true }),
  };
  await expect(
    service.addFeaturedItem({ productId: "id", userId: "admin" }),
  ).rejects.toThrow(/specialty/i);
});
