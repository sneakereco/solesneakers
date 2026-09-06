begin;

create function public.consume_square_checkout_reservation(
  p_order_id uuid,
  p_square_payment_id text,
  p_paid_at timestamp with time zone
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
    or v_order.expires_at <= coalesce(p_paid_at, now())
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

create or replace function public.process_square_payment_event(
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
  v_base_cents bigint;
  v_tax_cents bigint;
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

  v_base_cents := round(v_order.subtotal * 100)::bigint
    + round(v_order.shipping * 100)::bigint;
  v_tax_cents := p_amount_cents - v_base_cents;

  if coalesce(v_order.currency, 'USD') <> p_currency
    or v_tax_cents < 0
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
    update public.orders
    set
      tax_amount = v_tax_cents::numeric / 100,
      total = p_amount_cents::numeric / 100,
      tax_calculation_id = 'square:payment:' || p_square_payment_id,
      checkout_protection_evidence = coalesce(checkout_protection_evidence, '{}'::jsonb)
        || jsonb_build_object(
          'square_final_tax_cents', v_tax_cents,
          'square_final_total_cents', p_amount_cents,
          'square_payment_id', p_square_payment_id
        ),
      updated_at = now()
    where id = v_order.id;

    v_fulfillment_authorized := public.consume_square_checkout_reservation(
      v_order.id,
      p_square_payment_id,
      p_square_created_at
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

revoke all on function public.consume_square_checkout_reservation(
  uuid,
  text,
  timestamp with time zone
) from public, anon, authenticated;
grant execute on function public.consume_square_checkout_reservation(
  uuid,
  text,
  timestamp with time zone
) to service_role;

commit;
