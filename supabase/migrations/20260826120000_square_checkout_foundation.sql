begin;

alter table public.orders
  add column if not exists square_payment_link_id text,
  add column if not exists square_order_id text,
  add column if not exists square_payment_link_url text,
  add column if not exists square_payment_link_deleted_at timestamp with time zone,
  add column if not exists checkout_protection_evidence jsonb not null default '{}'::jsonb;

create unique index if not exists orders_square_payment_link_id_key
  on public.orders (square_payment_link_id)
  where square_payment_link_id is not null;

create unique index if not exists orders_square_order_id_key
  on public.orders (square_order_id)
  where square_order_id is not null;

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'active'
    check (status = any (array['active'::text, 'consumed'::text, 'released'::text])),
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  released_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (order_id, variant_id)
);

create index inventory_reservations_active_expiry_idx
  on public.inventory_reservations (expires_at)
  where status = 'active';

alter table public.inventory_reservations enable row level security;

create table public.square_webhook_events (
  square_event_id text primary key,
  event_type text not null,
  merchant_id text,
  location_id text,
  square_created_at timestamp with time zone,
  payload_sha256 text not null,
  event_data jsonb not null default '{}'::jsonb,
  received_at timestamp with time zone not null default now(),
  processed_at timestamp with time zone,
  processing_error text
);

create index square_webhook_events_received_at_idx
  on public.square_webhook_events (received_at);

alter table public.square_webhook_events enable row level security;

drop function if exists public.reserve_square_checkout_inventory(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  integer,
  integer,
  integer,
  integer,
  jsonb,
  jsonb
);

create function public.reserve_square_checkout_inventory(
  p_tenant_id uuid,
  p_user_id uuid,
  p_guest_email text,
  p_currency text,
  p_fulfillment text,
  p_idempotency_key text,
  p_cart_hash text,
  p_expires_at timestamp with time zone,
  p_subtotal_cents integer,
  p_shipping_cents integer,
  p_tax_cents integer,
  p_total_cents integer,
  p_items jsonb,
  p_protection_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
      'square_payment_link_id', v_existing_order.square_payment_link_id,
      'square_order_id', v_existing_order.square_order_id,
      'square_payment_link_url', v_existing_order.square_payment_link_url
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
    p_total_cents::numeric / 100,
    'pending',
    p_fulfillment,
    p_idempotency_key,
    p_cart_hash,
    p_expires_at,
    coalesce(p_protection_evidence, '{}'::jsonb)
  )
  returning id into v_order_id;

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
$function$;

drop function if exists public.attach_square_payment_link(uuid, text, text, text);

