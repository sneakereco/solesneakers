# Tag Taxonomy Schema Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated generic product-tag system with authoritative, relational brand, model, alias, candidate, and size records; rename the database and application taxonomy namespace from `catalog` to `tag`; and make products and variants reference those records by ID.

**Architecture:** Treat `tag_*` as a namespace for structured taxonomy tables, not as a generic tag table. Products reference `tag_brands` and optional `tag_models`; variants reference `tag_sizes`; aliases and candidates support title parsing. Display labels, filters, and order snapshots are derived from these canonical records. The existing `tags`, `product_tags`, `catalog_brand_groups`, copied product brand/model strings, verification flags, and generated tag plumbing are removed rather than synchronized.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, generated Supabase TypeScript types, Next.js App Router, React 19, TypeScript, Zod, Jest, Supabase local development

---

## Scope Decisions

- This is a destructive forward migration because the project has no live product data. Do not build a backfill or dual-write compatibility layer.
- Keep historical migrations unchanged. Add one new migration that resets the current schema; old files may still contain historical `catalog_*` names.
- Rebuild `catalog_brands`, `catalog_models`, `catalog_aliases`, and `catalog_candidates` as `tag_brands`, `tag_models`, `tag_aliases`, and `tag_candidates`.
- Drop `catalog_brand_groups` without replacement. Remove `group_id`, `groupKey`, designer-group behavior, group endpoints, and group UI.
- Drop `tags`, `product_tags`, and `products.excluded_auto_tag_keys` without replacement.
- Do not add another generic `tags` table. "Tags" is the admin-facing name for the structured taxonomy module.
- Remove database and UI `is_verified` fields. Retain `is_active` on brands, models, aliases, and sizes. Candidates retain workflow `status` instead.
- Require `products.brand_id`; allow nullable `products.model_id`; require `product_variants.size_id`.
- Require every selected model to belong to the selected brand.
- Treat inactive taxonomy records as unavailable for new assignments and parsing. Do not automatically hide existing products; product visibility remains controlled by `products.is_active` and lifecycle fields.
- Require an administrator to select or create a canonical brand before saving an unrecognized product. Unknown parser vocabulary may create a candidate, but candidate text is never persisted as product taxonomy.
- Keep textual brand, model, and size values only in order-item snapshots where historical immutability is required.
- Use IDs in admin and storefront filter state. Resolve labels through joins and expose `{ id, label }` objects in application DTOs.

## Target Schema

| Table              | Purpose                             | Key rules                                                                                   |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `tag_brands`       | Canonical brand vocabulary          | Tenant-scoped label uniqueness, `is_active`, no group or verification fields                |
| `tag_models`       | Canonical model vocabulary          | Required `brand_id`, tenant-scoped label uniqueness within brand, `is_active`               |
| `tag_aliases`      | Alternate parser vocabulary         | Exactly one target (`brand_id` or `model_id`), `entity_type` must match target, `is_active` |
| `tag_candidates`   | Unrecognized parser vocabulary      | `status` workflow, optional parent brand for model candidates                               |
| `tag_sizes`        | Canonical inventory size vocabulary | `size_type`, canonical label, sort order, `is_active`                                       |
| `products`         | Product identity and lifecycle      | Required `brand_id`, optional `model_id`, no copied brand/model/tag columns                 |
| `product_variants` | Sellable size/price/stock rows      | Required `size_id`, no copied `size_label`                                                  |

## Database Invariants

- `products.model_id` must be null or identify a `tag_models` row whose `brand_id` equals `products.brand_id`.
- A product may use a global taxonomy record (`tenant_id is null`) or one owned by the product tenant, but never another tenant's record.
- A variant's `tag_sizes.size_type` must equal its product's `products.size_type`.
- Brands, models, and sizes referenced by products or variants use `ON DELETE RESTRICT`; administrators deactivate records instead of deleting referenced vocabulary.
- Aliases use a check constraint so exactly one of `brand_id` and `model_id` is populated.
- Candidate acceptance is transactional: create or reuse the canonical record, create the alias, and mark the candidate accepted together.
- Public storefront queries only expose active taxonomy options represented by visible products.

---

## File Structure

- Create: `supabase/migrations/20260718170000_tag_taxonomy_schema_reset.sql`
  - Destructively replace the old catalog and generic-tag schema with the target schema and constraints.
- Modify: `supabase/seed.sql`
  - Seed canonical brands, models, aliases, and size options using `tag_*` names.
- Delete: `supabase/snippets/Untitled query 298.sql`
  - Remove obsolete catalog/product-tag maintenance SQL.
