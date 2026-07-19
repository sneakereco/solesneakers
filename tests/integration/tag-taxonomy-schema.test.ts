import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tag taxonomy schema reset", () => {
  const migration = readFileSync(
    resolve("supabase/migrations/20260718170000_tag_taxonomy_schema_reset.sql"),
    "utf8",
  );

  it("creates structured taxonomy and removes generic tags", () => {
    expect(migration).toContain("create table public.tag_brands");
    expect(migration).toContain("create table public.tag_models");
    expect(migration).toContain("create table public.tag_sizes");
    expect(migration).toContain("drop table if exists public.product_tags cascade");
    expect(migration).toContain("drop table if exists public.tags cascade");
  });

  it("enforces brand/model and product/size consistency", () => {
    expect(migration).toContain("foreign key (model_id, brand_id)");
    expect(migration).toContain("validate_variant_size_ref");
    expect(migration).toContain("Size option does not match product size type");
  });

  it("grants storefront reads while RLS controls row visibility", () => {
    expect(migration).toContain("to anon, authenticated");
    expect(migration).toContain('create policy "Public can view active tag sizes"');
  });
});
