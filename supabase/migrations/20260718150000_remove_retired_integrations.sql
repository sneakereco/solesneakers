-- Remove retired integrations and custom communication/analytics infrastructure.

drop table if exists public.admin_notifications cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.chats cascade;
drop table if exists public.payout_settings cascade;
drop table if exists public.site_pageviews cascade;

drop table if exists public.deleted_product_recovery cascade;
drop table if exists public.lightspeed_sync_run_items cascade;
drop table if exists public.lightspeed_sync_runs cascade;
drop table if exists public.lightspeed_webhook_events cascade;
drop table if exists public.lightspeed_product_links cascade;
drop table if exists public.tenant_lightspeed_settings cascade;

drop table if exists public.tenant_payrilla_credentials cascade;
drop table if exists public.payment_webhook_events cascade;

alter table if exists public.profiles
  drop column if exists chat_notifications_enabled,
  drop column if exists admin_order_notifications_enabled,
  drop column if exists payrilla_account_id,
  drop column if exists payrilla_customer_token,
  drop column if exists stripe_customer_id;

alter table if exists public.orders
  drop column if exists nofraud_decision,
  drop column if exists nofraud_transaction_id,
  drop column if exists payrilla_transaction_id,
  drop column if exists stripe_session_id;

alter table if exists public.payment_transactions
  drop column if exists nofraud_decision,
  drop column if exists nofraud_transaction_id,
  drop column if exists payrilla_auth_code,
  drop column if exists payrilla_reference_number,
  drop column if exists payrilla_status;

alter table if exists public.chargeback_evidence
  drop column if exists nofraud_decision,
  drop column if exists nofraud_transaction_id;

drop function if exists public.mark_order_paid_and_decrement(uuid, text, jsonb);

create function public.mark_order_paid_and_decrement(
  p_order_id uuid,
  p_payment_transaction_id text,
  p_items jsonb
)
returns boolean
language plpgsql
as $function$
declare
  v_order_updated integer;
  v_expected integer;
  v_updated integer;
begin
  update public.orders
  set
    status = 'paid',
    payment_transaction_id = p_payment_transaction_id,
    failure_reason = null
  where id = p_order_id
    and status in ('pending', 'processing', 'failed')
  returning 1 into v_order_updated;

  if v_order_updated is null then
    return false;
  end if;

  with raw_items as (
    select
      (item->>'variant_id')::uuid as variant_id,
      (item->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where (item->>'variant_id') is not null
  ),
  aggregated_items as (
    select variant_id, sum(quantity) as quantity
    from raw_items
    where quantity > 0
    group by variant_id
  ),
  updated_variants as (
    update public.product_variants product_variant
    set stock = product_variant.stock - aggregated_items.quantity
    from aggregated_items
    where product_variant.id = aggregated_items.variant_id
      and product_variant.stock >= aggregated_items.quantity
    returning product_variant.id
  )
  select
    (select count(*) from aggregated_items),
    (select count(*) from updated_variants)
  into v_expected, v_updated;

  return true;
end;
$function$;
