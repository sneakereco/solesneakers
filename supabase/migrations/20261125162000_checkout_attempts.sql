begin;

-- Only the guarded reservation writer may opt in on INSERT after the gateway fence.
-- Never infer this proof from age, existing permits, missing IDs or key reuse.
alter table public.orders
  add column checkout_attempt_guarded boolean not null default false,
  add column checkout_guest_context_hash text check (checkout_guest_context_hash ~ '^[0-9a-f]{64}$'),
  add constraint checkout_guarded_owner check (not checkout_attempt_guarded or
    (user_id is not null) <> (checkout_guest_context_hash is not null));

create schema checkout_attempt_private;
revoke all on schema checkout_attempt_private from public, anon, authenticated, service_role;

create function checkout_attempt_private.preserve_order_proof() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.checkout_attempt_guarded is distinct from old.checkout_attempt_guarded
     or new.checkout_guest_context_hash is distinct from old.checkout_guest_context_hash
     or (old.checkout_attempt_guarded and new.user_id is distinct from old.user_id) then
    raise exception 'checkout_order_proof_immutable';
  end if;
  return new;
end;
$$;
create trigger preserve_checkout_order_proof before update of checkout_attempt_guarded, checkout_guest_context_hash, user_id
on public.orders for each row execute function checkout_attempt_private.preserve_order_proof();

create table public.checkout_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  sequence integer not null check (sequence > 0),
  state text not null check (state in ('ready','dispatch_started','pending','unknown','succeeded','declined','canceled','review')),
  method text not null check (method in ('card','afterpay','applePay','cashAppPay')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  cart_hash text,
  square_order_id text,
  device_session_id text,
  owner_key text not null,
  square_idempotency_key uuid not null default gen_random_uuid() unique,
  provider_payment_id text unique check (provider_payment_id ~ '^[A-Za-z0-9_-]{1,192}$'),
  request_digest text check (request_digest ~ '^[0-9a-f]{64}$'),
  source_digest text check (source_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  reason text,
  unique(order_id,sequence),
  check ((dispatched_at is null) = (request_digest is null) and (request_digest is null) = (source_digest is null)),
  check (state <> 'ready' or (dispatched_at is null and provider_payment_id is null))
);
create unique index checkout_payment_one_unresolved on public.checkout_payment_attempts(order_id)
  where state in ('ready','dispatch_started','pending','unknown','review');

create table public.checkout_payment_attempt_history (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.checkout_payment_attempts(id),
  state text not null,
  reason text not null,
  verified_facts jsonb,
  recorded_at timestamptz not null default clock_timestamp()
);
create index checkout_payment_attempt_history_attempt on public.checkout_payment_attempt_history(attempt_id,id);

alter table public.checkout_payment_attempts enable row level security;
alter table public.checkout_payment_attempt_history enable row level security;
revoke all on public.checkout_payment_attempts, public.checkout_payment_attempt_history from public,anon,authenticated,service_role;
grant select on public.checkout_payment_attempts, public.checkout_payment_attempt_history to service_role;

create function checkout_attempt_private.dto(a public.checkout_payment_attempts) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',a.id,'orderId',a.order_id,'sequence',a.sequence,
    'state',a.state,'method',a.method,'amountCents',a.amount_cents,'currency',a.currency,
    'squareIdempotencyKey',a.square_idempotency_key,'requestDigest',a.request_digest,'providerPaymentId',a.provider_payment_id)
$$;

