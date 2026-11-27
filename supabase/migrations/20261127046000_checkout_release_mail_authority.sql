-- The owned mail protocol is the only worker allowed to claim or finish a row.
revoke execute on function public.claim_checkout_notifications(integer),
  public.claim_checkout_notifications_for_order(uuid, integer),
  public.claim_checkout_notifications_v2(integer, uuid, boolean),
  public.finish_checkout_notification(uuid, boolean)
  from public, anon, authenticated, service_role;

-- A refund may be observed before capture, so orders.status need never become
-- paid. Pair new canonical capture confirmations with their reseller alert.
-- Existing confirmations and admin resends are left alone.
create function public.queue_checkout_reseller_capture_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.checkout_notification_outbox(event_key, order_id, tenant_id, kind)
  values ('reseller_order_placed:' || new.order_id, new.order_id, new.tenant_id, 'reseller_order_placed')
  on conflict (event_key) do nothing;
  return new;
end;
$$;
revoke all on function public.queue_checkout_reseller_capture_alert() from public, anon, authenticated, service_role;
create trigger checkout_capture_reseller_alert after insert on public.checkout_notification_outbox
for each row when (new.kind='order_confirmation' and new.event_key='order_confirmation:' || new.order_id)
execute function public.queue_checkout_reseller_capture_alert();