- Regenerate: `src/types/db/database.types.ts`
  - Reflect only the new schema.
- Rename: `src/repositories/catalog-repo.ts` to `src/repositories/tag-taxonomy-repo.ts`
  - Implement structured taxonomy persistence without brand groups or verification flags.
- Rename: `src/services/catalog-service.ts` to `src/services/tag-taxonomy-service.ts`
  - Enforce taxonomy lifecycle and candidate workflows.
- Delete: `src/services/tag-service.ts`
  - Remove generic tag generation and persistence.
- Modify: `src/services/product-title-parser-service.ts`
  - Resolve active brands/models/aliases from the new repository.
- Modify: `src/services/product-title-parser.ts`
  - Remove group and verification output fields.
- Modify: `src/services/product-service.ts`
  - Persist canonical IDs and remove all tag synchronization.
- Modify: `src/repositories/product-repo.ts`
  - Join canonical labels, filter by IDs, and remove generic tag methods and joins.
- Modify: `src/repositories/orders-repo.ts`
  - Remove product-tag joins while retaining order-item snapshots.
- Modify: `src/services/storefront-service.ts`
  - Build product facets from structured taxonomy and variants.
- Modify: `src/types/domain/product.ts`
  - Replace tag and copied-string types with taxonomy references.
- Modify: `src/lib/validation/product.ts`
  - Validate IDs instead of tag arrays and copied labels.
- Delete: `src/config/constants/sizes.ts`
  - Replace static size vocabulary with seeded `tag_sizes` records.
- Delete: `src/components/inventory/TagInput.tsx`
  - Remove custom/generated tag controls.
- Modify: `src/components/inventory/ProductForm.tsx`
  - Select canonical brand, model, and size IDs.
- Modify: `app/admin/inventory/create/actions.ts`
  - Load active taxonomy from the renamed repository.
- Modify: `app/admin/inventory/[id]/edit/actions.ts`
  - Load active taxonomy and preserve selected inactive values for editing.
- Modify: `app/admin/inventory/[id]/edit/client.tsx`
  - Remove tag props and use taxonomy references.
- Modify: `src/components/admin/inventory/InventoryProductDetailsModal.tsx`
  - Remove generic tag display and show structured attributes.
- Rename: `app/admin/catalog/` to `app/admin/tags/`
  - Provide Brands, Models, Aliases, Candidates, and Sizes tabs.
- Rename: `app/api/admin/catalog/` to `app/api/admin/tags/`
  - Expose taxonomy APIs under the correct namespace.
- Delete: `app/api/store/catalog/`
  - Remove unused catalog and brand-group endpoints.
- Modify: `app/api/store/products/route.ts`
  - Accept ID-based filters and return structured facet options.
- Modify: `app/api/store/products/[id]/route.ts`
  - Return joined taxonomy labels.
- Modify: `app/api/admin/products/route.ts`
  - Accept canonical taxonomy IDs.
- Modify: `app/api/admin/products/[id]/route.ts`
  - Accept canonical taxonomy IDs.
- Modify: `app/api/admin/transactions/[orderId]/route.ts`
  - Remove product-tag response data.
- Modify: `src/components/admin/AdminSidebar.tsx`
  - Link Tags to `/admin/tags`.
- Modify: `docs/API_SPEC.md`
  - Document renamed routes and product/filter contracts.
- Create: `docs/architecture/tag-taxonomy.md`
  - Record source-of-truth boundaries and invariants.
- Create: `tests/integration/tag-taxonomy-schema.test.ts`
  - Verify tables, foreign keys, tenant constraints, and removed schema.
- Create: `tests/unit/tag-taxonomy-repo.test.ts`
  - Verify repository table names, scope, and active filtering.
- Create: `tests/unit/tag-taxonomy-service.test.ts`
  - Verify writes and candidate acceptance.
- Modify: `tests/unit/product-title-parser-service.test.ts`
  - Verify renamed lookups and parser output.
- Modify: `tests/unit/product-service.test.ts`
  - Verify ID persistence and removal of tag writes.
- Modify: `tests/unit/product-validation.test.ts`
  - Verify the new product request contract.
- Create: `tests/unit/storefront-taxonomy-filters.test.ts`
  - Verify ID-based facets and filtering.
- Create: `tests/unit/tag-taxonomy-api.test.ts`
  - Verify renamed API payloads and removed fields.

### Task 1: Lock the replacement contract with failing tests

**Files:**

