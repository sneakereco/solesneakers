# Tag Taxonomy

The `tag_*` tables are a structured product taxonomy namespace, not a generic tagging system.

## Sources Of Truth

- `tag_brands` owns canonical brand labels.
- `tag_models` owns canonical model labels and each model belongs to one brand.
- `tag_sizes` owns canonical size labels grouped by `size_type` and ordered by `sort_order`.
- `tag_aliases` contains alternate brand/model vocabulary used only by title parsing.
- `tag_candidates` contains unrecognized parser vocabulary awaiting an admin decision.
- `products.category` and `products.condition` remain direct product attributes.
- `order_items` stores immutable text snapshots for brand, model, and size at purchase time.

Products reference a required `brand_id` and optional `model_id`. Variants reference a required `size_id`. Application DTOs expose taxonomy values as `{ id, label }`; writes and storefront URL filters use IDs. Labels are presentation data and can change without breaking product relationships or saved filters.

## Invariants

- A selected model must belong to the product's selected brand.
- A selected size must have the same `size_type` as its product.
- Global taxonomy records and records owned by the product tenant may be assigned; another tenant's records may not.
- Inactive records cannot be assigned to new products or used by the parser, but existing products are not hidden automatically.
- Referenced canonical records are deactivated rather than deleted.
- Candidate acceptance creates or reuses a canonical record, creates its alias, and closes the candidate in one database transaction.

There is no `tags` or `product_tags` table and no free-form product tag editor. The admin module is named **Tags** because it manages this structured taxonomy.
