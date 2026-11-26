begin;

create table public.checkout_financial_facts (
  kind text not null check (kind in ('payment','refund')),
  provider_id text not null check (provider_id ~ '^[A-Za-z0-9._:=+-]{1,192}$'),
  provider_version text not null check (length(provider_version) between 1 and 256),
  order_id uuid not null references public.orders(id),
  payment_id text not null,
  status text not null check (status in ('PENDING','APPROVED','COMPLETED','FAILED','CANCELED','REJECTED')),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency='USD'),
  provider_time timestamptz not null,
  primary key(kind,provider_id,provider_version)
);
create index checkout_financial_facts_order on public.checkout_financial_facts(order_id,kind,status);
alter table public.checkout_financial_facts enable row level security;
revoke all on public.checkout_financial_facts from public,anon,authenticated,service_role;
grant select on public.checkout_financial_facts to service_role;

alter table public.orders add column checkout_financial_review text;
update public.orders set checkout_financial_review=failure_reason
where status='review' and failure_reason in ('square_payment_high_risk','square_payment_amount_mismatch','late_or_released_square_payment');
alter table public.square_refunds add column checkout_status_conflict boolean not null default false;

-- Keep established settlement and fulfillment visible while a separate review
-- prevents a new staff fulfillment transition under the same order lock.
create function checkout_attempt_private.guard_reviewed_fulfillment() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.checkout_financial_review is not null and new.fulfillment_status is distinct from old.fulfillment_status
    and new.fulfillment_status in ('ready_to_ship','shipped','picked_up') then
    raise exception 'checkout_financial_review_required';
  end if;
  return new;
end;
$$;
create trigger checkout_reviewed_fulfillment before update of fulfillment_status on public.orders
for each row execute function checkout_attempt_private.guard_reviewed_fulfillment();

