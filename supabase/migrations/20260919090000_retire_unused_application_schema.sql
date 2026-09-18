-- Release B only: deploy the compatibility application to every target first.
-- Forward retirement. Restore from a verified backup to recover deleted data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
begin
  if exists (
    select 1 from public.orders
    where square_payment_link_id is not null
      and square_payment_link_deleted_at is null
  ) then
    raise exception 'retire_and_verify_legacy_square_links_before_schema_cleanup';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.reserve_square_checkout_inventory_with_address(p_tenant_id uuid, p_user_id uuid, p_guest_email text, p_currency text, p_fulfillment text, p_idempotency_key text, p_cart_hash text, p_expires_at timestamp with time zone, p_subtotal_cents integer, p_shipping_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_calculation_id text, p_customer_state text, p_shipping_address jsonb, p_items jsonb, p_protection_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing_order public.orders%rowtype;
  v_order_id uuid;
  v_requested_count integer;
  v_updated_count integer;
  v_computed_subtotal integer;
begin
  if p_currency <> 'USD' then
    raise exception 'unsupported_checkout_currency';
  end if;

  if p_fulfillment not in ('ship', 'pickup') then
    raise exception 'invalid_checkout_fulfillment';
  end if;

  if p_customer_state !~ '^[A-Z]{2}$'
    or nullif(trim(p_tax_calculation_id), '') is null
  then
    raise exception 'invalid_checkout_tax_evidence';
  end if;

  if p_fulfillment = 'ship' and (
    p_shipping_address is null
    or jsonb_typeof(p_shipping_address) is distinct from 'object'
    or upper(coalesce(p_shipping_address ->> 'country', '')) <> 'US'
    or upper(coalesce(p_shipping_address ->> 'state', '')) <> p_customer_state
  ) then
    raise exception 'invalid_checkout_shipping_address';
  end if;

  if p_fulfillment = 'pickup' and p_shipping_address is not null then
    raise exception 'pickup_checkout_has_shipping_address';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 minutes' then
    raise exception 'invalid_checkout_expiration';
  end if;

  if p_subtotal_cents < 0
    or p_shipping_cents < 0
    or p_tax_cents < 0
    or p_total_cents <= 0
    or p_total_cents <> p_subtotal_cents + p_shipping_cents + p_tax_cents
  then
    raise exception 'invalid_checkout_totals';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_checkout_cart';
  end if;

  select orders.*
  into v_existing_order
  from public.orders
  where orders.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_order.tenant_id is distinct from p_tenant_id
      or v_existing_order.cart_hash is distinct from p_cart_hash
    then
      raise exception 'checkout_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'order_id', v_existing_order.id,
      'reused', true,
      'expires_at', v_existing_order.expires_at,
      'square_order_id', v_existing_order.square_order_id
    );
  end if;

  select
    count(*),
    coalesce(sum(item.line_total_cents), 0)
  into v_requested_count, v_computed_subtotal
  from jsonb_to_recordset(p_items) as item(
    product_id uuid,
    variant_id uuid,
    quantity integer,
    unit_price_cents integer,
    unit_cost_cents integer,
    line_total_cents integer,
    variant_sku text,
    product_name text,
    brand text,
    model text,
    category text,
    condition text,
    size_label text
  );

  if v_requested_count <> (
    select count(distinct item.variant_id)
    from jsonb_to_recordset(p_items) as item(variant_id uuid)
  ) then
    raise exception 'duplicate_checkout_variant';
  end if;

  if v_computed_subtotal <> p_subtotal_cents then
    raise exception 'checkout_subtotal_mismatch';
  end if;

  with requested as (
    select
      item.product_id,
      item.variant_id,
      item.quantity
    from jsonb_to_recordset(p_items) as item(
      product_id uuid,
      variant_id uuid,
      quantity integer
    )
    where item.quantity > 0
  ),
  updated as (
    update public.product_variants as product_variant
    set stock = product_variant.stock - requested.quantity
    from requested
    where product_variant.id = requested.variant_id
      and product_variant.product_id = requested.product_id
      and product_variant.tenant_id = p_tenant_id
      and product_variant.stock >= requested.quantity
      and exists (
        select 1
        from public.products as product
        where product.id = requested.product_id
          and product.tenant_id = p_tenant_id
          and product.is_active = true
          and product.is_out_of_stock = false
          and product.go_live_at <= now()
      )
    returning product_variant.id
  )
  select count(*) into v_updated_count from updated;

  if v_updated_count <> v_requested_count then
    raise exception 'checkout_inventory_unavailable';
  end if;

  insert into public.orders (
    user_id,
    guest_email,
    tenant_id,
    currency,
    subtotal,
    shipping,
    tax_amount,
    tax_calculation_id,
    customer_state,
    total,
    status,
    fulfillment,
    idempotency_key,
    cart_hash,
    expires_at,
    checkout_protection_evidence
  ) values (
    p_user_id,
    nullif(trim(p_guest_email), ''),
    p_tenant_id,
    p_currency,
    p_subtotal_cents::numeric / 100,
    p_shipping_cents::numeric / 100,
    p_tax_cents::numeric / 100,
    p_tax_calculation_id,
    p_customer_state,
    p_total_cents::numeric / 100,
    'pending',
    p_fulfillment,
    p_idempotency_key,
    p_cart_hash,
    p_expires_at,
    coalesce(p_protection_evidence, '{}'::jsonb)
  )
  returning id into v_order_id;

  if p_fulfillment = 'ship' then
    insert into public.order_shipping (
      order_id,
      name,
      phone,
      line1,
      line2,
      city,
      state,
      postal_code,
      country
    ) values (
      v_order_id,
      nullif(trim(p_shipping_address ->> 'name'), ''),
      nullif(trim(p_shipping_address ->> 'phone'), ''),
      nullif(trim(p_shipping_address ->> 'line1'), ''),
      nullif(trim(p_shipping_address ->> 'line2'), ''),
      nullif(trim(p_shipping_address ->> 'city'), ''),
      upper(nullif(trim(p_shipping_address ->> 'state'), '')),
      nullif(trim(p_shipping_address ->> 'postal_code'), ''),
      'US'
    );
  end if;

  insert into public.order_items (
    order_id,
    product_id,
    variant_id,
    variant_sku,
    product_name,
    brand,
    model,
    category,
    condition,
    size_label,
    quantity,
    unit_price,
    unit_cost,
    line_total
  )
  select
    v_order_id,
    item.product_id,
    item.variant_id,
    item.variant_sku,
    item.product_name,
    item.brand,
    item.model,
    item.category,
    item.condition,
    item.size_label,
    item.quantity,
    item.unit_price_cents::numeric / 100,
    item.unit_cost_cents::numeric / 100,
    item.line_total_cents::numeric / 100
  from jsonb_to_recordset(p_items) as item(
    product_id uuid,
    variant_id uuid,
    quantity integer,
    unit_price_cents integer,
    unit_cost_cents integer,
    line_total_cents integer,
    variant_sku text,
    product_name text,
    brand text,
    model text,
    category text,
    condition text,
    size_label text
  );

  insert into public.inventory_reservations (
    tenant_id,
    order_id,
    variant_id,
    quantity,
    expires_at
  )
  select
    p_tenant_id,
    v_order_id,
    item.variant_id,
    item.quantity,
    p_expires_at
  from jsonb_to_recordset(p_items) as item(
    variant_id uuid,
    quantity integer
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'reused', false,
    'expires_at', p_expires_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_square_checkout_reservation(p_order_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_active_count integer;
begin
  select orders.*
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    return false;
  end if;


  if v_order.status in ('paid', 'shipped', 'refunded', 'partially_refunded') then
    return false;
  end if;

  with active_reservations as (
    select reservation.variant_id, sum(reservation.quantity)::integer as quantity
    from public.inventory_reservations as reservation
    where reservation.order_id = p_order_id
      and reservation.status = 'active'
    group by reservation.variant_id
  ),
  restored as (
    update public.product_variants as product_variant
    set stock = product_variant.stock + active_reservations.quantity
    from active_reservations
    where product_variant.id = active_reservations.variant_id
    returning product_variant.id
  )
  select count(*) into v_active_count from restored;

  update public.inventory_reservations
  set
    status = 'released',
    released_at = now(),
    updated_at = now()
  where order_id = p_order_id
    and status = 'active';

  update public.orders
  set
    status = 'canceled',
    failure_reason = left(coalesce(nullif(trim(p_reason), ''), 'reservation_released'), 500),
    updated_at = now()
  where id = p_order_id;

  return v_active_count > 0;
end;
$function$
;

drop function public.decrement_variant_stock(uuid, integer);
drop function public.increment_variant_stock(uuid, integer);
drop function public.mark_order_paid_and_decrement(uuid, text, jsonb);
drop function public.attach_square_payment_link(uuid, text, text, text, integer, integer, integer, text);
drop function public.mark_square_payment_link_deleted(uuid, text);

alter table public.orders drop constraint orders_seller_id_fkey;

drop table public.admin_audit_log;
drop table public.chargeback_evidence;
drop table public.nexus_registrations;
drop table public.sellers;
drop table public.tax_rate_cache;
drop table public.tenant_checkout_settings;
drop table public.tenant_tax_settings;
drop table public.transaction_audit_log;
drop table public.checkout_api_logs;
drop table public.user_billing_addresses;
drop table public.payment_events;
drop table public.shipping_tracking_events;

alter table public.orders
  drop column fee,
  drop column tax_transaction_id,
  drop column seller_id,
  drop column public_token,
  drop column square_payment_link_id,
  drop column square_payment_link_url,
  drop column square_payment_link_deleted_at;
alter table public.payment_transactions
  drop column card_bin,
  drop column three_ds_eci,
  drop column amount_refunded;
alter table public.user_addresses drop column is_default;
alter table public.square_webhook_events drop column processing_error;

drop trigger update_products_updated_at on public.products;
drop trigger update_shipping_profiles_updated_at on public.shipping_profiles;
drop function public.update_updated_at_column();
drop function public.update_chargeback_evidence_updated_at();

drop index public.order_billing_order_id_idx;
drop index public.idx_order_shipping_order_id;
drop index public.idx_product_variants_tenant_sku;

notify pgrst, 'reload schema';
commit;