- Modify: `tests/unit/product-validation.test.ts`
- Modify: `tests/unit/product-service.test.ts`
- Modify: `tests/unit/product-title-parser-service.test.ts`
- Create: `tests/unit/tag-taxonomy-service.test.ts`

- [ ] **Step 1: Add a product validation test for canonical IDs**

```ts
it("accepts taxonomy IDs and rejects legacy tag payloads", () => {
  const result = productCreateSchema.safeParse({
    ...validProduct,
    brand_id: BRAND_ID,
    model_id: MODEL_ID,
    variants: [{ ...validVariant, size_id: SIZE_ID }],
    tags: [{ label: "Nike", group_key: "brand" }],
  });

  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Add product-service tests for relational persistence**

```ts
expect(productRepo.createProduct).toHaveBeenCalledWith(
  expect.objectContaining({ brand_id: BRAND_ID, model_id: MODEL_ID }),
);
expect(productRepo.upsertTag).not.toHaveBeenCalled();
expect(productRepo.linkProductTag).not.toHaveBeenCalled();
```

- [ ] **Step 3: Add parser contract tests**

```ts
expect(result.brand).toEqual(
  expect.objectContaining({ id: BRAND_ID, label: "Nike", source: "canonical" }),
);
expect(result.brand).not.toHaveProperty("groupKey");
expect(result.brand).not.toHaveProperty("isVerified");
```

- [ ] **Step 4: Add taxonomy service tests for active records and model ownership**

```ts
await expect(service.createModel({ brandId: BRAND_ID, label: "990" })).resolves.toEqual(
  expect.objectContaining({ brand_id: BRAND_ID, canonical_label: "990" }),
);
```

- [ ] **Step 5: Run tests to verify the old contract fails**

Run: `npm run test:jest:unit -- tests/unit/product-validation.test.ts tests/unit/product-service.test.ts tests/unit/product-title-parser-service.test.ts tests/unit/tag-taxonomy-service.test.ts`
Expected: FAIL because production code still accepts generic tags, stores labels, and exposes catalog-only fields

- [ ] **Step 6: Commit the contract tests**

```bash
git add tests/unit/product-validation.test.ts tests/unit/product-service.test.ts tests/unit/product-title-parser-service.test.ts tests/unit/tag-taxonomy-service.test.ts
git commit -m "test: define relational tag taxonomy contract"
```

### Task 2: Apply the destructive taxonomy schema reset

**Files:**

- Create: `supabase/migrations/20260718170000_tag_taxonomy_schema_reset.sql`
- Modify: `supabase/seed.sql`
- Delete: `supabase/snippets/Untitled query 298.sql`
- Create: `tests/integration/tag-taxonomy-schema.test.ts`
- Regenerate: `src/types/db/database.types.ts`

- [ ] **Step 1: Add schema assertions before changing the database**

Test these conditions through `pg` and `SUPABASE_DB_URL`:

```ts
expect(tableNames).toEqual(
  expect.arrayContaining([
    "tag_brands",
    "tag_models",
    "tag_aliases",
    "tag_candidates",
    "tag_sizes",
  ]),
);
expect(tableNames).not.toEqual(
  expect.arrayContaining([
    "tags",
    "product_tags",
    "catalog_brand_groups",
    "catalog_brands",
  ]),
);
```

- [ ] **Step 2: Reset product inventory before incompatible column changes**

```sql
truncate table public.products restart identity cascade;
```

Document in the migration comment that this is intentionally destructive and approved only because no live data exists.

- [ ] **Step 3: Drop the obsolete schema**

```sql
drop table if exists public.product_tags cascade;
drop table if exists public.tags cascade;
drop table if exists public.catalog_aliases cascade;
drop table if exists public.catalog_candidates cascade;
drop table if exists public.catalog_models cascade;
drop table if exists public.catalog_brands cascade;
drop table if exists public.catalog_brand_groups cascade;
```

- [ ] **Step 4: Create the structured `tag_*` tables**

Create `tag_brands`, `tag_models`, `tag_aliases`, `tag_candidates`, and `tag_sizes` with timestamps, tenant scope, unique indexes for global and tenant records, checks, foreign keys, and RLS policies equivalent to the current admin/public requirements.

- [ ] **Step 5: Replace copied product and variant taxonomy columns**

```sql
alter table public.products
  drop column if exists brand,
  drop column if exists model,
  drop column if exists excluded_auto_tag_keys,
  add column brand_id uuid not null references public.tag_brands(id) on delete restrict,
  add column model_id uuid null;

alter table public.product_variants
  drop column if exists size_label,
  add column size_id uuid not null references public.tag_sizes(id) on delete restrict;