create function public.apply_checkout_financial_fact(p_fact jsonb,p_provider_time timestamptz,p_review text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  o public.orders; a public.checkout_payment_attempts; old_fact public.checkout_financial_facts;
  old_refund public.square_refunds;
  k text:=p_fact->>'kind'; obj text:=p_fact->>'providerId'; pay text:=p_fact->>'paymentId';
  ver text:=p_fact->>'providerVersion'; st text:=p_fact->>'status'; amount integer:=(p_fact->>'amountCents')::integer;
  capture_payment text; capture_time timestamptz; capture_count integer;
  captured bigint; refunded bigint; revision bigint; financial text; compatible text;
  review text; hold_count integer; valid_count integer; consumed_count integer;
begin
  select * into strict o from public.orders where id=(p_fact->>'orderId')::uuid for update;
  select * into strict a from public.checkout_payment_attempts where order_id=o.id and provider_payment_id=pay;
  if p_fact is distinct from jsonb_build_object('kind',k,'providerId',obj,'paymentId',pay,'orderId',o.id,'providerVersion',ver,
    'status',st,'amountCents',amount,'currency','USD','expectedTotalCents',a.amount_cents,'fulfillmentStatus',p_fact->>'fulfillmentStatus')
    or p_provider_time is null or a.currency is distinct from 'USD' or o.currency is distinct from a.currency
    or o.square_order_id is distinct from a.square_order_id or a.square_order_id is null
    or (not o.checkout_attempt_guarded and o.payment_transaction_id is distinct from pay)
    or p_review is not null and p_review <> 'square_payment_high_risk'
    or (k='payment' and obj is distinct from pay) or (st='COMPLETED' and a.state <> 'succeeded')
    or (k='payment' and st='REJECTED') or (k='refund' and st in ('APPROVED','CANCELED'))
    then raise exception 'invalid_verified_financial_fact'; end if;
  review:=coalesce(o.checkout_financial_review,case when o.status='review' and o.failure_reason in
    ('square_payment_high_risk','square_payment_amount_mismatch','late_or_released_square_payment') then o.failure_reason end,p_review);
  -- A business object cannot migrate across orders even on a different revision.
  perform pg_advisory_xact_lock(hashtextextended(k || ':' || obj, 0));
  if exists(select 1 from public.checkout_financial_facts f where f.kind=k and f.provider_id=obj and
     (f.order_id<>o.id or f.payment_id<>pay)) then raise exception 'financial_object_binding_conflict'; end if;
  insert into public.checkout_financial_facts(kind,provider_id,provider_version,order_id,payment_id,status,amount_cents,currency,provider_time)
  values(k,obj,ver,o.id,pay,st,amount,'USD',p_provider_time) on conflict do nothing;
  select * into strict old_fact from public.checkout_financial_facts where kind=k and provider_id=obj and provider_version=ver;
  if (k='payment' and old_fact.status<>st) or old_fact.amount_cents<>amount or
     (k='payment' and amount<>a.amount_cents) or amount>a.amount_cents or
     exists(select 1 from public.checkout_financial_facts where kind=k and provider_id=obj and amount_cents<>amount)
     then review:=coalesce(review,'square_amount_conflict'); end if;

  if k='refund' then
    select * into old_refund from public.square_refunds where square_refund_id=obj for update;
    if old_refund.order_id is not null and (old_refund.order_id<>o.id or old_refund.square_payment_id<>pay)
      then raise exception 'financial_object_binding_conflict'; end if;
    if old_refund.amount_cents is not null and old_refund.amount_cents<>amount then review:=coalesce(review,'square_amount_conflict'); end if;
    -- An opaque version is never compared as a timestamp. Terminal facts win
    -- over pending. Inconsistent terminal observations remain reviewable.
    if old_refund.status in ('COMPLETED','FAILED','REJECTED') and st in ('COMPLETED','FAILED','REJECTED') and old_refund.status<>st
      then
        review:=coalesce(review,'square_status_conflict');
        update public.square_refunds set checkout_status_conflict=true where square_refund_id=obj and not checkout_status_conflict;
      end if;
    -- A separate payment or inventory review cannot erase a verified refund.
    -- Only contradiction about this refund object prevents its projection.
    if (old_fact.status=st or st='COMPLETED') and old_fact.amount_cents=amount and amount<=a.amount_cents
      and (old_refund.amount_cents is null or old_refund.amount_cents=amount)
      and not exists(select 1 from public.checkout_financial_facts where kind=k and provider_id=obj and amount_cents<>amount)
      and (old_refund.status is null or (old_refund.status='PENDING' and st<>'PENDING') or
        (old_refund.status in ('FAILED','REJECTED') and st='COMPLETED')) then
      insert into public.square_refunds(square_refund_id,order_id,tenant_id,square_payment_id,status,amount_cents,currency,square_created_at)
      values(obj,o.id,o.tenant_id,pay,st,amount,'USD',p_provider_time)
      on conflict(square_refund_id) do update set status=excluded.status, updated_at=now();
      insert into public.order_events(order_id,type,message) values(o.id,
        case when st='COMPLETED' then 'payment_refunded' when st='PENDING' then 'payment_refund_pending' else 'payment_refund_failed' end,
        'Square refund status: '||st);
    end if;
  end if;

  -- The incoming observation can refer to an earlier declined sequence.
  -- Each completed payment is counted once against its own immutable quote.
  select count(*),coalesce(sum(c.amount),0),min(c.payment_id),min(c.paid_at)
  into capture_count,captured,capture_payment,capture_time from (
    select f.payment_id,ledger.amount_cents as amount,min(f.provider_time) as paid_at
    from public.checkout_financial_facts f join public.checkout_payment_attempts ledger
      on ledger.order_id=f.order_id and ledger.provider_payment_id=f.payment_id
    where f.order_id=o.id and f.kind='payment' and f.status='COMPLETED' and ledger.state='succeeded'
      and ledger.amount_cents=f.amount_cents and ledger.currency=f.currency
    group by f.payment_id,ledger.amount_cents
  ) c;
  if capture_count>1 then review:=coalesce(review,'square_multiple_captures'); end if;
  select greatest(coalesce(sum(amount_cents),0),coalesce(o.refund_amount,0),
    case when o.status='refunded' then a.amount_cents else 0 end) into refunded from public.square_refunds
    where order_id=o.id and status='COMPLETED';
  if refunded>a.amount_cents then review:=coalesce(review,'square_amount_conflict'); end if;
  financial:=case when refunded>=a.amount_cents then 'refunded' when refunded>0 or o.status='partially_refunded' then 'partially_refunded'
    when captured>0 then 'paid' else 'unpaid' end;
  compatible:=o.status;
  if captured>0 and review is null and o.status not in ('shipped','refunded','partially_refunded')
    and coalesce(o.fulfillment_status,'unfulfilled') not in ('shipped','picked_up','delivered') then
    perform id from public.inventory_reservations where order_id=o.id order by id for update;
    select count(*),count(*) filter(where status='active' and expires_at>capture_time),
      count(*) filter(where status='consumed') into hold_count,valid_count,consumed_count
      from public.inventory_reservations where order_id=o.id;
    if consumed_count=hold_count and hold_count>0 then compatible:='paid';
    elsif hold_count=valid_count and hold_count>0 and o.expires_at>capture_time and
      not exists(select 1 from (select variant_id,sum(quantity) quantity from public.order_items where order_id=o.id group by variant_id) i
        full join (select variant_id,quantity from public.inventory_reservations where order_id=o.id) r using(variant_id)
        where i.quantity is distinct from r.quantity) then
      update public.inventory_reservations set status='consumed',consumed_at=now(),updated_at=now() where order_id=o.id and status='active';
      compatible:='paid';
    else review:='late_or_released_square_payment'; end if;
  end if;
  -- Queue the two capture effects before refund state overlays the status.
  if captured>0 and compatible='paid' and review is null then
    insert into public.checkout_notification_outbox(event_key,order_id,tenant_id,kind)
      values('order_confirmation:'||o.id,o.id,o.tenant_id,'order_confirmation') on conflict(event_key) do nothing;
    if o.fulfillment='pickup' then
      insert into public.checkout_notification_outbox(event_key,order_id,tenant_id,kind)
        values('pickup_instructions:'||o.id,o.id,o.tenant_id,'pickup_instructions') on conflict(event_key) do nothing;
    end if;
  end if;
  -- A refund can reach us before capture. Preserve the money fact immediately
  -- while keeping the legacy eligibility predicate closed until capture proof.
  if financial in ('refunded','partially_refunded') and
    (captured>0 or o.status in ('paid','shipped','partially_refunded','refunded')) then
    compatible:=financial;
  elsif review is not null and o.status not in ('paid','shipped','refunded','partially_refunded') then compatible:='review';
  elsif o.status not in ('shipped','refunded','partially_refunded') and refunded=0 and review is null then
    if exists(select 1 from public.square_refunds where order_id=o.id and status='PENDING') then compatible:='refund_pending';
    elsif exists(select 1 from public.square_refunds where order_id=o.id and status in ('FAILED','REJECTED')) then compatible:='refund_failed';
    end if;
  end if;
  update public.orders set status=compatible,checkout_financial_review=review,
    payment_transaction_id=case when capture_count=1 then capture_payment else payment_transaction_id end,
    refund_amount=case when refunded>0 then refunded else refund_amount end,
    refunded_at=case when refunded>0 then coalesce(refunded_at,now()) else refunded_at end,
    failure_reason=coalesce(review,failure_reason),updated_at=now() where id=o.id;
  select count(*) into revision from public.checkout_financial_facts where order_id=o.id;
  return jsonb_build_object('orderId',o.id,'revision',revision::text,'capturedCents',captured,'refundedCents',refunded,
    'financialState',financial,'fulfillmentStatus',coalesce(o.fulfillment_status,'unfulfilled'),'reviewReason',review);
end;
$$;

-- Consumers that repeat the historical consumption operation can observe only
-- an already proven, consumed payment. First consumption belongs to projection.
create or replace function public.consume_square_checkout_reservation(p_order_id uuid,p_square_payment_id text,p_paid_at timestamptz)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.orders o join public.checkout_payment_attempts a on a.order_id=o.id
    where o.id=p_order_id and a.provider_payment_id=p_square_payment_id and a.state='succeeded'
    and o.payment_transaction_id=p_square_payment_id and o.status in ('paid','shipped','partially_refunded')
    and o.checkout_financial_review is null and exists(select 1 from public.checkout_financial_facts f where f.order_id=o.id
      and f.kind='payment' and f.payment_id=p_square_payment_id and f.status='COMPLETED' and f.amount_cents=a.amount_cents)
    and exists(select 1 from public.inventory_reservations r where r.order_id=o.id and r.status='consumed')
    and not exists(select 1 from public.inventory_reservations r where r.order_id=o.id and r.status<>'consumed'));
