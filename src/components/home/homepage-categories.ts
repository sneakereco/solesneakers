export type HomepageBrand = { id: string; label: string };

export type HomepageCategory = {
  label: string;
  image: string;
  href: string | null;
  objectPosition: string;
  featured: boolean;
};

const DESIGNER_BRANDS = new Set(
  [
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
  ].map((label) => label.toLowerCase()),
);

export function getHomepageCategories(
  brands: readonly HomepageBrand[],
): HomepageCategory[] {
  const designerIds = [
    ...new Set(
      brands
        .filter((brand) => DESIGNER_BRANDS.has(brand.label.trim().toLowerCase()))
        .map((brand) => brand.id)
        .filter(Boolean),
    ),
  ];
  const designerHref = (category: string) => {
    if (designerIds.length === 0) return null;
    const params = new URLSearchParams({ category });
    designerIds.forEach((id) => params.append("brandIds", id));
    return `/store?${params}`;
  };

  return [
    {
      label: "Brand New",
      image: "brand_new_shoes.jpg",
      href: "/store?category=sneakers&condition=new",
      objectPosition: "50% 64%",
      featured: true,
    },
    {
      label: "Pre-Owned",
      image: "preowned_shoes_2.jpg",
      href: "/store?category=sneakers&condition=used",
      objectPosition: "50% 50%",
      featured: true,
    },
    {
      label: "Designer Sneakers",
      image: "designer_shoes_1.jpg",
      href: designerHref("sneakers"),
      objectPosition: "50% 50%",
      featured: false,
    },
    {
      label: "Designer Bags & Accessories",
      image: "designer_bags.jpg",
      href: designerHref("accessories"),
      objectPosition: "50% 50%",
      featured: false,
    },
    {
      label: "Clothing",
      image: "clothing_1.jpg",
      href: "/store?category=clothing",
      objectPosition: "50% 50%",
      featured: false,
    },
    {
      label: "Electronics",
      image: "electronics.jpg",
      href: "/store?category=electronics",
      objectPosition: "50% 50%",
      featured: false,
    },
  ];
}
