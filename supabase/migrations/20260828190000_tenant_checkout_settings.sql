begin;

create table if not exists public.tenant_checkout_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  flat_shipping_cents integer not null check (flat_shipping_cents >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.tenant_checkout_settings enable row level security;

drop policy if exists "Admins can manage checkout settings"
  on public.tenant_checkout_settings;

create policy "Admins can manage checkout settings"
  on public.tenant_checkout_settings
  for all
  to authenticated
  using (public.is_admin_for_tenant(tenant_id))
  with check (public.is_admin_for_tenant(tenant_id));

grant select, insert, update on public.tenant_checkout_settings to authenticated;
grant all on public.tenant_checkout_settings to service_role;

drop function if exists public.attach_square_payment_link(uuid, text, text, text);

create function public.attach_square_payment_link(
  p_order_id uuid,
  p_square_payment_link_id text,
  p_square_order_id text,
  p_square_payment_link_url text,
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
  if p_shipping_cents < 0
    or p_tax_cents < 0
    or p_total_cents <= 0
    or nullif(trim(p_tax_calculation_id), '') is null
    or p_tax_calculation_id not like 'square:%'
  then
    raise exception 'invalid_square_checkout_totals';
  end if;

  update public.orders
  set
    square_payment_link_id = p_square_payment_link_id,
    square_order_id = p_square_order_id,
    square_payment_link_url = p_square_payment_link_url,
    square_payment_link_deleted_at = null,
    shipping = p_shipping_cents::numeric / 100,
    tax_amount = p_tax_cents::numeric / 100,
    total = p_total_cents::numeric / 100,
    tax_calculation_id = p_tax_calculation_id,
    checkout_protection_evidence = coalesce(checkout_protection_evidence, '{}'::jsonb)
      || jsonb_build_object(
        'tax_calculation_id', p_tax_calculation_id,
        'square_order_id', p_square_order_id,
        'square_tax_cents', p_tax_cents,
        'square_total_cents', p_total_cents
      ),
    updated_at = now()
  where id = p_order_id
    and status = 'pending'
    and expires_at > now()
    and round(subtotal * 100)::integer + p_shipping_cents + p_tax_cents = p_total_cents
    and round(shipping * 100)::integer = p_shipping_cents
    and (
      square_payment_link_id is null
      or square_payment_link_id = p_square_payment_link_id
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

commit;
