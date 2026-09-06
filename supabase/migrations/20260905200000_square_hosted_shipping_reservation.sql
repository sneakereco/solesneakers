begin;

alter function public.reserve_square_checkout_inventory(
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
  text,
  text,
  jsonb,
  jsonb,
  jsonb
) rename to reserve_square_checkout_inventory_with_address;

revoke all on function public.reserve_square_checkout_inventory_with_address(
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
  text,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

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
  p_tax_calculation_id text,
  p_customer_state text,
  p_shipping_address jsonb,
  p_items jsonb,
  p_protection_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  v_result := public.reserve_square_checkout_inventory_with_address(
    p_tenant_id,
    p_user_id,
    p_guest_email,
    p_currency,
    p_fulfillment,
    p_idempotency_key,
    p_cart_hash,
    p_expires_at,
    p_subtotal_cents,
    p_shipping_cents,
    p_tax_cents,
    p_total_cents,
    p_tax_calculation_id,
    p_customer_state,
    case
      when p_fulfillment = 'ship' and p_shipping_address is null then
        jsonb_build_object('country', 'US', 'state', p_customer_state)
      else p_shipping_address
    end,
    p_items,
    p_protection_evidence
  );

  if p_fulfillment = 'ship' and p_shipping_address is null then
    delete from public.order_shipping
    where order_id = (v_result ->> 'order_id')::uuid
      and square_synced_at is null
      and name is null
      and phone is null
      and line1 is null
      and line2 is null
      and city is null
      and postal_code is null;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.reserve_square_checkout_inventory(
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
  text,
  text,
  jsonb,
  jsonb,
  jsonb
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
  text,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

commit;
