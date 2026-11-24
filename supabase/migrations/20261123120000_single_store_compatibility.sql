begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Compatibility release only. Keep every existing column, routine, policy and
-- row. The deployment baseline gate must run BEFORE any pending migration.
do $guard$
declare
  v_tables constant text[] := array[
    'checkout_notification_outbox', 'email_audit_log', 'featured_items',
    'inventory_reservations', 'orders', 'payment_transactions',
    'product_variants', 'products', 'profiles', 'shipping_defaults',
    'shipping_profiles', 'square_disputes', 'square_refunds',
    'state_sales_tracking', 'tag_aliases', 'tag_brands', 'tag_candidates',
    'tag_models', 'tag_sizes', 'tenant_store_access_settings'
  ];
  v_table text;
  v_count bigint;
  v_collision record;
begin
  -- Serialize ownership/configuration checks with writes until this additive
  -- transaction commits. Do not repair an unexpected schema or select an owner.
  lock table public.tenants in share row exclusive mode;
  foreach v_table in array v_tables loop
    execute format('lock table public.%I in share row exclusive mode', v_table);
  end loop;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id'
      and not (table_name = any(v_tables))
  ) then
    raise exception 'single_store_unexpected_tenant_table';
  end if;
  select count(*) into v_count from public.tenants;
  if v_count > 1 then
    raise exception 'single_store_owner_cardinality';
  end if;
  -- Zero owners is valid only with zero owned rows (fresh schema replay).
  -- Existing NULL/global taxonomy and settings records are never rewritten.
  foreach v_table in array v_tables loop
    execute format(
      'select count(*) from public.%I r where r.tenant_id is not null and not exists (select 1 from public.tenants t where t.id = r.tenant_id)',
      v_table
    ) into v_count;
    if v_count > 0 then
      raise exception 'single_store_unregistered_owner';
    end if;
  end loop;
  if (select count(*) from public.tenant_store_access_settings) > 1 then
    raise exception 'single_store_settings_cardinality_or_conflict';
  end if;
  -- These keys deliberately match the existing indexes with only tenancy
  -- removed. No trimming or extra case folding of stored identifiers.
  for v_collision in select * from (values
    ('variant_sku', 'select sku from public.product_variants where sku is not null group by sku having count(*) > 1'),
    ('variant_product_size', 'select product_id, size_id from public.product_variants where product_id is not null and size_id is not null group by product_id, size_id having count(*) > 1'),
    ('featured_product', 'select product_id from public.featured_items where product_id is not null group by product_id having count(*) > 1'),
    ('shipping_category', 'select category from public.shipping_defaults where category is not null group by category having count(*) > 1'),
    ('brand_name', 'select lower(canonical_label) from public.tag_brands where canonical_label is not null group by lower(canonical_label) having count(*) > 1'),
    ('model_within_brand', 'select lower(b.canonical_label), lower(m.canonical_label) from public.tag_models m join public.tag_brands b on b.id = m.brand_id group by lower(b.canonical_label), lower(m.canonical_label) having count(*) > 1'),
    ('alias_value', 'select entity_type, alias_normalized from public.tag_aliases where entity_type is not null and alias_normalized is not null group by entity_type, alias_normalized having count(*) > 1'),
    ('size_name', 'select size_type, lower(canonical_label) from public.tag_sizes where size_type is not null and canonical_label is not null group by size_type, lower(canonical_label) having count(*) > 1'),
    ('sales_period', 'select state_code, year, month from public.state_sales_tracking where state_code is not null and year is not null and month is not null group by state_code, year, month having count(*) > 1')
  ) as checks(name, sql) loop
    execute 'select count(*) from (' || v_collision.sql || ') collisions' into v_count;
    if v_count > 0 then
      raise exception 'single_store_canonical_collision: %', v_collision.name;
    end if;
  end loop;
end;
$guard$;