-- order:<uuid> is produced exclusively AFTER the server verifies that guest order's
-- access grant. Its UUID is a scope identifier; the RPC itself is service-only.
create function checkout_attempt_private.owner_key(o public.orders, binding text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  canonical text := coalesce('account:' || o.user_id, 'guest:' || o.checkout_guest_context_hash, 'order:' || o.id);
begin
  if o.id is null or binding is null or
     (binding <> canonical and (o.user_id is not null or binding <> 'order:' || o.id)) then
    raise exception 'checkout_order_access_denied' using errcode='42501';
  end if;
  return canonical;
end;
$$;

-- Caller holds the order and latest attempt. Lock reservation rows in ID order
-- before checking the complete order-item quantities and database-clock expiry.
create function checkout_attempt_private.require_payable(o public.orders, a public.checkout_payment_attempts)
returns void language plpgsql set search_path = '' as $$
declare
  checked_at timestamptz;
begin
  perform id from public.inventory_reservations where order_id=o.id order by id for update;
  checked_at := clock_timestamp();
  if not o.checkout_attempt_guarded or o.status is distinct from 'pending' or o.currency is distinct from 'USD'
     or o.expires_at is null or o.expires_at <= checked_at
     or nullif(o.cart_hash,'') is null or nullif(o.square_order_id,'') is null
     or o.total <= 0 or o.total*100 <> trunc(o.total*100) or o.total*100 > 2147483647
     or (o.payment_transaction_id is not null and not exists (
       select 1 from public.checkout_payment_attempts prior where prior.order_id=o.id
       and prior.provider_payment_id=o.payment_transaction_id and prior.state in ('declined','canceled')))
     or (a.id is not null and (a.cart_hash is distinct from o.cart_hash or a.square_order_id is distinct from o.square_order_id
       or a.amount_cents <> o.total*100 or a.currency <> o.currency
       or a.device_session_id is distinct from o.checkout_protection_evidence->>'device_session_id'
       or a.owner_key is distinct from coalesce('account:' || o.user_id, 'guest:' || o.checkout_guest_context_hash)))
     or not exists (select 1 from public.inventory_reservations where order_id=o.id)
     or exists (
       select 1 from (select variant_id,sum(quantity) quantity from public.order_items
                     where order_id=o.id group by variant_id) i
       full join (select * from public.inventory_reservations where order_id=o.id) r using(variant_id)
       where i.quantity is distinct from r.quantity or r.status is distinct from 'active'
          or r.tenant_id is distinct from o.tenant_id or r.expires_at <= checked_at
     ) then raise exception 'checkout_order_not_payable'; end if;
end;
$$;

create function public.get_or_create_checkout_payment_attempt(p_order_id uuid,p_method text,p_owner_binding text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  a public.checkout_payment_attempts;
  owner_key text;
  next_sequence integer;
  initial_state text;
  initial_reason text;
begin
  select * into o from public.orders where id=p_order_id for update;
  owner_key := checkout_attempt_private.owner_key(o,p_owner_binding);
  if p_method is null or p_method not in ('card','afterpay','applePay','cashAppPay') then raise exception 'invalid_payment_method'; end if;
  select * into a from public.checkout_payment_attempts where order_id=o.id order by sequence desc limit 1 for update;
  if a.id is not null and a.state not in ('ready','declined','canceled') then return checkout_attempt_private.dto(a); end if;
  next_sequence := coalesce(a.sequence,0)+1;
  if not o.checkout_attempt_guarded then
    -- The generated UUID names a review-only record and has never been a provider retry key.
    initial_state := 'review';
    initial_reason := 'legacy_dispatch_unproven';
    if a.id is not null then return checkout_attempt_private.dto(a); end if;
  else
    perform checkout_attempt_private.require_payable(o,a);
    if a.state='ready' then
      if a.method=p_method then return checkout_attempt_private.dto(a); end if;
      -- No request fingerprint and no committed dispatch. Fence the old permit
      -- before issuing a ready attempt for the shopper's new payment method.
      update public.checkout_payment_attempts set state='canceled',reason='unused_method_changed',updated_at=clock_timestamp() where id=a.id;
      insert into public.checkout_payment_attempt_history(attempt_id,state,reason) values(a.id,'canceled','unused_method_changed');
    end if;
    initial_state := 'ready';
    initial_reason := 'guarded_preparation';
  end if;
  insert into public.checkout_payment_attempts(order_id,sequence,state,method,amount_cents,currency,
      cart_hash,square_order_id,device_session_id,owner_key,provider_payment_id,reason)
    values(o.id,next_sequence,initial_state,p_method,(o.total*100)::integer,o.currency,
      o.cart_hash,o.square_order_id,o.checkout_protection_evidence->>'device_session_id',owner_key,
      case when not o.checkout_attempt_guarded then o.payment_transaction_id end,initial_reason) returning * into a;
  insert into public.checkout_payment_attempt_history(attempt_id,state,reason) values(a.id,a.state,initial_reason);
  if a.state='review' then
    perform public.enqueue_checkout_recovery('reconcile_payment','payment_attempt:' || a.id,clock_timestamp(),initial_reason,o.id);
  end if;
  return checkout_attempt_private.dto(a);
end;
$$;

create function public.begin_checkout_payment_dispatch(p_attempt_id uuid,p_owner_binding text,p_request_digest text,p_source_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  a public.checkout_payment_attempts;
begin
  select orders.* into o from public.orders orders where orders.id=(
    select order_id from public.checkout_payment_attempts where id=p_attempt_id) for update;
  perform checkout_attempt_private.owner_key(o,p_owner_binding);
  select * into strict a from public.checkout_payment_attempts where id=p_attempt_id and order_id=o.id for update;
  if a.state <> 'ready' then return jsonb_build_object('kind','observe','attempt',checkout_attempt_private.dto(a)); end if;
  if p_request_digest is null or p_source_digest is null or
     p_request_digest !~ '^[0-9a-f]{64}$' or p_source_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_dispatch_digest'; end if;
  perform checkout_attempt_private.require_payable(o,a);
  update public.checkout_payment_attempts set state='dispatch_started',reason='dispatch_claimed',
    dispatched_at=clock_timestamp(),updated_at=clock_timestamp(),request_digest=p_request_digest,source_digest=p_source_digest
    where id=a.id returning * into a;
  insert into public.checkout_payment_attempt_history(attempt_id,state,reason) values(a.id,a.state,a.reason);
  perform public.enqueue_checkout_recovery('reconcile_payment','payment_attempt:' || a.id,clock_timestamp(),'dispatch_claimed',o.id);
  return jsonb_build_object('kind','dispatch','attempt',checkout_attempt_private.dto(a));
end;
$$;

create function public.record_checkout_payment_outcome(p_attempt_id uuid,p_provider_payment_id text default null,
  p_state text default null,p_verified_facts jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  a public.checkout_payment_attempts;
  kind text := p_verified_facts->>'kind';
  outcome_reason text;
  matching_state text;
  last_facts jsonb;
begin
  select orders.* into strict o from public.orders orders where orders.id=(
    select order_id from public.checkout_payment_attempts where id=p_attempt_id) for update;
  select * into strict a from public.checkout_payment_attempts where id=p_attempt_id and order_id=o.id for update;
  if a.dispatched_at is null or p_state is null or p_state not in ('unknown','review','pending','succeeded','declined','canceled')
     or jsonb_typeof(p_verified_facts) is distinct from 'object' then raise exception 'invalid_attempt_outcome'; end if;
  if kind='square_payment' then
    matching_state := case p_verified_facts->>'status' when 'APPROVED' then 'pending' when 'PENDING' then 'pending'
      when 'COMPLETED' then 'succeeded' when 'FAILED' then 'declined' when 'CANCELED' then 'canceled' end;
    if p_provider_payment_id is null or p_provider_payment_id !~ '^[A-Za-z0-9_-]{1,192}$'
      or (a.provider_payment_id is not null and a.provider_payment_id<>p_provider_payment_id)
      or p_state is distinct from matching_state or p_verified_facts is distinct from jsonb_build_object(
        'kind','square_payment','orderId',o.id,'squareOrderId',a.square_order_id,'paymentId',p_provider_payment_id,
        'amountCents',a.amount_cents,'currency',a.currency,'status',p_verified_facts->>'status')
      then raise exception 'invalid_verified_payment'; end if;
    outcome_reason := 'verified_square_payment';
  elsif kind='square_decline' then
    -- A normalized definitive response to this exact request can lack a payment ID.
    -- Never use an SDK timeout, source reuse or an idempotency conflict as proof.
    if p_state <> 'declined' or p_provider_payment_id is not null or a.provider_payment_id is not null
       or a.state not in ('dispatch_started','unknown','declined')
       or coalesce(p_verified_facts->>'code','') not in (
         'ADDRESS_VERIFICATION_FAILURE','BUYER_REFUSED_PAYMENT','CARD_DECLINED','CARD_DECLINED_CALL_ISSUER',
         'CARD_DECLINED_VERIFICATION_REQUIRED','CARD_EXPIRED','CVV_FAILURE','GENERIC_DECLINE','INSUFFICIENT_FUNDS',
         'INVALID_ACCOUNT','INVALID_CARD','INVALID_CARD_DATA','INVALID_EXPIRATION','INVALID_EXPIRATION_DATE',
         'INVALID_EXPIRATION_YEAR','INVALID_POSTAL_CODE','TRANSACTION_LIMIT','VERIFY_AVS_FAILURE','VERIFY_CVV_FAILURE')
       or p_verified_facts is distinct from jsonb_build_object('kind',kind,'code',p_verified_facts->>'code','requestDigest',a.request_digest)
       then raise exception 'invalid_verified_decline'; end if;
    outcome_reason := 'verified_square_decline';
  elsif kind='uncertain' then
    outcome_reason := p_verified_facts->>'reason';
    if p_state not in ('unknown','review') or p_provider_payment_id is not null or outcome_reason is null
       or outcome_reason not in ('response_lost','provider_timeout','invalid_provider_response','idempotency_conflict',
         'source_reused','outcome_unavailable','inquiry_inconclusive','provider_conflict')
       or p_verified_facts is distinct from jsonb_build_object('kind',kind,'reason',outcome_reason)
       then raise exception 'invalid_uncertain_outcome'; end if;
    if p_state='unknown' and a.state in ('pending','review') then return checkout_attempt_private.dto(a); end if;
  else raise exception 'invalid_outcome_facts'; end if;

  if a.state=p_state then
    select verified_facts into last_facts from public.checkout_payment_attempt_history where attempt_id=a.id order by id desc limit 1;
    if last_facts=p_verified_facts then return checkout_attempt_private.dto(a); end if;
  end if;
  if a.state in ('succeeded','declined','canceled') then raise exception 'terminal_attempt_outcome'; end if;
  update public.checkout_payment_attempts set state=p_state,provider_payment_id=coalesce(p_provider_payment_id,provider_payment_id),
    reason=outcome_reason,updated_at=clock_timestamp()
    where id=a.id returning checkout_payment_attempts.* into a;
  insert into public.checkout_payment_attempt_history(attempt_id,state,reason,verified_facts) values(a.id,a.state,a.reason,p_verified_facts);
  return checkout_attempt_private.dto(a);
end;
$$;

revoke all on all functions in schema checkout_attempt_private from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_checkout_payment_attempt(uuid,text,text),
  public.begin_checkout_payment_dispatch(uuid,text,text,text), public.record_checkout_payment_outcome(uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.get_or_create_checkout_payment_attempt(uuid,text,text),
  public.begin_checkout_payment_dispatch(uuid,text,text,text), public.record_checkout_payment_outcome(uuid,text,text,jsonb) to service_role;

commit;
