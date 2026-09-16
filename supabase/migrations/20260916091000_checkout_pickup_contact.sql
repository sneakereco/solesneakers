begin;

alter table public.orders
  add column pickup_name text,
  add column pickup_phone text,
  add constraint orders_pickup_contact_complete check (
    (pickup_name is null and pickup_phone is null)
    or (fulfillment = 'pickup' and pickup_name is not null and pickup_phone is not null
      and length(trim(pickup_name)) between 1 and 100
      and length(pickup_phone) between 7 and 30
      and pickup_phone ~ '^\+?[0-9 ().-]+$'
      and regexp_replace(pickup_phone, '[^0-9]', '', 'g') ~ '^[0-9]{7,15}$')
  );

-- Replace the signature atomically so PostgREST has one unambiguous overload.
drop function public.reserve_square_checkout_inventory(uuid, uuid, text, text, text, text, text, text, timestamptz, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb);

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
  p_protection_evidence jsonb,
  p_pickup_contact jsonb default null
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

  if p_fulfillment = 'pickup' and (
    jsonb_typeof(p_pickup_contact) is distinct from 'object'
    or coalesce(length(trim(p_pickup_contact ->> 'name')), 0) not between 1 and 100
    or coalesce(length(trim(p_pickup_contact ->> 'phone')), 0) not between 7 and 30
    or coalesce(trim(p_pickup_contact ->> 'phone'), '') !~ '^\+?[0-9 ().-]+$'
    or regexp_replace(coalesce(p_pickup_contact ->> 'phone', ''), '[^0-9]', '', 'g') !~ '^[0-9]{7,15}$'
  ) then
    raise exception 'checkout_pickup_contact_required';
  end if;
  if p_fulfillment <> 'pickup' and p_pickup_contact is not null then
    raise exception 'checkout_pickup_contact_not_allowed';
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

  if p_fulfillment = 'pickup' then
    if coalesce((v_result ->> 'reused')::boolean, false) then
      if not exists (
        select 1 from public.orders
        where id = (v_result ->> 'order_id')::uuid
          and pickup_name = trim(p_pickup_contact ->> 'name')
          and pickup_phone = trim(p_pickup_contact ->> 'phone')
      ) then
        raise exception 'checkout_pickup_contact_conflict';
      end if;
    else
      update public.orders
      set pickup_name = trim(p_pickup_contact ->> 'name'),
          pickup_phone = trim(p_pickup_contact ->> 'phone')
      where id = (v_result ->> 'order_id')::uuid and tenant_id = p_tenant_id;
    end if;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.reserve_square_checkout_inventory(uuid, uuid, text, text, text, text, text, text, timestamptz, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_square_checkout_inventory(uuid, uuid, text, text, text, text, text, text, timestamptz, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

commit;
