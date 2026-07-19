begin;

insert into public.tenants (name)
select 'Realdealkickzsc'
where not exists (select 1 from public.tenants where name = 'Realdealkickzsc');

insert into public.tag_brands (tenant_id, canonical_label)
select null, label
from (values ('Other'), ('Nike'), ('Air Jordan'), ('Adidas'), ('New Balance')) as seed(label)
where not exists (
  select 1 from public.tag_brands b
  where b.tenant_id is null and lower(b.canonical_label) = lower(seed.label)
);

insert into public.tag_models (tenant_id, brand_id, canonical_label)
select null, brand.id, seed.model_label
from (
  values
    ('Nike', 'Dunk'),
    ('Nike', 'Air Force 1'),
    ('Nike', 'Air Max'),
    ('Air Jordan', 'Jordan 1'),
    ('Air Jordan', 'Jordan 4'),
    ('Adidas', 'Yeezy'),
    ('New Balance', '990')
) as seed(brand_label, model_label)
join public.tag_brands brand
  on brand.tenant_id is null and brand.canonical_label = seed.brand_label
where not exists (
  select 1 from public.tag_models model
  where model.brand_id = brand.id
    and model.tenant_id is null
    and lower(model.canonical_label) = lower(seed.model_label)
);

insert into public.tag_aliases (
  tenant_id, entity_type, brand_id, alias_label, alias_normalized, priority
)
select null, 'brand', brand.id, seed.alias_label, seed.alias_normalized, seed.priority
from (
  values
    ('Other', 'other', 'other', -100),
    ('Nike', 'nike', 'nike', 50),
    ('Air Jordan', 'jordan', 'jordan', 30),
    ('Air Jordan', 'air jordan', 'air jordan', 40),
    ('Adidas', 'adidas', 'adidas', 20),
    ('New Balance', 'new balance', 'new balance', 20),
    ('New Balance', 'nb', 'nb', 10)
) as seed(brand_label, alias_label, alias_normalized, priority)
join public.tag_brands brand
  on brand.tenant_id is null and brand.canonical_label = seed.brand_label
where not exists (
  select 1 from public.tag_aliases alias
  where alias.tenant_id is null
    and alias.entity_type = 'brand'
    and alias.alias_normalized = seed.alias_normalized
);

insert into public.tag_aliases (
  tenant_id, entity_type, model_id, alias_label, alias_normalized, priority
)
select null, 'model', model.id, seed.alias_label, seed.alias_normalized, seed.priority
from (
  values
    ('Nike', 'Dunk', 'dunk', 'dunk', 20),
    ('Nike', 'Air Force 1', 'air force 1', 'air force 1', 20),
    ('Nike', 'Air Force 1', 'af1', 'af1', 15),
    ('Air Jordan', 'Jordan 1', 'jordan 1', 'jordan 1', 20),
    ('Air Jordan', 'Jordan 4', 'jordan 4', 'jordan 4', 20),
    ('Adidas', 'Yeezy', 'yeezy', 'yeezy', 20),
    ('New Balance', '990', '990', '990', 20)
) as seed(brand_label, model_label, alias_label, alias_normalized, priority)
join public.tag_brands brand
  on brand.tenant_id is null and brand.canonical_label = seed.brand_label
join public.tag_models model
  on model.brand_id = brand.id and model.tenant_id is null and model.canonical_label = seed.model_label
where not exists (
  select 1 from public.tag_aliases alias
  where alias.tenant_id is null
    and alias.entity_type = 'model'
    and alias.alias_normalized = seed.alias_normalized
);

insert into public.tag_sizes (tenant_id, size_type, canonical_label, sort_order)
select null, seed.size_type, seed.label, seed.sort_order
from (
  values
    ('none', 'OS', 0),
    ('custom', 'OS', 0),
    ('clothing', 'XXS', 10), ('clothing', 'XS', 20),
    ('clothing', 'SMALL', 30), ('clothing', 'MEDIUM', 40),
    ('clothing', 'LARGE', 50), ('clothing', 'XL', 60),
    ('clothing', '2XL', 70), ('clothing', '3XL', 80),
    ('clothing', '28', 100), ('clothing', '29', 110),
    ('clothing', '30', 120), ('clothing', '31', 130),
    ('clothing', '32', 140), ('clothing', '33', 150),
    ('clothing', '34', 160), ('clothing', '36', 170),
    ('clothing', '38', 180), ('clothing', '40', 190),
    ('shoe', '3.5Y / 5W', 10), ('shoe', '4Y / 5.5W', 20),
    ('shoe', '4.5Y / 6W', 30), ('shoe', '5Y / 6.5W', 40),
    ('shoe', '5.5Y / 7W', 50), ('shoe', '6Y / 7.5W', 60),
    ('shoe', '6.5Y / 8W', 70), ('shoe', '7Y / 8.5W', 80),
    ('shoe', '7.5M / 9W', 90), ('shoe', '8M / 9.5W', 100),
    ('shoe', '8.5M / 10W', 110), ('shoe', '9M / 10.5W', 120),
    ('shoe', '9.5M / 11W', 130), ('shoe', '10M / 11.5W', 140),
    ('shoe', '10.5M / 12W', 150), ('shoe', '11M / 12.5W', 160),
    ('shoe', '11.5M / 13W', 170), ('shoe', '12M / 13.5W', 180),
    ('shoe', '12.5M / 14W', 190), ('shoe', '13M / 14.5W', 200),
    ('shoe', '13.5M / 15W', 210), ('shoe', '14M / 15.5W', 220),
    ('shoe', '15M / 16.5W', 230),
    ('shoe', 'EU 35 (US 5.5W)', 300), ('shoe', 'EU 36 (US 6W)', 310),
    ('shoe', 'EU 36.5 (US 6.5W)', 320), ('shoe', 'EU 37 (US 7W)', 330),
    ('shoe', 'EU 37.5 (US 7.5W)', 340), ('shoe', 'EU 38 (US 8W)', 350),
    ('shoe', 'EU 38.5 (US 8.5W)', 360), ('shoe', 'EU 39 (US 7M)', 370),
    ('shoe', 'EU 39.5 (US 7M)', 380), ('shoe', 'EU 40 (US 7M)', 390),
    ('shoe', 'EU 40 (US 8M)', 400), ('shoe', 'EU 41 (US 8.5M)', 410),
    ('shoe', 'EU 42 (US 9M)', 420), ('shoe', 'EU 43 (US 10M)', 430),
    ('shoe', 'EU 44 (US 11M)', 440), ('shoe', 'EU 45 (US 12M)', 450),
    ('shoe', 'EU 46 (US 13M)', 460), ('shoe', 'EU 47 (US 14M)', 470),
    ('shoe', 'EU 48 (US 15M)', 480), ('shoe', 'EU 49 (US 16M)', 490)
) as seed(size_type, label, sort_order)
where not exists (
  select 1 from public.tag_sizes size
  where size.tenant_id is null
    and size.size_type = seed.size_type
    and lower(size.canonical_label) = lower(seed.label)
);

commit;