-- Bounded private adapter. No arbitrary/fabricated fallback, including on a
-- fresh replay. Only SECURITY DEFINER compatibility entries call this helper.
create function public._single_store_compat_owner()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owners uuid[];
begin
  select array_agg(id) into v_owners from public.tenants;
  if coalesce(cardinality(v_owners), 0) <> 1 then
    raise exception 'single_store_existing_owner_required';
  end if;
  return v_owners[1];
end;
$function$;

revoke all on function public._single_store_compat_owner()
  from public, anon, authenticated, service_role;

-- The existing 20-argument entry retains all validation, billing/pickup
-- snapshots, transactional allocation and idempotency. Do not copy its body.
create function public.reserve_square_checkout_inventory(
  p_user_id uuid,
  p_guest_email text,
  p_currency text,
  p_fulfillment text,
  p_payment_method text,
  p_idempotency_key text,
  p_cart_hash text,
  p_expires_at timestamptz,
  p_subtotal_cents integer,
  p_shipping_cents integer,
  p_tax_cents integer,
  p_total_cents integer,
  p_tax_calculation_id text,
  p_customer_state text,
  p_shipping_address jsonb,
  p_billing_address jsonb,
  p_items jsonb,
  p_protection_evidence jsonb,
  p_pickup_contact jsonb default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select public.reserve_square_checkout_inventory(
    public._single_store_compat_owner(), p_user_id, p_guest_email, p_currency,
    p_fulfillment, p_payment_method, p_idempotency_key, p_cart_hash, p_expires_at,
    p_subtotal_cents, p_shipping_cents, p_tax_cents, p_total_cents,
    p_tax_calculation_id, p_customer_state, p_shipping_address, p_billing_address,
    p_items, p_protection_evidence, p_pickup_contact
  );
$function$;

revoke all on function public.reserve_square_checkout_inventory(uuid, text, text, text, text, text, text, timestamptz, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_square_checkout_inventory(uuid, text, text, text, text, text, text, timestamptz, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- No definer view and no anonymous settings exposure. The server retains its
-- existing staff/MFA checks. Missing settings read the application's explicit
-- defaults without materializing a row or changing a configured Store.
create function public.get_store_access_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid := public._single_store_compat_owner();
  v_settings public.tenant_store_access_settings%rowtype;
begin
  select * into v_settings from public.tenant_store_access_settings where tenant_id = v_owner;
  return jsonb_build_object(
    'site_lock_enabled', coalesce(v_settings.site_lock_enabled, false),
    'site_unlock_at', v_settings.site_unlock_at,
    'checkout_lock_enabled', coalesce(v_settings.checkout_lock_enabled, false),
    'checkout_lock_message', coalesce(v_settings.checkout_lock_message,
      'Sorry, we currently cannot accept payments. Please message @soles.neakers on Instagram with the items you would like to purchase.')
  );
end;
$function$;

create function public.upsert_store_access_settings(
  p_site_lock_enabled boolean,
  p_site_unlock_at timestamptz,
  p_checkout_lock_enabled boolean,
  p_checkout_lock_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.tenant_store_access_settings (
    tenant_id, site_lock_enabled, site_unlock_at, checkout_lock_enabled,
    checkout_lock_message
  ) values (
    public._single_store_compat_owner(), p_site_lock_enabled, p_site_unlock_at,
    p_checkout_lock_enabled, p_checkout_lock_message
  )
  on conflict (tenant_id) do update set
    site_lock_enabled = excluded.site_lock_enabled,
    site_unlock_at = excluded.site_unlock_at,
    checkout_lock_enabled = excluded.checkout_lock_enabled,
    checkout_lock_message = excluded.checkout_lock_message,
    updated_at = now();
  return public.get_store_access_settings();
end;
$function$;

revoke all on function public.get_store_access_settings()
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_store_access_settings(boolean, timestamptz, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_store_access_settings() to service_role;
grant execute on function public.upsert_store_access_settings(boolean, timestamptz, boolean, text) to service_role;

-- accept_tag_candidate(uuid,text) is already tenant-free. Its internal staff
-- check and existing ACL remain unchanged. Direct-insert bridges are deferred
-- to the application cutover, where each concrete writer can be tested.
commit;
