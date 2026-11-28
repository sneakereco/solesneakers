-- Preserve terminal payment decisions while accepting corroborating negative evidence.
begin;

create or replace function public.record_checkout_payment_outcome(p_attempt_id uuid,p_provider_payment_id text default null,
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
  -- Legacy inquiry can identify a known Square payment, never a new dispatch.
  -- The ordinary square_payment path below still validates the complete fact.
  if a.dispatched_at is null and (
    o.checkout_attempt_guarded or kind is distinct from 'square_payment'
    or a.provider_payment_id is null or p_provider_payment_id is distinct from a.provider_payment_id
    or o.payment_transaction_id is distinct from a.provider_payment_id or nullif(a.square_order_id,'') is null
    or a.state not in ('review','pending','succeeded','declined','canceled')
  ) then raise exception 'invalid_attempt_outcome'; end if;
  if p_state is null or p_state not in ('unknown','review','pending','succeeded','declined','canceled')
     or jsonb_typeof(p_verified_facts) is distinct from 'object' then raise exception 'invalid_attempt_outcome'; end if;
  -- Replay the most recent workflow outcome. Independent observations may
  -- append history or bind a previously unknown payment ID after a decline.
  if a.state=p_state and ((kind='square_payment' and p_provider_payment_id=a.provider_payment_id)
      or (kind in ('square_decline','uncertain') and p_provider_payment_id is null)) then
    select verified_facts into last_facts from public.checkout_payment_attempt_history
    where attempt_id=a.id and state=a.state and reason=a.reason order by id desc limit 1;
    if last_facts=p_verified_facts then return checkout_attempt_private.dto(a); end if;
  end if;
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


  -- A definitive decline may have no payment ID. Authenticated inquiry can
  -- later identify the same FAILED payment without changing the terminal decision.
  -- All identity, quote and status validation above still applies.
  if kind='square_payment' and a.state=p_state and a.state in ('declined','canceled') then
    if a.provider_payment_id is null then
      update public.checkout_payment_attempts set provider_payment_id=p_provider_payment_id,
        updated_at=clock_timestamp() where id=a.id returning * into a;
    end if;
    if not exists (select 1 from public.checkout_payment_attempt_history
      where attempt_id=a.id and state=a.state and reason=outcome_reason
        and verified_facts=p_verified_facts) then
      insert into public.checkout_payment_attempt_history(attempt_id,state,reason,verified_facts)
        values(a.id,a.state,outcome_reason,p_verified_facts);
    end if;
    return checkout_attempt_private.dto(a);
  end if;
  if a.state in ('succeeded','declined','canceled') then raise exception 'terminal_attempt_outcome'; end if;
  update public.checkout_payment_attempts set state=p_state,provider_payment_id=coalesce(p_provider_payment_id,provider_payment_id),
    reason=outcome_reason,updated_at=clock_timestamp()
    where id=a.id returning checkout_payment_attempts.* into a;
  insert into public.checkout_payment_attempt_history(attempt_id,state,reason,verified_facts) values(a.id,a.state,a.reason,p_verified_facts);
  return checkout_attempt_private.dto(a);
end;
$$;

commit;
