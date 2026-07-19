begin;

-- This reset is intentionally destructive. The application has no live catalog,
-- product, or order data and is replacing two competing taxonomy systems.
truncate table public.products restart identity cascade;

drop table if exists public.product_tags cascade;
drop table if exists public.tags cascade;
drop table if exists public.catalog_aliases cascade;
drop table if exists public.catalog_candidates cascade;
drop table if exists public.catalog_models cascade;
drop table if exists public.catalog_brands cascade;
drop table if exists public.catalog_brand_groups cascade;

create table public.tag_brands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  canonical_label text not null check (length(trim(canonical_label)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tag_brands_global_label_key
  on public.tag_brands (lower(canonical_label))
  where tenant_id is null;
create unique index tag_brands_tenant_label_key
  on public.tag_brands (tenant_id, lower(canonical_label))
  where tenant_id is not null;

create table public.tag_models (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  brand_id uuid not null references public.tag_brands(id) on delete restrict,
  canonical_label text not null check (length(trim(canonical_label)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_models_id_brand_key unique (id, brand_id)
);

create unique index tag_models_global_label_key
  on public.tag_models (brand_id, lower(canonical_label))
  where tenant_id is null;
create unique index tag_models_tenant_label_key
  on public.tag_models (tenant_id, brand_id, lower(canonical_label))
  where tenant_id is not null;

create table public.tag_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('brand', 'model')),
  brand_id uuid null references public.tag_brands(id) on delete cascade,
  model_id uuid null references public.tag_models(id) on delete cascade,
  alias_label text not null check (length(trim(alias_label)) > 0),
  alias_normalized text not null check (length(trim(alias_normalized)) > 0),
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_aliases_target_check check (
    (entity_type = 'brand' and brand_id is not null and model_id is null) or
    (entity_type = 'model' and model_id is not null and brand_id is null)
  )
);

create unique index tag_aliases_global_key
  on public.tag_aliases (entity_type, alias_normalized)
  where tenant_id is null;
create unique index tag_aliases_tenant_key
  on public.tag_aliases (tenant_id, entity_type, alias_normalized)
  where tenant_id is not null;

create table public.tag_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null check (entity_type in ('brand', 'model')),
  raw_text text not null check (length(trim(raw_text)) > 0),
  normalized_text text not null check (length(trim(normalized_text)) > 0),
  parent_brand_id uuid null references public.tag_brands(id) on delete restrict,
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_candidates_parent_check check (
    (entity_type = 'brand' and parent_brand_id is null) or
    (entity_type = 'model' and parent_brand_id is not null)
  )
);

create index tag_candidates_tenant_status_idx
  on public.tag_candidates (tenant_id, status, created_at desc);

create table public.tag_sizes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null references public.tenants(id) on delete cascade,
  size_type text not null check (size_type in ('shoe', 'clothing', 'custom', 'none')),
  canonical_label text not null check (length(trim(canonical_label)) > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index tag_sizes_global_label_key
  on public.tag_sizes (size_type, lower(canonical_label))
  where tenant_id is null;
create unique index tag_sizes_tenant_label_key
  on public.tag_sizes (tenant_id, size_type, lower(canonical_label))
  where tenant_id is not null;
create index tag_sizes_sort_idx
  on public.tag_sizes (size_type, sort_order, canonical_label);

alter table public.products
  drop column if exists brand,
  drop column if exists model,
  drop column if exists excluded_auto_tag_keys,
  add column brand_id uuid not null references public.tag_brands(id) on delete restrict,
  add column model_id uuid null;

alter table public.products
  add constraint products_model_brand_fkey
  foreign key (model_id, brand_id)
  references public.tag_models(id, brand_id)
  on delete restrict;

create index products_brand_id_idx on public.products (brand_id);
create index products_model_id_idx on public.products (model_id);

alter table public.product_variants
  drop constraint if exists product_variants_unique_per_size,
  drop column if exists size_label,
  add column size_id uuid not null references public.tag_sizes(id) on delete restrict,
  add constraint product_variants_unique_per_size unique (product_id, size_id);

create index product_variants_size_id_idx on public.product_variants (size_id);

create or replace function public.validate_product_taxonomy_refs()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  brand_tenant uuid;
  model_tenant uuid;
begin
  select tenant_id into brand_tenant from public.tag_brands where id = new.brand_id;
  if not found then
    raise exception 'Unknown brand';
  end if;
  if brand_tenant is not null and brand_tenant is distinct from new.tenant_id then
    raise exception 'Brand belongs to another tenant';
  end if;

  if new.model_id is not null then
    select tenant_id into model_tenant from public.tag_models where id = new.model_id;
    if not found then
      raise exception 'Unknown model';
    end if;
    if model_tenant is not null and model_tenant is distinct from new.tenant_id then
      raise exception 'Model belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;

create trigger products_validate_taxonomy
  before insert or update of tenant_id, brand_id, model_id on public.products
  for each row execute function public.validate_product_taxonomy_refs();

create or replace function public.validate_variant_size_ref()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  product_size_type text;
  product_tenant uuid;
  option_size_type text;
  option_tenant uuid;
begin
  select size_type, tenant_id into product_size_type, product_tenant
  from public.products where id = new.product_id;
  select size_type, tenant_id into option_size_type, option_tenant
  from public.tag_sizes where id = new.size_id;

  if option_size_type is distinct from product_size_type then
    raise exception 'Size option does not match product size type';
  end if;
  if option_tenant is not null and option_tenant is distinct from product_tenant then
    raise exception 'Size option belongs to another tenant';
  end if;
  return new;
end;
$$;

create trigger product_variants_validate_size
  before insert or update of product_id, size_id on public.product_variants
  for each row execute function public.validate_variant_size_ref();

create trigger tag_brands_set_updated_at
  before update on public.tag_brands
  for each row execute function public.rdk_set_updated_at();
create trigger tag_models_set_updated_at
  before update on public.tag_models
  for each row execute function public.rdk_set_updated_at();
create trigger tag_aliases_set_updated_at
  before update on public.tag_aliases
  for each row execute function public.rdk_set_updated_at();
create trigger tag_candidates_set_updated_at
  before update on public.tag_candidates
  for each row execute function public.rdk_set_updated_at();
create trigger tag_sizes_set_updated_at
  before update on public.tag_sizes
  for each row execute function public.rdk_set_updated_at();

alter table public.tag_brands enable row level security;
alter table public.tag_models enable row level security;
alter table public.tag_aliases enable row level security;
alter table public.tag_candidates enable row level security;
alter table public.tag_sizes enable row level security;

grant select on public.tag_brands, public.tag_models, public.tag_aliases, public.tag_sizes
  to anon, authenticated;
grant select, insert, update, delete on
  public.tag_brands,
  public.tag_models,
  public.tag_aliases,
  public.tag_candidates,
  public.tag_sizes
  to authenticated;
grant all on
  public.tag_brands,
  public.tag_models,
  public.tag_aliases,
  public.tag_candidates,
  public.tag_sizes
  to service_role;

create policy "Public can view active tag brands" on public.tag_brands
  for select to public using (is_active = true);
create policy "Admins can manage tag brands" on public.tag_brands
  for all to public
  using (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()))
  with check (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()));

