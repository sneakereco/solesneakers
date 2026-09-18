begin;

alter table public.payment_transactions
  add column square_payment_id text unique,
  add column payment_method text check (payment_method in ('card', 'applePay', 'googlePay', 'afterpay', 'cashAppPay')),
  alter column avs_result_code type text,
  alter column cvv2_result_code type text;

-- Keep this separate from fulfillment: a replay can repair metadata without
-- consuming inventory again or queuing another confirmation.
create function public.record_square_payment_details(
  p_square_order_id text,
  p_square_payment_id text,
  p_payment_status text,
  p_amount_cents bigint,
  p_currency text,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_method text;
begin
  select * into v_order from public.orders where square_order_id = p_square_order_id;
  if not found then raise exception 'square_order_not_found'; end if;
  if nullif(p_square_payment_id, '') is null or p_amount_cents is null or p_amount_cents <= 0
    or p_currency is distinct from coalesce(v_order.currency, 'USD')
    or p_payment_status is null or p_payment_status not in ('APPROVED', 'PENDING', 'COMPLETED', 'CANCELED', 'FAILED')
  then raise exception 'square_payment_details_invalid'; end if;

  v_method := coalesce(
    p_details ->> 'payment_method',
    v_order.checkout_protection_evidence ->> 'payment_method',
    case when p_details ->> 'source_type' = 'CARD' then 'card' end
  );

  insert into public.payment_transactions (
    order_id, tenant_id, square_payment_id, payment_method,
    amount_requested, amount_authorized, amount_captured, currency,
    card_type, card_last4, card_expiry_month, card_expiry_year,
    avs_result_code, cvv2_result_code,
    billing_name, billing_phone, billing_address, billing_city,
    billing_state, billing_zip, billing_country, customer_email
  )
  select
    v_order.id, v_order.tenant_id, p_square_payment_id, v_method,
    p_amount_cents::numeric / 100,
    case when p_payment_status in ('APPROVED', 'COMPLETED') then p_amount_cents::numeric / 100 end,
    case when p_payment_status = 'COMPLETED' then p_amount_cents::numeric / 100 end,
    p_currency,
    p_details ->> 'card_type', p_details ->> 'card_last4',
    (p_details ->> 'card_expiry_month')::integer, (p_details ->> 'card_expiry_year')::integer,
    p_details ->> 'avs_result_code', p_details ->> 'cvv2_result_code',
    billing.name, billing.phone, billing.line1 || coalesce(' ' || billing.line2, ''),
    billing.city, billing.state, billing.postal_code, billing.country,
    coalesce(profile.email, v_order.guest_email)
  from (select 1) singleton
  left join public.order_billing billing on billing.order_id = v_order.id
  left join public.profiles profile on profile.id = v_order.user_id
  on conflict (square_payment_id) do update set
    payment_method = case
      when excluded.payment_method in ('applePay', 'googlePay', 'afterpay', 'cashAppPay') then excluded.payment_method
      else coalesce(payment_transactions.payment_method, excluded.payment_method)
    end,
    amount_authorized = greatest(payment_transactions.amount_authorized, excluded.amount_authorized),
    amount_captured = greatest(payment_transactions.amount_captured, excluded.amount_captured),
    card_type = coalesce(excluded.card_type, payment_transactions.card_type),
    card_last4 = coalesce(excluded.card_last4, payment_transactions.card_last4),
    card_expiry_month = coalesce(excluded.card_expiry_month, payment_transactions.card_expiry_month),
    card_expiry_year = coalesce(excluded.card_expiry_year, payment_transactions.card_expiry_year),
    avs_result_code = coalesce(excluded.avs_result_code, payment_transactions.avs_result_code),
    cvv2_result_code = coalesce(excluded.cvv2_result_code, payment_transactions.cvv2_result_code)
  where payment_transactions.order_id = excluded.order_id;
  if not found then raise exception 'square_payment_order_mismatch'; end if;
end;
$function$;

revoke all on function public.record_square_payment_details(text, text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_square_payment_details(text, text, text, bigint, text, jsonb) to service_role;

commit;
