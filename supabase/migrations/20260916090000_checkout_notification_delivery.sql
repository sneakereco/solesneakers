-- Queue confirmation and pickup instructions separately, and allow prompt
-- order-scoped delivery without competing with the fallback cron worker.

alter table public.checkout_notification_outbox
  drop constraint checkout_notification_outbox_kind_check;
alter table public.checkout_notification_outbox
  add constraint checkout_notification_outbox_kind_check check (
    kind in (
      'order_confirmation',
      'pickup_instructions',
      'refund_confirmation',
      'shipping_update',
      'delivery_confirmation'
    )
  );

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

    if new.fulfillment = 'pickup' then
      insert into public.checkout_notification_outbox(
        event_key, order_id, tenant_id, kind
      ) values (
        'pickup_instructions:' || new.id::text,
        new.id,
        new.tenant_id,
        'pickup_instructions'
      ) on conflict (event_key) do nothing;
    end if;
  end if;
  return new;
end;
$function$;

create function public.claim_checkout_notifications_for_order(
  p_order_id uuid,
  p_limit integer
)
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
    where order_id = p_order_id
      and (
        (status in ('pending', 'failed') and next_attempt_at <= now())
        or (status = 'processing' and updated_at <= now() - interval '10 minutes')
      )
    order by created_at, id
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

revoke all on function public.claim_checkout_notifications_for_order(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_checkout_notifications_for_order(uuid, integer)
  to service_role;