```

- [ ] **Step 6: Enforce model/brand and tenant consistency in PostgreSQL**

Add a composite model-brand foreign key and a trigger that rejects cross-tenant taxonomy references or a size whose `size_type` differs from its product.

```sql
alter table public.tag_models add constraint tag_models_id_brand_key unique (id, brand_id);
alter table public.products add constraint products_model_brand_fkey
  foreign key (model_id, brand_id) references public.tag_models(id, brand_id) on delete restrict;
```

- [ ] **Step 7: Add transactional candidate acceptance RPCs**

Create a security-definer function with a fixed `search_path` that accepts a candidate, creates or reuses the canonical brand/model, creates the corresponding alias, and changes candidate status in one transaction. Authorize the function for admins only and cover both brand and model candidate paths.

- [ ] **Step 8: Rewrite seed data under the new names**

Seed active canonical brand/model/alias rows and the complete current shoe, clothing, and custom size vocabulary. Use explicit `sort_order` values so `10` sorts after `9.5`, not after `1`.

- [ ] **Step 9: Reset the local database**

Run: `npx supabase db reset`
Expected: PASS; all migrations and the rewritten seed apply cleanly

- [ ] **Step 10: Regenerate database types**

Run: `npm run gen:types:local`
Expected: `database.types.ts` contains `tag_*`, `brand_id`, `model_id`, and `size_id`, with no current `tags`, `product_tags`, or `catalog_brand_groups`

- [ ] **Step 11: Run schema integration tests**

Run: `npm run test:jest:integration -- tests/integration/tag-taxonomy-schema.test.ts`
Expected: PASS, including model-brand, tenant, alias-target, size-type, and delete-restriction assertions

- [ ] **Step 12: Commit the schema reset**

```bash
git add supabase/migrations/20260718170000_tag_taxonomy_schema_reset.sql supabase/seed.sql src/types/db/database.types.ts tests/integration/tag-taxonomy-schema.test.ts
git rm "supabase/snippets/Untitled query 298.sql"
git commit -m "refactor: replace catalog and product tags with taxonomy schema"
```

### Task 3: Rename and simplify the taxonomy repository and service

**Files:**

- Rename: `src/repositories/catalog-repo.ts` to `src/repositories/tag-taxonomy-repo.ts`
- Rename: `src/services/catalog-service.ts` to `src/services/tag-taxonomy-service.ts`
- Create: `tests/unit/tag-taxonomy-repo.test.ts`
- Modify: `tests/unit/tag-taxonomy-service.test.ts`

- [ ] **Step 1: Write repository tests against `tag_*` tables**

Verify global-plus-tenant reads, `includeInactive`, brand-scoped model reads, alias target filtering, size ordering, and candidate status filtering.

- [ ] **Step 2: Rename classes and imports**

```ts
export class TagTaxonomyRepository {}
export class TagTaxonomyService {}
```

- [ ] **Step 3: Replace table type aliases and Supabase calls**

```ts
type BrandRow = Tables<"tag_brands">;
type ModelRow = Tables<"tag_models">;
type SizeRow = Tables<"tag_sizes">;
```

- [ ] **Step 4: Remove all group and verification behavior**

Delete brand-group methods, `groupId` filters, `listBrandsWithGroups`, `isVerified` inputs, and verification mutation paths.

- [ ] **Step 5: Add size vocabulary operations**

Implement list/create/update methods. Permit deactivation, and return a conflict when attempting to delete a referenced size rather than cascading inventory.

- [ ] **Step 6: Make candidate acceptance transactional**

Call the database RPC created in Task 2 so canonical creation, alias creation, and candidate status cannot diverge.

- [ ] **Step 7: Run repository and service tests**

Run: `npm run test:jest:unit -- tests/unit/tag-taxonomy-repo.test.ts tests/unit/tag-taxonomy-service.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/repositories/tag-taxonomy-repo.ts src/services/tag-taxonomy-service.ts tests/unit/tag-taxonomy-repo.test.ts tests/unit/tag-taxonomy-service.test.ts
git rm src/repositories/catalog-repo.ts src/services/catalog-service.ts
git commit -m "refactor: rename catalog services to tag taxonomy"
```

### Task 4: Move title parsing onto the taxonomy contract

**Files:**

- Modify: `src/services/product-title-parser-service.ts`
- Modify: `src/services/product-title-parser.ts`
- Modify: `tests/unit/product-title-parser-service.test.ts`

- [ ] **Step 1: Update parser fixtures to use `tag_*` rows**

Mock `TagTaxonomyRepository` and retain the existing cache-per-tenant assertion.

- [ ] **Step 2: Remove group and verification output**

Use `source` and `confidence` as the only match-quality signals.

```ts
type TaxonomyMatch = {
  id: string;
  label: string;
  source: "canonical" | "alias" | "override";
  confidence: number;
};
```

- [ ] **Step 3: Resolve only active records**

An inactive alias, brand, or model must not be selected by automatic parsing. Explicit edit rendering may still display an inactive record already referenced by a product.

- [ ] **Step 4: Preserve candidate creation semantics**

Unknown brands create brand candidates. Unknown models create model candidates only when a canonical parent brand is known. Candidate output does not become product data.

- [ ] **Step 5: Run parser tests**

Run: `npm run test:jest:unit -- tests/unit/product-title-parser-service.test.ts`
Expected: PASS with no `CatalogRepository`, `groupKey`, or `isVerified` contract

- [ ] **Step 6: Commit**

```bash
git add src/services/product-title-parser-service.ts src/services/product-title-parser.ts tests/unit/product-title-parser-service.test.ts
git commit -m "refactor: resolve product titles through tag taxonomy"
```

### Task 5: Replace the product write contract with taxonomy IDs

**Files:**

- Modify: `src/types/domain/product.ts`
- Modify: `src/lib/validation/product.ts`
- Modify: `src/services/product-service.ts`
- Modify: `tests/unit/product-validation.test.ts`
- Modify: `tests/unit/product-service.test.ts`
- Delete: `src/services/tag-service.ts`

- [ ] **Step 1: Define structured product references**

```ts
type TaxonomyOption = { id: string; label: string };

