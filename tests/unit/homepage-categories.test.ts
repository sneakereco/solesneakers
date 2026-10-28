import { getHomepageCategories } from "@/components/home/homepage-categories";

const designerLabels = [
  "Prada",
  "Chanel",
  "Gucci",
  "Burberry",
  "Dior",
  "Lanvin",
  "Versace",
  "Maison Margiela",
  "Alexander McQueen",
  "Rick Owens",
  "Dolce and Gabbana",
  "Louis Vuitton",
  "Balenciaga",
  "Amiri",
];
const brands = [
  ...designerLabels.map((label, index) => ({ id: `designer-${index}`, label })),
  { id: "nike", label: "Nike" },
  { id: "chrome-hearts", label: "Chrome Hearts" },
  { id: "off-white", label: "Off-White" },
  { id: "palm-angels", label: "Palm Angels" },
];

describe("homepage collection destinations", () => {
  it("opens the four regular collections with their intended category and condition", () => {
    const cards = getHomepageCategories(brands);
    expect(cards.map((card) => card.label)).toEqual([
      "Brand New",
      "Pre-Owned",
      "Designer Sneakers",
      "Designer Bags & Accessories",
      "Clothing",
      "Electronics",
    ]);
    expect(
      cards.filter((card) => !card.label.startsWith("Designer")).map((card) => card.href),
    ).toEqual([
      "/store?category=sneakers&condition=new",
      "/store?category=sneakers&condition=used",
      "/store?category=clothing",
      "/store?category=electronics",
    ]);
  });

  it.each([
    ["Designer Sneakers", "sneakers"],
    ["Designer Bags & Accessories", "accessories"],
  ])("selects only the 14 designer brands for %s", (label, category) => {
    const card = getHomepageCategories(brands).find((entry) => entry.label === label)!;
    const params = new URL(card.href!, "https://example.com").searchParams;
    expect(params.get("category")).toBe(category);
    expect(params.getAll("brandIds").sort()).toEqual(
      [
        "designer-0",
        "designer-1",
        "designer-2",
        "designer-3",
        "designer-4",
        "designer-5",
        "designer-6",
        "designer-7",
        "designer-8",
        "designer-9",
        "designer-10",
        "designer-11",
        "designer-12",
        "designer-13",
      ].sort(),
    );
    expect(params.has("condition")).toBe(false);
  });

  it("matches normalized labels and deduplicates brand IDs without widening the selection", () => {
    const cards = getHomepageCategories([
      { id: "prada", label: "  PRADA " },
      { id: "prada", label: "Prada" },
      { id: "other", label: "Prada-inspired" },
    ]);
    const params = new URL(cards[2].href!, "https://example.com").searchParams;
    expect(params.getAll("brandIds")).toEqual(["prada"]);
  });

  it.each([{ brands: [] }, { brands: [{ id: "nike", label: "Nike" }] }])(
    "never links to unrestricted designer collections when no designer brands resolve ($brands)",
    ({ brands: availableBrands }) => {
      const cards = getHomepageCategories(availableBrands);
      expect(cards[2].href).toBeNull();
      expect(cards[3].href).toBeNull();
      expect(cards[0].href).toBe("/store?category=sneakers&condition=new");
    },
  );
});
