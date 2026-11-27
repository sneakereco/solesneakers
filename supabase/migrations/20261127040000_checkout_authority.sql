begin;

-- Customer and staff reads continue to use their existing RLS policies.
revoke insert, update, delete, truncate, references, trigger on table
  public.orders, public.order_items, public.order_shipping, public.order_billing,
  public.order_events, public.order_access_tokens, public.payment_transactions,
  public.inventory_reservations, public.square_refunds, public.square_disputes,
  public.square_webhook_events, public.checkout_notification_outbox, public.state_sales_tracking
from public, anon, authenticated;

-- The SELECT-only owner policy "Users can view own orders" already exists.
drop policy customer_rw_own_orders on public.orders;

-- The authenticated principal can bootstrap an ordinary profile.
alter policy profiles_insert_own on public.profiles
  with check (id = (select auth.uid()) and role = 'customer' and not is_primary_admin);
revoke truncate, trigger, references on table public.profiles from public, anon, authenticated;

create or replace function public.block_privileged_field_changes()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and
     (new.role is distinct from old.role or new.is_primary_admin is distinct from old.is_primary_admin)
     and not public.is_admin() then
    raise exception 'Cannot modify privileged profile fields' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Lock the order before checking event history. Retries serialize with each other
-- and the event, actor and order projection are committed as one transaction.
create function public.write_staff_order_fulfillment(
  p_order_id uuid, p_action text, p_actor_id uuid,
  p_carrier text default null, p_tracking_number text default null
) returns setof public.orders
language plpgsql security invoker set search_path = ''
as $$
declare
  target public.orders;
  event_type text;
  event_message text;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id
                 and role in ('admin', 'super_admin', 'dev')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into target from public.orders where id = p_order_id for update;
  if not found then return; end if;

  if p_action = 'pickup' then
    if target.fulfillment is distinct from 'pickup' then
      raise exception 'Order is not a pickup' using errcode = '22023';
    end if;
    if coalesce(target.status, '') not in ('paid', 'shipped', 'partially_refunded')
       or coalesce(target.fulfillment_status, '') not in ('unfulfilled', 'picked_up') then
      raise exception 'Order is not ready for pickup' using errcode = '22023';
    end if;
    event_type := 'picked_up';
    event_message := 'Order picked up.';
    if target.fulfillment_status is distinct from event_type then
      update public.orders set fulfillment_status = event_type
      where id = p_order_id returning * into target;
    end if;
  elsif p_action = 'fulfill' then
    if target.fulfillment is distinct from 'ship' then
      raise exception 'Order is not a shipment' using errcode = '22023';
    end if;
    if coalesce(target.status, '') not in ('paid', 'shipped')
       or coalesce(target.fulfillment_status, '') not in ('ready_to_ship', 'shipped') then
      raise exception 'Order is not ready to ship' using errcode = '22023';
    end if;
    event_type := 'shipped';
    event_message := 'Order marked as shipped.';
    if target.fulfillment_status = 'ready_to_ship' then
      update public.orders set fulfillment_status = event_type, shipping_carrier = p_carrier,
        tracking_number = p_tracking_number, shipped_at = coalesce(shipped_at, now())
      where id = p_order_id returning * into target;
    elsif target.shipping_carrier is distinct from p_carrier
       or target.tracking_number is distinct from p_tracking_number then
      raise exception 'The shipment already has different tracking details' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid fulfillment action' using errcode = '22023';
  end if;

  insert into public.order_events(order_id, type, message, created_by)
    select p_order_id, event_type, event_message, p_actor_id
    where not exists (select 1 from public.order_events where order_id = p_order_id and type = event_type);
  return next target;
end;
$$;

-- Include all overloads of these current server entry points.
do $$
declare
  operation regprocedure;
begin
  for operation in select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in (
      'attach_square_checkout_order', 'claim_checkout_notifications', 'claim_checkout_notifications_for_order',
      'consume_square_checkout_reservation', 'finish_checkout_notification', 'process_square_dispute_event',
      'process_square_payment_event', 'process_square_refund_event', 'record_shippo_tracking_update',
      'record_square_payment_details', 'release_square_checkout_reservation', 'reserve_square_checkout_inventory',
      'reserve_square_checkout_inventory_with_address', 'reserve_square_checkout_inventory_without_billing',
      'write_staff_order_fulfillment'
    )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', operation);
    execute format('grant execute on function %s to service_role', operation);
  end loop;
end;
$$;
commit;
