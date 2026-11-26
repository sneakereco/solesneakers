begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.products drop constraint products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('sneakers','clothing','accessories','electronics','specialty'));

create table public.specialty_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (length(trim(slug)) > 0),
  enabled boolean not null default false,
  normalization_version smallint not null default 1 check (normalization_version = 1),
  identity_key_fingerprint text check (identity_key_fingerprint ~ '^[a-f0-9]{64}$'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  check (not enabled or identity_key_fingerprint is not null)
);
insert into public.specialty_campaigns(slug) values ('black-friday-2026');

create table public.specialty_product_config (
  product_id uuid primary key references public.products(id) on delete cascade,
  campaign_id uuid not null references public.specialty_campaigns(id) on delete restrict,
  variant_id uuid not null unique references public.product_variants(id) on delete restrict,
  initial_quantity integer not null check (initial_quantity >= 0),
  winning_instructions text check (length(winning_instructions) <= 4000),
  revision bigint not null default 1 check (revision > 0),
  decision_ordinal bigint not null default 0 check (decision_ordinal >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  unique(campaign_id,product_id,variant_id)
);
create index specialty_product_campaign_idx on public.specialty_product_config(campaign_id,product_id);

create table public.specialty_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  product_id uuid not null,
  variant_id uuid not null,
  address_key text not null check (address_key ~ '^[a-f0-9]{64}$'),
  instagram_key text not null check (instagram_key ~ '^[a-f0-9]{64}$'),
  instagram_handle text not null check (instagram_handle ~ '^[a-z0-9._]{1,30}$'),
  eligibility_address jsonb not null check (jsonb_typeof(eligibility_address) = 'object'),
  product_name text not null,
  product_image_url text,
  instructions text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  decision_ordinal bigint not null check (decision_ordinal > 0),
  follow_up_status text not null default 'new' check (follow_up_status in ('new','contacted','fulfilled')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  foreign key(campaign_id,product_id,variant_id)
    references public.specialty_product_config(campaign_id,product_id,variant_id) on delete restrict,
  unique(campaign_id,address_key),
  unique(campaign_id,instagram_key),
  unique(product_id,decision_ordinal)
);
create index specialty_claim_admin_idx on public.specialty_claims(campaign_id,accepted_at desc,id);

create table public.specialty_claim_attempts (
  attempt_id uuid primary key,
  campaign_id uuid not null references public.specialty_campaigns(id) on delete restrict,
  product_id uuid not null,
  recovery_hash text not null check (recovery_hash ~ '^[a-f0-9]{64}$'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (result->>'status' in ('won','sold_out','already_claimed','closed')),
  claim_id uuid references public.specialty_claims(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check ((result->>'status' = 'won') = (claim_id is not null))
);

alter table public.specialty_campaigns enable row level security;
alter table public.specialty_product_config enable row level security;
alter table public.specialty_claims enable row level security;
alter table public.specialty_claim_attempts enable row level security;
revoke all on public.specialty_campaigns, public.specialty_product_config,
  public.specialty_claims, public.specialty_claim_attempts from public, anon, authenticated, service_role;
grant select on public.specialty_campaigns, public.specialty_product_config,
  public.specialty_claims, public.specialty_claim_attempts to service_role;

create function public.guard_specialty_campaign_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.identity_key_fingerprint is not null
    and new.identity_key_fingerprint is distinct from old.identity_key_fingerprint then
    raise exception 'specialty_identity_key_mismatch';
  end if;
  if new.normalization_version is distinct from old.normalization_version then
    raise exception 'specialty_normalization_immutable';
  end if;
  return new;
end;
$$;
create trigger specialty_campaign_identity_guard before update on public.specialty_campaigns
  for each row execute function public.guard_specialty_campaign_identity();

create function public.guard_specialty_product() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.category = 'specialty' and exists(select 1 from public.specialty_claims where product_id=old.id) then
      raise exception 'specialty_claimed_product_immutable';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.category is distinct from old.category
    and (new.category='specialty' or old.category='specialty') then
    raise exception 'specialty_category_immutable';
  end if;
  if new.category='specialty' then
    if tg_op='INSERT' and coalesce(current_setting('app.specialty_write_context',true),'') <> 'manage' then
      raise exception 'specialty_dedicated_creation_required';
    end if;
    if new.shipping_price_cents is distinct from 0 or new.size_type <> 'none' then
      raise exception 'specialty_invalid_product';
    end if;
  end if;
  return new;
end;
$$;
create trigger specialty_product_guard before insert or update or delete on public.products
  for each row execute function public.guard_specialty_product();

create function public.guard_specialty_variant() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_product_id uuid;
  v_category text;
  v_context text := coalesce(current_setting('app.specialty_write_context',true),'');
begin
  v_product_id := case when tg_op='DELETE' then old.product_id else new.product_id end;
  select category into v_category from public.products where id=v_product_id;
  -- A parent-product cascade is allowed only if no winner FK prevents it.
  if v_category is distinct from 'specialty' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if v_context not in ('manage','award') then raise exception 'specialty_stock_write_forbidden'; end if;
  if tg_op='DELETE' then
    if exists(select 1 from public.specialty_claims where product_id=v_product_id) then raise exception 'specialty_claimed_product_immutable'; end if;
    return old;
  end if;
  if new.sale_price_cents <> 0 then raise exception 'specialty_price_must_be_zero'; end if;
  if tg_op='INSERT' and exists(select 1 from public.product_variants where product_id=v_product_id) then
    raise exception 'specialty_single_variant_required';
  end if;
  if tg_op='UPDATE' and (new.product_id is distinct from old.product_id or new.size_id is distinct from old.size_id) then
    raise exception 'specialty_variant_immutable';
  end if;
  return new;
end;
$$;
create trigger specialty_variant_guard before insert or update or delete on public.product_variants
  for each row execute function public.guard_specialty_variant();

create function public.guard_specialty_reservation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.product_variants v join public.products p on p.id=v.product_id where v.id=new.variant_id and p.category='specialty') then
    raise exception 'specialty_checkout_forbidden';
  end if;
  return new;
end;
$$;
create trigger specialty_reservation_guard before insert or update on public.inventory_reservations
  for each row execute function public.guard_specialty_reservation();

create function public.guard_specialty_claim_facts() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if (to_jsonb(new)-array['follow_up_status','revision','updated_at','updated_by'])
      is distinct from (to_jsonb(old)-array['follow_up_status','revision','updated_at','updated_by']) then
      raise exception 'specialty_claim_facts_immutable';
    end if;
  end if;
  return new;
end;
$$;
create trigger specialty_claim_facts_guard before update on public.specialty_claims
  for each row execute function public.guard_specialty_claim_facts();

create function public.set_specialty_campaign_enabled(
  p_campaign_id uuid, p_enabled boolean, p_expected_revision bigint,
  p_actor_id uuid, p_identity_key_fingerprint text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_campaign public.specialty_campaigns%rowtype;
begin
  if p_actor_id is null then raise exception 'specialty_admin_required'; end if;
  select * into v_campaign from public.specialty_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'specialty_campaign_missing'; end if;
  if v_campaign.revision <> p_expected_revision then raise exception 'specialty_revision_conflict'; end if;
  if p_enabled then
    if p_identity_key_fingerprint is null or p_identity_key_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'specialty_identity_key_mismatch'; end if;
    if v_campaign.identity_key_fingerprint is not null and v_campaign.identity_key_fingerprint <> p_identity_key_fingerprint then raise exception 'specialty_identity_key_mismatch'; end if;
  end if;
  update public.specialty_campaigns set
    enabled=p_enabled,
    identity_key_fingerprint=coalesce(identity_key_fingerprint,case when p_enabled then p_identity_key_fingerprint end),
    revision=revision+1, updated_at=clock_timestamp(),updated_by=p_actor_id
  where id=p_campaign_id returning * into v_campaign;
  return jsonb_build_object('enabled',v_campaign.enabled,'revision',v_campaign.revision);
end;
$$;

create function public.save_specialty_product(
  p_product_id uuid, p_input jsonb, p_actor_id uuid, p_compatibility_tenant_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.specialty_campaigns%rowtype;
  v_config public.specialty_product_config%rowtype;
  v_product public.products%rowtype;
  v_brand uuid; v_size uuid; v_variant uuid; v_product_id uuid;
  v_quantity integer; v_image jsonb;
  v_context text := coalesce(current_setting('app.specialty_write_context',true),'');
begin
  if p_actor_id is null then raise exception 'specialty_admin_required'; end if;
  if p_compatibility_tenant_id is distinct from public._single_store_compat_owner() then raise exception 'specialty_invalid_owner'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or nullif(trim(p_input->>'name'),'') is null
    or length(p_input->>'name')>300 or length(p_input->>'instructions')>4000
    or jsonb_typeof(p_input->'images') is distinct from 'array' or jsonb_array_length(p_input->'images')>20 then
    raise exception 'specialty_invalid_product';
  end if;
  if p_input ? 'quantity' then
    v_quantity := (p_input->>'quantity')::integer;
    if v_quantity is null or v_quantity<0 then raise exception 'specialty_invalid_product'; end if;
  elsif p_product_id is null then raise exception 'specialty_invalid_product';
  end if;
  select * into v_campaign from public.specialty_campaigns
    where slug=coalesce(nullif(p_input->>'campaignSlug',''),'black-friday-2026') for share;
  if not found then raise exception 'specialty_campaign_missing'; end if;
  perform set_config('app.specialty_write_context','manage',true);
  if p_product_id is null then
    if p_input->>'mode' is distinct from 'create' then raise exception 'specialty_invalid_product'; end if;
    insert into public.tag_brands(canonical_label,tenant_id) values('Other',null) on conflict do nothing;
    select id into v_brand from public.tag_brands where lower(canonical_label)='other' and (tenant_id is null or tenant_id=p_compatibility_tenant_id) limit 1;
    insert into public.tag_sizes(canonical_label,size_type,tenant_id) values('One Size','none',null) on conflict do nothing;
    select id into v_size from public.tag_sizes where size_type='none' and lower(canonical_label)='one size' and (tenant_id is null or tenant_id=p_compatibility_tenant_id) limit 1;
    if v_brand is null or v_size is null then raise exception 'specialty_compatibility_tags_missing'; end if;
    insert into public.products(tenant_id,name,description,category,condition,size_type,brand_id,model_id,shipping_price_cents,go_live_at,is_active)
      values(p_compatibility_tenant_id,trim(p_input->>'name'),nullif(p_input->>'description',''),'specialty','new','none',v_brand,null,0,
        coalesce((p_input->>'goLiveAt')::timestamptz,clock_timestamp()),true)
      returning id into v_product_id;
    insert into public.product_variants(tenant_id,product_id,size_id,sku,sale_price_cents,unit_cost_cents,stock,sort_order)
      values(p_compatibility_tenant_id,v_product_id,v_size,'GIVEAWAY-'||replace(v_product_id::text,'-',''),0,0,v_quantity,0)
      returning id into v_variant;
    insert into public.specialty_product_config(product_id,campaign_id,variant_id,initial_quantity,winning_instructions,created_by,updated_by)
      values(v_product_id,v_campaign.id,v_variant,v_quantity,nullif(p_input->>'instructions',''),p_actor_id,p_actor_id) returning * into v_config;
  else
    if p_input->>'mode' is distinct from 'update' then raise exception 'specialty_invalid_product'; end if;
    select * into v_product from public.products where id=p_product_id for update;
    if not found or v_product.category<>'specialty' then raise exception 'specialty_product_missing'; end if;
    if v_product.archived_at is not null then raise exception 'specialty_product_archived'; end if;
    select * into v_config from public.specialty_product_config where product_id=p_product_id and campaign_id=v_campaign.id for update;
    if not found then raise exception 'specialty_product_missing'; end if;
    if v_config.revision <> (p_input->>'expectedRevision')::bigint or not (p_input ? 'expectedRevision') then raise exception 'specialty_revision_conflict'; end if;
    perform 1 from public.product_variants where id=v_config.variant_id for update;
    if p_input ? 'quantity' then
      if exists(select 1 from public.specialty_claims where product_id=p_product_id) then raise exception 'specialty_stock_locked_after_claim'; end if;
      update public.product_variants set stock=v_quantity where id=v_config.variant_id;
    end if;
    update public.products set name=trim(p_input->>'name'),description=nullif(p_input->>'description',''),go_live_at=coalesce((p_input->>'goLiveAt')::timestamptz,go_live_at),product_updated_at=clock_timestamp() where id=p_product_id;
    update public.specialty_product_config set winning_instructions=nullif(p_input->>'instructions',''),initial_quantity=coalesce(v_quantity,initial_quantity),
      revision=revision+1,updated_at=clock_timestamp(),updated_by=p_actor_id where product_id=p_product_id returning * into v_config;
    v_product_id := p_product_id;
    delete from public.product_images where product_id=v_product_id;
  end if;
  for v_image in select value from jsonb_array_elements(p_input->'images') loop
    if jsonb_typeof(v_image) is distinct from 'object' or coalesce(v_image->>'url','') !~ '^https?://' then raise exception 'specialty_invalid_image'; end if;
    insert into public.product_images(product_id,url,sort_order,is_primary)
      values(v_product_id,v_image->>'url',coalesce((v_image->>'sortOrder')::integer,0),coalesce((v_image->>'isPrimary')::boolean,false));
  end loop;
  perform set_config('app.specialty_write_context',v_context,true);
  return jsonb_build_object('productId',v_product_id,'revision',v_config.revision);
exception when others then
  perform set_config('app.specialty_write_context',v_context,true);
  raise;
end;
$$;

revoke all on function public.set_specialty_campaign_enabled(uuid,boolean,bigint,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.save_specialty_product(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_specialty_campaign_enabled(uuid,boolean,bigint,uuid,text) to service_role;
grant execute on function public.save_specialty_product(uuid,jsonb,uuid,uuid) to service_role;

commit;