type Product = {
  brand: TaxonomyOption;
  model: TaxonomyOption | null;
  variants: Array<ProductVariant & { size: TaxonomyOption }>;
};
```

- [ ] **Step 2: Replace request validation fields**

Accept `brand_id`, nullable `model_id`, and per-variant `size_id`. Reject `brand`, `model`, `tags`, `excluded_auto_tag_keys`, and `size_label` as unknown keys by making the Zod object strict.

- [ ] **Step 3: Validate active ownership before writes**

Load the selected brand, model, and sizes through `TagTaxonomyRepository`. Return a validation error when a record is inactive, tenant-inaccessible, model/brand mismatched, or size-type mismatched.

- [ ] **Step 4: Persist IDs only**

```ts
await repo.createProduct({
  ...productFields,
  brand_id: input.brand_id,
  model_id: input.model_id ?? null,
});
```

- [ ] **Step 5: Delete all generic tag synchronization**

Remove `upsertTags`, `linkProductTag`, `unlinkProductTags`, `syncSizeTags`, generated brand/model/category/condition/size tags, and excluded-auto-tag handling.

- [ ] **Step 6: Update duplicate-product behavior**

Copy `brand_id`, `model_id`, and each variant's `size_id`. Do not synthesize labels or tags.

- [ ] **Step 7: Run product tests**

Run: `npm run test:jest:unit -- tests/unit/product-validation.test.ts tests/unit/product-service.test.ts tests/unit/product-sku-service.test.ts`
Expected: PASS; test doubles have no generic tag methods

- [ ] **Step 8: Commit**

```bash
git add src/types/domain/product.ts src/lib/validation/product.ts src/services/product-service.ts tests/unit/product-validation.test.ts tests/unit/product-service.test.ts
git rm src/services/tag-service.ts
git commit -m "refactor: persist product taxonomy by id"
```

### Task 6: Convert product reads, filters, and order snapshots

**Files:**

- Modify: `src/repositories/product-repo.ts`
- Modify: `src/repositories/orders-repo.ts`
- Modify: `src/services/storefront-service.ts`
- Modify: `app/api/store/products/route.ts`
- Modify: `app/api/store/products/[id]/route.ts`
- Modify: `app/api/admin/transactions/[orderId]/route.ts`
- Create: `tests/unit/storefront-taxonomy-filters.test.ts`

- [ ] **Step 1: Write failing filter tests using IDs**

```ts
await service.listProducts({
  brandIds: [BRAND_ID],
  modelIds: [MODEL_ID],
  sizeIds: [SIZE_ID],
});
```

- [ ] **Step 2: Replace copied-label filters with foreign-key filters**

Filter products by `brand_id` and `model_id`; filter variants by `size_id`. Do not compare canonical labels in database predicates.

- [ ] **Step 3: Join labels into product DTOs**

Select brand, model, and size relations and map them to `{ id, label }`. Remove all `tags:product_tags(tag:tags(*))` selects and mapping code.

- [ ] **Step 4: Build facet options from visible inventory**

Return active options represented by visible, in-stock products with IDs, labels, and counts. Do not list every taxonomy row or use generic tags as facets.

- [ ] **Step 5: Preserve textual order snapshots**

At checkout/order creation, copy the joined canonical brand, model, and size labels into order-item snapshot columns. Order reads must use snapshots and must not depend on a taxonomy record remaining active.

- [ ] **Step 6: Remove tags from transaction responses**

Delete tag joins and response properties from order detail APIs and admin displays.

- [ ] **Step 7: Run storefront and existing checkout tests**

Run: `npm run test:jest:unit -- tests/unit/storefront-taxonomy-filters.test.ts tests/unit/checkout-pricing-service.test.ts tests/unit/checkout-page.test.tsx`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/repositories/product-repo.ts src/repositories/orders-repo.ts src/services/storefront-service.ts app/api/store/products app/api/admin/transactions tests/unit/storefront-taxonomy-filters.test.ts
git commit -m "refactor: query storefront taxonomy by id"
```

