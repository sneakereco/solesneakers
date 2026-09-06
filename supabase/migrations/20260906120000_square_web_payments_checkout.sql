begin;

alter table public.orders
  add column if not exists square_order_version integer
  check (square_order_version is null or square_order_version >= 0);

create or replace function public.attach_square_checkout_order(
  p_order_id uuid,
  p_square_order_id text,
  p_square_order_version integer,
  p_shipping_cents integer,
  p_tax_cents integer,
  p_total_cents integer,
  p_tax_calculation_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if nullif(trim(p_square_order_id), '') is null
    or p_square_order_version < 0
    or p_shipping_cents < 0
    or p_tax_cents < 0
    or p_total_cents <= 0
    or nullif(trim(p_tax_calculation_id), '') is null
    or p_tax_calculation_id not like 'square:%'
  then
    raise exception 'invalid_square_checkout_order';
  end if;

  update public.orders
  set
    square_order_id = p_square_order_id,
    square_order_version = p_square_order_version,
    shipping = p_shipping_cents::numeric / 100,
    tax_amount = p_tax_cents::numeric / 100,
    total = p_total_cents::numeric / 100,
    tax_calculation_id = p_tax_calculation_id,
    checkout_protection_evidence = coalesce(checkout_protection_evidence, '{}'::jsonb)
      || jsonb_build_object(
        'tax_calculation_id', p_tax_calculation_id,
        'square_order_id', p_square_order_id,
        'square_order_version', p_square_order_version,
        'square_tax_cents', p_tax_cents,
        'square_total_cents', p_total_cents
      ),
    updated_at = now()
  where id = p_order_id
    and status = 'pending'
    and expires_at > now()
    and round(subtotal * 100)::integer + p_shipping_cents + p_tax_cents = p_total_cents
    and round(shipping * 100)::integer = p_shipping_cents
    and (square_order_id is null or square_order_id = p_square_order_id);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

revoke all on function public.attach_square_checkout_order(
  uuid,
  text,
  integer,
  integer,
  integer,
  integer,
  text
) from public, anon, authenticated;

grant execute on function public.attach_square_checkout_order(
  uuid,
  text,
  integer,
  integer,
  integer,
  integer,
  text
) to service_role;

commit;