$$;
create or replace function public.consume_square_checkout_reservation(p_order_id uuid,p_square_payment_id text)
returns boolean language sql security definer set search_path='' as $$
 select public.consume_square_checkout_reservation(p_order_id,p_square_payment_id,now());
$$;
revoke all on function public.apply_checkout_financial_fact(jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.apply_checkout_financial_fact(jsonb,timestamptz,text) to service_role;
-- Dispute refresh consumes the existing signed receipt. Persist the verified
-- state and its attributed order event exactly once in this transaction.
alter table public.square_disputes add column provider_updated_at timestamptz;
create function public.apply_checkout_dispute_receipt(p_event_id text,p_order_id uuid,p_dispute jsonb)
returns void language plpgsql security definer set search_path='' as $dispute$
declare
  receipt public.square_webhook_events; o public.orders; prior public.square_disputes;
  obj text:=p_dispute->>'id'; pay text:=p_dispute->>'paymentId'; st text:=p_dispute->>'state';
  reason text:=p_dispute->>'reason'; amount integer:=(p_dispute->>'amountCents')::integer;
  changed timestamptz:=(p_dispute->>'updatedAt')::timestamptz;
begin
  select * into strict o from public.orders where id=p_order_id for update;
  select * into strict receipt from public.square_webhook_events where square_event_id=p_event_id and recovery_receipt for update;
  if receipt.event_type not in ('dispute.created','dispute.state.updated')
    or receipt.event_data->>'disputeId' is distinct from obj or receipt.event_data->>'paymentId' is distinct from pay
    or o.payment_transaction_id is distinct from pay or p_dispute->>'currency' is distinct from 'USD'
    or amount is null or amount<=0 or amount>o.total*100 or changed is null or st is null or st !~ '^[A-Z_]{1,64}$'
    or reason is null or reason !~ '^[A-Z_]{1,80}$' then raise exception 'invalid_verified_dispute'; end if;
  if receipt.processed_at is not null then return; end if;
  select * into prior from public.square_disputes where square_dispute_id=obj for update;
  if prior.order_id is not null and (prior.order_id<>o.id or prior.square_payment_id<>pay) then raise exception 'invalid_verified_dispute'; end if;
  if prior.provider_updated_at is null or changed>prior.provider_updated_at then
    insert into public.square_disputes(square_dispute_id,order_id,tenant_id,square_payment_id,state,reason,amount_cents,currency,due_at,square_created_at,provider_updated_at)
    values(obj,o.id,o.tenant_id,pay,st,reason,amount,'USD',(p_dispute->>'dueAt')::timestamptz,receipt.square_created_at,changed)
    on conflict(square_dispute_id) do update set state=excluded.state,reason=excluded.reason,amount_cents=excluded.amount_cents,
      due_at=excluded.due_at,provider_updated_at=excluded.provider_updated_at,updated_at=now()
      where square_disputes.order_id=o.id and square_disputes.square_payment_id=pay;
    if not found then raise exception 'invalid_verified_dispute'; end if;
    insert into public.order_events(order_id,type,message) values(o.id,
      case when prior.order_id is null then 'payment_dispute_created' else 'payment_dispute_updated' end,'Square dispute state: '||st);
  elsif changed=prior.provider_updated_at and (prior.state<>st or prior.amount_cents<>amount or prior.reason<>reason) then
    raise exception 'dispute_refresh_conflict';
  end if;
  update public.square_webhook_events set processed_at=now() where square_event_id=p_event_id;
end;
$dispute$;
revoke all on function public.apply_checkout_dispute_receipt(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_checkout_dispute_receipt(text,uuid,jsonb) to service_role;
commit;