### Task 7: Rename the admin APIs from catalog to tags

**Files:**

- Rename: `app/api/admin/catalog/` to `app/api/admin/tags/`
- Delete: `app/api/admin/tags/brand-groups/`
- Create: `app/api/admin/tags/sizes/route.ts`
- Create: `app/api/admin/tags/sizes/[id]/route.ts`
- Delete: `app/api/store/catalog/`
- Create: `tests/unit/tag-taxonomy-api.test.ts`
- Modify: `docs/API_SPEC.md`

- [ ] **Step 1: Write route tests for the new namespace**

Cover brands, models, aliases, candidates, candidate accept/reject, sizes, and parse-title. Assert request and response bodies do not contain `group_id` or `is_verified`.

- [ ] **Step 2: Move routes to `/api/admin/tags/*`**

Update imports, route metadata used in logging, validation names, and test mocks. Do not leave forwarding `/api/admin/catalog/*` routes because there are no external clients to preserve.

- [ ] **Step 3: Remove brand-group routes**

Delete both collection and item handlers. Remove the public brand-group and catalog-brand routes because storefront facets come from product inventory.

- [ ] **Step 4: Add size endpoints**

Support listing by `sizeType`, creating a canonical option, and editing label/order/active state. Allow deactivation even when referenced because it only prevents future assignment. Do not expose a size DELETE endpoint; referenced vocabulary remains protected by `ON DELETE RESTRICT`.

- [ ] **Step 5: Update API documentation**

Document ID-based product payloads, ID-based storefront query parameters, taxonomy response objects, and `/api/admin/tags/*` routes.

- [ ] **Step 6: Run API tests**

Run: `npm run test:jest:unit -- tests/unit/tag-taxonomy-api.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/tags app/api/store/products docs/API_SPEC.md tests/unit/tag-taxonomy-api.test.ts
git rm -r app/api/admin/catalog app/api/store/catalog
git commit -m "refactor: expose taxonomy under tag api routes"
```

### Task 8: Rebuild the admin Tags module around structured vocabulary

**Files:**

