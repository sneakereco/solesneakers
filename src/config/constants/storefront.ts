export type TopBrandShortcut = {
  label: string;
  brandLabel?: string;
  query?: string;
};

export const TOP_BRAND_SHORTCUTS: TopBrandShortcut[] = [
  { label: "Air Jordan", brandLabel: "Air Jordan" },
  { label: "Yeezy", query: "yeezy" },
  { label: "ASICS", brandLabel: "ASICS" },
  { label: "LV", brandLabel: "Louis Vuitton" },
  { label: "Gucci", brandLabel: "Gucci" },
  { label: "Prada", brandLabel: "Prada" },
];
