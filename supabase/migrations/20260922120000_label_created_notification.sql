-- Persist notification work with the label; no historical labels are resent.
alter table public.orders add column tracking_url text;

alter table public.checkout_notification_outbox
  drop constraint checkout_notification_outbox_kind_check;
alter table public.checkout_notification_outbox
  add constraint checkout_notification_outbox_kind_check check (
    kind in ('order_confirmation', 'pickup_instructions', 'refund_confirmation',
      'label_created', 'shipping_update', 'delivery_confirmation')
  );

create function public.queue_label_created_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.fulfillment = 'ship' and new.status = 'paid'
    and new.fulfillment_status = 'ready_to_ship'
    and nullif(new.label_url, '') is not null
    and nullif(new.tracking_number, '') is not null
    and (old.label_url is distinct from new.label_url
      or old.tracking_number is distinct from new.tracking_number) then
    insert into public.checkout_notification_outbox(
      event_key, order_id, tenant_id, kind, payload
    ) values (
      'label_created:' || new.id::text || ':' || new.tracking_number,
      new.id, new.tenant_id, 'label_created',
      jsonb_build_object('trackingNumber', new.tracking_number,
        'carrier', new.shipping_carrier, 'trackingUrl', new.tracking_url)
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function public.queue_label_created_notification()
  from public, anon, authenticated;

create trigger queue_label_created_notification
  after update of label_url, tracking_number on public.orders
  for each row execute function public.queue_label_created_notification();
