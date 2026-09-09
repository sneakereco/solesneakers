begin;

-- Every new checkout must persist billing, including express wallets.
create or replace function public.reserve_square_checkout_inventory(
  p_tenant_id uuid,
  p_user_id uuid,
  p_guest_email text,
  p_currency text,
  p_fulfillment text,
  p_payment_method text,
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
  p_billing_address jsonb,
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
  if p_payment_method not in ('card', 'afterpay', 'applePay', 'googlePay', 'cashAppPay') then
    raise exception 'invalid_checkout_payment_method';
  end if;

  if p_billing_address is null then
    raise exception 'checkout_billing_address_required';
  end if;

  if p_billing_address is not null and (
    jsonb_typeof(p_billing_address) is distinct from 'object'
    or upper(coalesce(p_billing_address ->> 'country', '')) <> 'US'
    or nullif(trim(p_billing_address ->> 'given_name'), '') is null
    or nullif(trim(p_billing_address ->> 'family_name'), '') is null
    or nullif(trim(p_billing_address ->> 'line1'), '') is null
    or nullif(trim(p_billing_address ->> 'city'), '') is null
    or upper(coalesce(p_billing_address ->> 'state', '')) !~ '^[A-Z]{2}$'
    or coalesce(p_billing_address ->> 'postal_code', '') !~ '^\d{5}(-\d{4})?$'
  ) then
    raise exception 'invalid_checkout_billing_address';
  end if;

  v_result := public.reserve_square_checkout_inventory_without_billing(
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
    p_shipping_address,
    p_items,
    p_protection_evidence
  );

  if p_billing_address is not null then
    insert into public.order_billing (
      order_id,
      name,
      phone,
      line1,
      line2,
      city,
      state,
      postal_code,
      country
    ) values (
      (v_result ->> 'order_id')::uuid,
      trim(concat_ws(
        ' ',
        p_billing_address ->> 'given_name',
        p_billing_address ->> 'family_name'
      )),
      nullif(trim(p_billing_address ->> 'phone'), ''),
      trim(p_billing_address ->> 'line1'),
      nullif(trim(p_billing_address ->> 'line2'), ''),
      trim(p_billing_address ->> 'city'),
      upper(trim(p_billing_address ->> 'state')),
      trim(p_billing_address ->> 'postal_code'),
      'US'
    )
    on conflict (order_id) do nothing;
  end if;

  return v_result;
end;
$function$;

commit;
