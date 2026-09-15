-- Reuse the existing notification worker for carrier updates.
alter table public.checkout_notification_outbox
  drop constraint checkout_notification_outbox_kind_check;
alter table public.checkout_notification_outbox
  add constraint checkout_notification_outbox_kind_check check (
    kind in ('order_confirmation', 'refund_confirmation', 'shipping_update', 'delivery_confirmation')
  );

alter table public.email_audit_log add column notification_id uuid
  references public.checkout_notification_outbox(id) on delete set null;
create index email_audit_log_notification_sent_idx
  on public.email_audit_log(notification_id) where delivery_status = 'sent';

-- Snapshots include private order details and guest access links.
drop policy "Tenant staff can view email audit log" on public.email_audit_log;
create policy "Tenant admins can view email audit log"
  on public.email_audit_log for select to authenticated
  using (public.is_admin_for_tenant(tenant_id));

create function public.record_shippo_tracking_update(
  p_tracking_number text, p_status text, p_carrier text, p_tracking_url text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_kind text;
  v_queued integer;
begin
  if p_status not in ('shipped', 'delivered') or p_status is null then
    raise exception 'unsupported_tracking_status';
  end if;
  -- Serialize callbacks for this order, including concurrent duplicate events.
  select * into v_order from public.orders
  where tracking_number = p_tracking_number and fulfillment = 'ship'
  limit 1 for update;
  if not found then
    return jsonb_build_object('matched', false);
  end if;
  if v_order.fulfillment_status = 'delivered' and p_status = 'shipped' then
    return jsonb_build_object('matched', true, 'queued', false, 'stale', true);
  end if;

  v_kind := case when p_status = 'delivered' then 'delivery_confirmation' else 'shipping_update' end;
  insert into public.checkout_notification_outbox(event_key, order_id, tenant_id, kind, payload)
  values (
    v_kind || ':' || v_order.id::text || ':' || p_tracking_number,
    v_order.id, v_order.tenant_id, v_kind,
    jsonb_build_object('trackingNumber', p_tracking_number,
      'carrier', coalesce(v_order.shipping_carrier, p_carrier), 'trackingUrl', p_tracking_url)
  ) on conflict (event_key) do nothing;
  get diagnostics v_queued = row_count;

  update public.orders set fulfillment_status = p_status
    where id = v_order.id and fulfillment_status is distinct from p_status;
  if not exists (select 1 from public.order_events where order_id = v_order.id and type = p_status) then
    insert into public.order_events(order_id, type, message)
    values (v_order.id, p_status, case when p_status = 'delivered'
      then 'Order delivered.' else 'Order is in transit with the carrier.' end);
  end if;
  return jsonb_build_object('matched', true, 'queued', v_queued = 1, 'orderId', v_order.id);
end;
$function$;

revoke all on function public.record_shippo_tracking_update(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_shippo_tracking_update(text, text, text, text)
  to service_role;