create function public.attach_square_payment_link(
  p_order_id uuid,
  p_square_payment_link_id text,
  p_square_order_id text,
  p_square_payment_link_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  update public.orders
  set
    square_payment_link_id = p_square_payment_link_id,
    square_order_id = p_square_order_id,
    square_payment_link_url = p_square_payment_link_url,
    square_payment_link_deleted_at = null,
    updated_at = now()
  where id = p_order_id
    and status = 'pending'
    and expires_at > now()
    and (
      square_payment_link_id is null
      or square_payment_link_id = p_square_payment_link_id
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

drop function if exists public.mark_square_payment_link_deleted(uuid, text);

create function public.mark_square_payment_link_deleted(
  p_order_id uuid,
  p_square_payment_link_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  update public.orders
  set
    square_payment_link_deleted_at = coalesce(square_payment_link_deleted_at, now()),
    updated_at = now()
  where id = p_order_id
    and square_payment_link_id = p_square_payment_link_id;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

drop function if exists public.release_square_checkout_reservation(uuid, text);

create function public.release_square_checkout_reservation(
  p_order_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
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

  if v_order.square_payment_link_id is not null
    and v_order.square_payment_link_deleted_at is null
  then
    raise exception 'square_link_must_be_deleted_before_inventory_release';
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
$function$;

drop function if exists public.consume_square_checkout_reservation(uuid, text);

create function public.consume_square_checkout_reservation(
  p_order_id uuid,
  p_square_payment_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_active_count integer;
  v_released_count integer;
begin
  select orders.*
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if v_order.status = 'paid'
    and v_order.payment_transaction_id = p_square_payment_id
  then
    return true;
  end if;

  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'released')
  into v_active_count, v_released_count
  from public.inventory_reservations
  where order_id = p_order_id;

  if v_active_count = 0
    or v_released_count > 0
    or v_order.expires_at is null
    or v_order.expires_at <= now()
  then
    update public.orders
    set status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'late_or_released_square_payment',
      updated_at = now()
    where id = p_order_id;
    return false;
  end if;

  update public.inventory_reservations
  set
    status = 'consumed',
    consumed_at = now(),
    updated_at = now()
  where order_id = p_order_id
    and status = 'active';

  update public.orders
  set
    status = 'paid',
    payment_transaction_id = p_square_payment_id,
    failure_reason = null,
    updated_at = now()
  where id = p_order_id;

  return true;
end;
$function$;

drop function if exists public.process_square_payment_event(
  text,
  text,
  text,
  text,
  timestamp with time zone,
  text,
  jsonb,
  text,
  text,
  text,
  bigint,
  text,
  text
);

create function public.process_square_payment_event(
  p_square_event_id text,
  p_event_type text,
  p_merchant_id text,
  p_location_id text,
  p_square_created_at timestamp with time zone,
  p_payload_sha256 text,
  p_event_data jsonb,
  p_square_order_id text,
  p_square_payment_id text,
  p_payment_status text,
  p_amount_cents bigint,
  p_currency text,
  p_risk_level text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted integer;
  v_order public.orders%rowtype;
  v_fulfillment_authorized boolean := false;
begin
  insert into public.square_webhook_events (
    square_event_id,
    event_type,
    merchant_id,
    location_id,
    square_created_at,
    payload_sha256,
    event_data
  ) values (
    p_square_event_id,
    p_event_type,
    p_merchant_id,
    p_location_id,
    p_square_created_at,
    p_payload_sha256,
    coalesce(p_event_data, '{}'::jsonb)
  )
  on conflict (square_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('duplicate', true, 'fulfillment_authorized', false);
  end if;

  if p_payment_status <> 'COMPLETED' then
    update public.square_webhook_events
    set processed_at = now()
    where square_event_id = p_square_event_id;

    return jsonb_build_object('duplicate', false, 'fulfillment_authorized', false);
  end if;

  select orders.*
  into v_order
  from public.orders
  where orders.square_order_id = p_square_order_id
  for update;

  if not found then
    raise exception 'square_order_not_found';
  end if;

  if round(v_order.total * 100)::bigint <> p_amount_cents
    or coalesce(v_order.currency, 'USD') <> p_currency
  then
    update public.orders
    set
      status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'square_payment_amount_mismatch',
      updated_at = now()
    where id = v_order.id;
  elsif upper(coalesce(p_risk_level, '')) = 'HIGH' then
    update public.orders
    set
      status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'square_payment_high_risk',
      updated_at = now()
    where id = v_order.id;
  else
    v_fulfillment_authorized := public.consume_square_checkout_reservation(
      v_order.id,
      p_square_payment_id
    );
  end if;

  update public.square_webhook_events
  set processed_at = now()
  where square_event_id = p_square_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'fulfillment_authorized', v_fulfillment_authorized,
    'order_id', v_order.id
  );
end;
$function$;

revoke all on public.inventory_reservations from anon, authenticated;
revoke all on public.square_webhook_events from anon, authenticated;
grant all on public.inventory_reservations to service_role;
grant all on public.square_webhook_events to service_role;

revoke execute on function public.reserve_square_checkout_inventory(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  integer,
  integer,
  integer,
  integer,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke execute on function public.attach_square_payment_link(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.mark_square_payment_link_deleted(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.release_square_checkout_reservation(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.consume_square_checkout_reservation(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.process_square_payment_event(
  text,
  text,
  text,
  text,
  timestamp with time zone,
  text,
  jsonb,
  text,
  text,
  text,
  bigint,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.reserve_square_checkout_inventory(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  integer,
  integer,
  integer,
  integer,
  jsonb,
  jsonb
) to service_role;
grant execute on function public.attach_square_payment_link(uuid, text, text, text)
  to service_role;
grant execute on function public.mark_square_payment_link_deleted(uuid, text)
  to service_role;
grant execute on function public.release_square_checkout_reservation(uuid, text)
  to service_role;
grant execute on function public.consume_square_checkout_reservation(uuid, text)
  to service_role;
grant execute on function public.process_square_payment_event(
  text,
  text,
  text,
  text,
  timestamp with time zone,
  text,
  jsonb,
  text,
  text,
  text,
  bigint,
  text,
  text
) to service_role;

commit;