- Rename: `app/admin/catalog/` to `app/admin/tags/`
- Modify: `app/admin/tags/page.tsx`
- Rename: `app/admin/tags/components/TagModals.tsx` to `app/admin/tags/components/TaxonomyModals.tsx`
- Modify: `app/admin/tags/types.ts`
- Modify: `src/components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Change the route and sidebar link**

Use `/admin/tags` as the only admin page. Do not retain a catalog redirect or duplicate page.

- [ ] **Step 2: Remove obsolete controls**

Delete brand-group loading, group columns, group selectors, verified filters, verified pills, and verified toggles.

- [ ] **Step 3: Keep the structured workflows**

Provide tabs for Brands, Models, Aliases, Candidates, and Sizes. Each tab uses canonical IDs internally and displays canonical labels.

- [ ] **Step 4: Add size management**

Group size rows by `size_type`, permit explicit ordering, and show active/inactive status. The UI label "Tags" remains the module name, but no free-form product tag editor is introduced.

- [ ] **Step 5: Update every fetch URL**

Replace `/api/admin/catalog/*` with `/api/admin/tags/*` and update frontend telemetry event names from catalog to tag taxonomy.

- [ ] **Step 6: Run typecheck for the admin module**

Run: `npm run typecheck`
Expected: Any remaining failures identify consumers that still use the old schema; no errors should remain under `app/admin/tags`

- [ ] **Step 7: Commit**

```bash
git add app/admin/tags src/components/admin/AdminSidebar.tsx
git rm -r app/admin/catalog
git commit -m "refactor: rebuild admin catalog as tags manager"
```

### Task 9: Remove product tag controls and use canonical size selection

**Files:**

- Modify: `src/components/inventory/ProductForm.tsx`
- Delete: `src/components/inventory/TagInput.tsx`
- Delete: `src/config/constants/sizes.ts`
- Modify: `app/admin/inventory/create/actions.ts`
- Modify: `app/admin/inventory/[id]/edit/actions.ts`
- Modify: `app/admin/inventory/[id]/edit/client.tsx`
- Modify: `src/components/admin/inventory/InventoryProductDetailsModal.tsx`

- [ ] **Step 1: Load active taxonomy for inventory forms**

Load active brands and sizes on create. On edit, also include the product's currently selected inactive brand/model/size so an old record can render without becoming selectable for other products.

- [ ] **Step 2: Replace parser override state with canonical selection state**

Store `brandId`, `modelId`, and variant `sizeId` in the form. Parser matches may preselect IDs; administrators can override them from the canonical options.

- [ ] **Step 3: Remove all generic tag state and UI**

Delete `customTags`, `autoTags`, `visibleAutoTags`, `excludedAutoTagKeys`, `TagInput`, add/remove handlers, tag payload fields, and helper constants such as `AUTO_TAG_GROUP_KEYS`.

- [ ] **Step 4: Replace static sizes with API-backed options**

When `size_type` changes, clear incompatible variant selections and load matching active `tag_sizes`. Require a selected size ID for every variant.

- [ ] **Step 5: Update detail rendering**

Show Brand, Model, Category, Condition, and Size as structured attributes. Do not render a Tags section that reconstructs the removed generic records.

- [ ] **Step 6: Run product and type tests**

Run: `npm run test:jest:unit -- tests/unit/product-validation.test.ts tests/unit/product-service.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS or only failures in storefront components addressed by Task 10

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/ProductForm.tsx app/admin/inventory src/components/admin/inventory/InventoryProductDetailsModal.tsx
git rm src/components/inventory/TagInput.tsx src/config/constants/sizes.ts
git commit -m "refactor: select structured taxonomy in inventory forms"
```

### Task 10: Update storefront and downstream display consumers

**Files:**

- Modify: `app/(store)/store/page.tsx`
- Modify: `app/(store)/store/[productId]/page.tsx`
- Modify: `src/components/store/FilterPanel.tsx`
- Modify: `src/components/store/StorefrontFilterBar.tsx`
- Modify: `src/components/store/VirtualizedBrandList.tsx`
- Modify: `src/components/store/ProductCard.tsx`
- Modify: `src/components/store/ProductDetail.tsx`
- Modify: `src/components/search/SearchOverlay.tsx`
- Modify: `src/components/home/FeaturedItems.tsx`
- Modify: `src/repositories/featured-items-repo.ts`
- Modify: `app/api/featured-items/route.ts`
- Modify: `src/components/cart/CartProvider.tsx`
- Modify: `src/components/cart/CartDrawer.tsx`
- Modify: `src/components/cart/CartPeekDrawer.tsx`
- Modify: `src/components/account/AccountProfile.tsx`
- Modify: `src/components/admin/orders/OrderItemDetailsModal.tsx`
- Modify: `app/admin/pickups/page.tsx`
- Modify: `app/admin/shipping/page.tsx`
- Modify: `app/admin/transactions/[orderId]/page.tsx`
- Modify: `src/services/order-email-service.ts`
- Modify: `app/api/admin/orders/[orderId]/resend-email/route.ts`
- Modify: `tests/unit/storefront-taxonomy-filters.test.ts`

- [ ] **Step 1: Verify the affected-consumer inventory before editing**

Run: `rg -n "product\.brand|product\.model|size_label|filters\.brand|filters\.model" app src --glob '!src/types/db/database.types.ts'`
Expected: Every match is covered by this task, Tasks 5-6, or explicitly documented as an order-item snapshot

- [ ] **Step 2: Use structured display values**

Render `product.brand.label`, optional `product.model?.label`, and `variant.size.label` rather than copied strings.

- [ ] **Step 3: Store IDs in collection filter state**

Use `brandIds`, `modelIds`, and `sizeIds` in URL search parameters. Labels are presentation only and changing a label must not invalidate a saved filter.

- [ ] **Step 4: Keep model options constrained by brand**

When selected brands change, remove selected model IDs that do not belong to those brands. Disable model filters until the relevant model options are available.

- [ ] **Step 5: Preserve search behavior without a search engine**

Continue the current database-backed search. Match product title and joined canonical brand/model labels only; do not promise fuzzy generic-tag search.

- [ ] **Step 6: Run filter and checkout tests**

Run: `npm run test:jest:unit -- tests/unit/storefront-taxonomy-filters.test.ts tests/unit/checkout-pricing-service.test.ts tests/unit/checkout-page.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app src tests/unit/storefront-taxonomy-filters.test.ts
git commit -m "refactor: consume structured taxonomy across storefront"
```

### Task 11: Remove remaining legacy references and document boundaries

**Files:**

- Create: `docs/architecture/tag-taxonomy.md`
- Modify: any runtime file returned by the reference audit
- Modify: `src/types/db/database.types.ts` only through regeneration

- [ ] **Step 1: Document source-of-truth rules**

Record that brands/models/sizes are canonical entities, aliases are parser inputs, candidates are moderation work, categories/conditions remain product fields, and order items hold immutable display snapshots.

- [ ] **Step 2: Audit runtime code for old catalog naming**

Run:

```bash
rg -n "catalog_|CatalogRepository|CatalogService|/admin/catalog|/api/admin/catalog|/api/store/catalog" app src tests supabase/seed.sql docs/API_SPEC.md
```

Expected: No matches. Historical files under `supabase/migrations` are intentionally excluded.

- [ ] **Step 3: Audit generic tag plumbing**

Run:

```bash
rg -n "product_tags|excluded_auto_tag_keys|upsertTags|linkProductTag|unlinkProductTags|syncSizeTags|TagInput|Tables<\"tags\">" app src tests supabase/seed.sql
```

Expected: No matches

- [ ] **Step 4: Audit removed group and verification concepts**

Run:

```bash
rg -n "brand.?group|group_id|groupKey|is_verified|isVerified|designer_brand" app src tests supabase/seed.sql
```

Expected: No taxonomy matches; review unrelated matches manually before removal

- [ ] **Step 5: Regenerate types and verify a clean diff**

Run: `npm run gen:types:local`
Expected: No unexpected generated changes after the committed schema update

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/tag-taxonomy.md app src tests supabase/seed.sql docs/API_SPEC.md src/types/db/database.types.ts
git commit -m "docs: define tag taxonomy source of truth"
```

### Task 12: Full verification and manual acceptance

**Files:**

- Verify: all files changed by Tasks 1-11

- [ ] **Step 1: Rebuild the local database from zero**

Run: `npx supabase db reset`
Expected: PASS with no manual SQL intervention

- [ ] **Step 2: Run all unit tests**

Run: `npm run test:jest:unit`
Expected: PASS

- [ ] **Step 3: Run all integration tests**

Run: `npm run test:jest:integration`
Expected: PASS

- [ ] **Step 4: Run RLS checks**

Run: `npm run test:rls`
Expected: PASS for global, tenant, admin, and storefront taxonomy access

- [ ] **Step 5: Run static verification**

Run: `npm run lint`
Expected: PASS

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Smoke-test taxonomy administration**

```text
1. Open /admin/tags.
2. Create and deactivate a brand.
3. Create a model under an active brand.
4. Create brand and model aliases.
5. Accept and reject parser candidates.
6. Add and reorder shoe, clothing, and custom sizes.
7. Confirm there are no Brand Groups or Verified controls.
```

- [ ] **Step 7: Smoke-test product inventory**

```text
1. Create a product by selecting a canonical brand and optional model.
2. Add variants using canonical size options.
3. Confirm mismatched model/brand and size type are rejected.
4. Edit and duplicate the product; confirm IDs and variant sizes persist.
5. Confirm no generic tag input or generated-tag chips appear.
```

- [ ] **Step 8: Smoke-test storefront and orders**

```text
1. Filter by brand, model, and size and confirm URL state uses IDs.
2. Rename a canonical label and confirm existing products and saved ID filters still resolve.
3. Search by title, brand label, and model label.
4. Add a sized variant to cart and complete a test order.
5. Deactivate the taxonomy rows and confirm the order still displays snapshot labels.
```

- [ ] **Step 9: Review the destructive migration gate**

Confirm again that the destination environment has no live product/order data. If that assumption has changed, stop deployment and write an explicit backfill/cutover migration instead of running this reset.

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "refactor: complete tag taxonomy schema reset"
```