create policy "Public can view active tag models" on public.tag_models
  for select to public using (is_active = true);
create policy "Admins can manage tag models" on public.tag_models
  for all to public
  using (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()))
  with check (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()));

create policy "Public can view active tag aliases" on public.tag_aliases
  for select to public using (is_active = true);
create policy "Admins can manage tag aliases" on public.tag_aliases
  for all to public
  using (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()))
  with check (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()));

create policy "Admins can manage tag candidates" on public.tag_candidates
  for all to public
  using (public.is_admin_for_tenant(tenant_id))
  with check (public.is_admin_for_tenant(tenant_id));

create policy "Public can view active tag sizes" on public.tag_sizes
  for select to public using (is_active = true);
create policy "Admins can manage tag sizes" on public.tag_sizes
  for all to public
  using (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()))
  with check (public.is_admin_for_tenant(tenant_id) or (tenant_id is null and public.is_admin()));

create or replace function public.accept_tag_candidate(
  candidate_id uuid,
  accepted_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.tag_candidates%rowtype;
  target_id uuid;
begin
  select * into candidate
  from public.tag_candidates
  where id = candidate_id
  for update;

  if not found or candidate.status <> 'new' then
    raise exception 'Candidate is not available';
  end if;
  if not public.is_admin_for_tenant(candidate.tenant_id) then
    raise exception 'Not authorized';
  end if;
  if length(trim(accepted_label)) = 0 then
    raise exception 'Canonical label is required';
  end if;

  if candidate.entity_type = 'brand' then
    select id into target_id from public.tag_brands
    where tenant_id = candidate.tenant_id and lower(canonical_label) = lower(trim(accepted_label));
    if target_id is null then
      insert into public.tag_brands (tenant_id, canonical_label)
      values (candidate.tenant_id, trim(accepted_label)) returning id into target_id;
    end if;
    if not exists (
      select 1 from public.tag_aliases
      where tenant_id = candidate.tenant_id and entity_type = 'brand' and alias_normalized = candidate.normalized_text
    ) then
      insert into public.tag_aliases (tenant_id, entity_type, brand_id, alias_label, alias_normalized)
      values (candidate.tenant_id, 'brand', target_id, candidate.raw_text, candidate.normalized_text);
    end if;
  else
    select id into target_id from public.tag_models
    where tenant_id = candidate.tenant_id
      and brand_id = candidate.parent_brand_id
      and lower(canonical_label) = lower(trim(accepted_label));
    if target_id is null then
      insert into public.tag_models (tenant_id, brand_id, canonical_label)
      values (candidate.tenant_id, candidate.parent_brand_id, trim(accepted_label)) returning id into target_id;
    end if;
    if not exists (
      select 1 from public.tag_aliases
      where tenant_id = candidate.tenant_id and entity_type = 'model' and alias_normalized = candidate.normalized_text
    ) then
      insert into public.tag_aliases (tenant_id, entity_type, model_id, alias_label, alias_normalized)
      values (candidate.tenant_id, 'model', target_id, candidate.raw_text, candidate.normalized_text);
    end if;
  end if;

  update public.tag_candidates set status = 'accepted' where id = candidate.id;
  return jsonb_build_object('entityType', candidate.entity_type, 'targetId', target_id);
end;
$$;

revoke all on function public.accept_tag_candidate(uuid, text) from public;
grant execute on function public.accept_tag_candidate(uuid, text) to authenticated;

commit;
