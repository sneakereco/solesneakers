export type Brand = {
  id: string;
  canonical_label: string;
  is_active: boolean;
};

export type Model = {
  id: string;
  brand_id: string;
  canonical_label: string;
  is_active: boolean;
};

export type Alias = {
  id: string;
  entity_type: "brand" | "model";
  brand_id: string | null;
  model_id: string | null;
  alias_label: string;
  priority: number;
  is_active: boolean;
};

export type Candidate = {
  id: string;
  entity_type: "brand" | "model";
  raw_text: string;
  parent_brand_id: string | null;
  status: "new" | "accepted" | "rejected";
};

export type TagSize = {
  id: string;
  size_type: "shoe" | "clothing" | "custom" | "none";
  canonical_label: string;
  sort_order: number;
  is_active: boolean;
};

export type ActiveTab = "brands" | "models" | "aliases" | "candidates" | "sizes";
