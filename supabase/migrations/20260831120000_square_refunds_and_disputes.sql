-- Durable, idempotent Square refund and standard dispute notifications.

create table if not exists public.square_refunds (
  square_refund_id text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  square_payment_id text not null,
  status text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null,
  reason text,
  square_created_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

create index if not exists square_refunds_order_id_idx
  on public.square_refunds(order_id);
create index if not exists square_refunds_payment_id_idx
  on public.square_refunds(square_payment_id);

create table if not exists public.square_disputes (
  square_dispute_id text primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  square_payment_id text not null,
  state text not null,
  reason text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null,
  due_at timestamp with time zone,
  square_created_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

create index if not exists square_disputes_order_id_idx
  on public.square_disputes(order_id);
create index if not exists square_disputes_payment_id_idx
  on public.square_disputes(square_payment_id);

alter table public.square_refunds enable row level security;
alter table public.square_disputes enable row level security;

create policy "admins_read_tenant_square_refunds"
  on public.square_refunds for select to authenticated
  using (public.is_admin_for_tenant(tenant_id));

create policy "admins_read_tenant_square_disputes"
  on public.square_disputes for select to authenticated
  using (public.is_admin_for_tenant(tenant_id));

grant select on public.square_refunds, public.square_disputes to authenticated;
grant all on public.square_refunds, public.square_disputes to service_role;

create or replace function public.process_square_refund_event(
  p_square_event_id text,
  p_event_type text,
  p_merchant_id text,
  p_location_id text,
  p_square_created_at timestamp with time zone,
  p_payload_sha256 text,
  p_event_data jsonb,
  p_square_payment_id text,
  p_square_refund_id text,
  p_refund_status text,
  p_amount_cents bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted integer;
  v_order public.orders%rowtype;
  v_completed_refund_cents bigint;
  v_order_total_cents bigint;
  v_order_status text;
begin
  insert into public.square_webhook_events (
    square_event_id, event_type, merchant_id, location_id, square_created_at,
    payload_sha256, event_data
  ) values (
    p_square_event_id, p_event_type, p_merchant_id, p_location_id,
    p_square_created_at, p_payload_sha256, coalesce(p_event_data, '{}'::jsonb)
  ) on conflict (square_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select orders.* into v_order
    from public.orders as orders
    join public.square_refunds as refunds on refunds.order_id = orders.id
    where refunds.square_refund_id = p_square_refund_id;
    return jsonb_build_object(
      'duplicate', true,
      'fulfillment_authorized', false,
      'order_id', v_order.id
    );
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.payment_transaction_id = p_square_payment_id
  for update;

  if not found then
    raise exception 'square_refund_order_not_found';
  end if;
  if p_currency <> coalesce(v_order.currency, 'USD') then
    raise exception 'square_refund_currency_mismatch';
  end if;

  insert into public.square_refunds (
    square_refund_id, order_id, tenant_id, square_payment_id, status,
    amount_cents, currency, reason, square_created_at, updated_at
  ) values (
    p_square_refund_id, v_order.id, v_order.tenant_id, p_square_payment_id,
    upper(p_refund_status), p_amount_cents, p_currency,
    nullif(p_event_data->>'reason', ''), p_square_created_at, now()
  ) on conflict (square_refund_id) do update set
    status = excluded.status,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    reason = excluded.reason,
    square_created_at = excluded.square_created_at,
    updated_at = now();

  select coalesce(sum(amount_cents), 0) into v_completed_refund_cents
  from public.square_refunds
  where order_id = v_order.id and status = 'COMPLETED';

  v_order_total_cents := round(v_order.total * 100)::bigint;
  v_order_status := case
    when upper(p_refund_status) = 'COMPLETED'
      and v_completed_refund_cents >= v_order_total_cents then 'refunded'
    when upper(p_refund_status) = 'COMPLETED' then 'partially_refunded'
    when upper(p_refund_status) = 'PENDING' then 'refund_pending'
    when upper(p_refund_status) in ('FAILED', 'REJECTED') then 'refund_failed'
    else v_order.status
  end;

  update public.orders
  set
    status = case
      when status in ('refunded', 'partially_refunded')
        and v_order_status in ('refund_pending', 'refund_failed') then status
      else v_order_status
    end,
    refund_amount = v_completed_refund_cents,
    refunded_at = case
      when v_completed_refund_cents > 0 then coalesce(refunded_at, now())
      else refunded_at
    end,
    updated_at = now()
  where id = v_order.id;

  insert into public.order_events(order_id, type, message)
  values (
    v_order.id,
    case
      when v_order_status = 'refunded' then 'payment_refunded'
      when v_order_status = 'partially_refunded' then 'payment_refund_partial'
      when v_order_status = 'refund_pending' then 'payment_refund_pending'
      else 'payment_refund_failed'
    end,
    'Square refund status: ' || upper(p_refund_status)
  );

  update public.square_webhook_events
  set processed_at = now()
  where square_event_id = p_square_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'fulfillment_authorized', false,
    'order_id', v_order.id
  );
end;
$function$;

create or replace function public.process_square_dispute_event(
  p_square_event_id text,
  p_event_type text,
  p_merchant_id text,
  p_location_id text,
  p_square_created_at timestamp with time zone,
  p_payload_sha256 text,
  p_event_data jsonb,
  p_square_dispute_id text,
  p_square_payment_id text,
  p_dispute_state text,
  p_dispute_reason text,
  p_due_at timestamp with time zone,
  p_amount_cents bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inserted integer;
  v_order public.orders%rowtype;
begin
  insert into public.square_webhook_events (
    square_event_id, event_type, merchant_id, location_id, square_created_at,
    payload_sha256, event_data
  ) values (
    p_square_event_id, p_event_type, p_merchant_id, p_location_id,
    p_square_created_at, p_payload_sha256, coalesce(p_event_data, '{}'::jsonb)
  ) on conflict (square_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select orders.* into v_order
    from public.orders as orders
    join public.square_disputes as disputes on disputes.order_id = orders.id
    where disputes.square_dispute_id = p_square_dispute_id;
    return jsonb_build_object(
      'duplicate', true,
      'fulfillment_authorized', false,
      'order_id', v_order.id
    );
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.payment_transaction_id = p_square_payment_id
  for update;

  if not found then
    raise exception 'square_dispute_order_not_found';
  end if;
  if p_currency <> coalesce(v_order.currency, 'USD') then
    raise exception 'square_dispute_currency_mismatch';
  end if;

  insert into public.square_disputes (
    square_dispute_id, order_id, tenant_id, square_payment_id, state, reason,
    amount_cents, currency, due_at, square_created_at, updated_at
  ) values (
    p_square_dispute_id, v_order.id, v_order.tenant_id, p_square_payment_id,
    p_dispute_state, p_dispute_reason, p_amount_cents, p_currency, p_due_at,
    p_square_created_at, now()
  ) on conflict (square_dispute_id) do update set
    state = excluded.state,
    reason = excluded.reason,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    due_at = excluded.due_at,
    square_created_at = excluded.square_created_at,
    updated_at = now();

  insert into public.order_events(order_id, type, message)
  values (
    v_order.id,
    case when p_event_type = 'dispute.created'
      then 'payment_dispute_created'
      else 'payment_dispute_updated'
    end,
    'Square dispute state: ' || p_dispute_state
  );

  update public.square_webhook_events
  set processed_at = now()
  where square_event_id = p_square_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'fulfillment_authorized', false,
    'order_id', v_order.id
  );
end;
$function$;

revoke all on function public.process_square_refund_event(
  text, text, text, text, timestamp with time zone, text, jsonb,
  text, text, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.process_square_dispute_event(
  text, text, text, text, timestamp with time zone, text, jsonb,
  text, text, text, text, timestamp with time zone, bigint, text
) from public, anon, authenticated;
grant execute on function public.process_square_refund_event(
  text, text, text, text, timestamp with time zone, text, jsonb,
  text, text, text, bigint, text
) to service_role;
grant execute on function public.process_square_dispute_event(
  text, text, text, text, timestamp with time zone, text, jsonb,
  text, text, text, text, timestamp with time zone, bigint, text
) to service_role;

create table if not exists public.checkout_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  order_id uuid not null references public.orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('order_confirmation', 'refund_confirmation')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists checkout_notification_outbox_ready_idx
  on public.checkout_notification_outbox(status, next_attempt_at);

alter table public.checkout_notification_outbox enable row level security;
create policy "admins_read_tenant_checkout_notifications"
  on public.checkout_notification_outbox for select to authenticated
  using (public.is_admin_for_tenant(tenant_id));
grant select on public.checkout_notification_outbox to authenticated;
grant all on public.checkout_notification_outbox to service_role;

create or replace function public.queue_paid_order_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    insert into public.checkout_notification_outbox(
      event_key, order_id, tenant_id, kind
    ) values (
      'order_confirmation:' || new.id::text,
      new.id,
      new.tenant_id,
      'order_confirmation'
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists queue_paid_order_confirmation on public.orders;
create trigger queue_paid_order_confirmation
after update of status on public.orders
for each row execute function public.queue_paid_order_confirmation();

create or replace function public.queue_square_refund_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status <> 'COMPLETED' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from 'COMPLETED' then
    return new;
  end if;

  insert into public.checkout_notification_outbox(
    event_key, order_id, tenant_id, kind, payload
  ) values (
    'refund_confirmation:' || new.square_refund_id,
    new.order_id,
    new.tenant_id,
    'refund_confirmation',
    jsonb_build_object('refundAmountCents', new.amount_cents)
  ) on conflict (event_key) do nothing;
  return new;
end;
$function$;

drop trigger if exists queue_square_refund_confirmation on public.square_refunds;
create trigger queue_square_refund_confirmation
after insert or update of status on public.square_refunds
for each row execute function public.queue_square_refund_confirmation();

create or replace function public.claim_checkout_notifications(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  with candidates as (
    select id
    from public.checkout_notification_outbox
    where (
      status in ('pending', 'failed') and next_attempt_at <= now()
    ) or (
      status = 'processing' and updated_at <= now() - interval '10 minutes'
    )
    order by created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ), claimed as (
    update public.checkout_notification_outbox as notification
    set status = 'processing', attempts = attempts + 1, updated_at = now()
    from candidates
    where notification.id = candidates.id
    returning notification.id, notification.order_id, notification.kind,
      notification.payload
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', id,
      'orderId', order_id,
      'kind', kind,
      'payload', payload
    )),
    '[]'::jsonb
  ) into v_result
  from claimed;

  return v_result;
end;
$function$;

create or replace function public.finish_checkout_notification(
  p_notification_id uuid,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  update public.checkout_notification_outbox
  set
    status = case when p_succeeded then 'sent' else 'failed' end,
    next_attempt_at = case
      when p_succeeded then next_attempt_at
      else now() + make_interval(mins => least(greatest(attempts, 1) * 5, 60))
    end,
    updated_at = now()
  where id = p_notification_id and status = 'processing';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

revoke all on function public.claim_checkout_notifications(integer)
  from public, anon, authenticated;
revoke all on function public.finish_checkout_notification(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_checkout_notifications(integer) to service_role;
grant execute on function public.finish_checkout_notification(uuid, boolean)
  to service_role;
