begin;

-- Keep the existing verified reservation transaction authoritative. The
-- reporting snapshot runs only after a new order has acquired its holds.
create function public.reserve_checkout_inventory_v2_with_analytics(p_request jsonb,p_analytics jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  result jsonb; o public.orders; ds text; tracking jsonb; receipt uuid; basis jsonb;
begin
  result:=public.reserve_checkout_inventory_v2(p_request);
  if (result->>'reused')::boolean then return result; end if;
  begin
    select * into strict o from public.orders where id=(result->>'orderId')::uuid;
    ds:=analytics_source.dataset(o.created_at);
    if ds is null then return result; end if;
    basis:=jsonb_build_object('grossMerchandiseCents',round(o.subtotal*100),'discountCents',0,
      'merchandiseCents',round(o.subtotal*100),'shippingCents',round(o.shipping*100),
      'taxCents',round(o.tax_amount*100),'totalCollectedCents',round(o.total*100),
      'paymentMethod',p_request->'paymentMethod','fulfillment',o.fulfillment,'status','pending');
    tracking:=case when p_analytics->>'datasetId'=ds then p_analytics->'tracking' end;
    if tracking->>'receiptId' is not null then
      select receipt_id into receipt from public.analytics_consent_receipts
        where dataset_id=ds and receipt_id::text=tracking->>'receiptId' and revoked_at is null
          and granted_at<=clock_timestamp() for share skip locked;
    end if;
    if receipt is not null and (
      coalesce(tracking->>'visitorId','') !~ '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|sole-buyer:v1:[a-f0-9]{64})$'
      or coalesce(tracking->>'sessionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(tracking->>'device','') not in ('desktop','mobile','tablet','unknown')
      or public.analytics_valid_acquisition(nullif(tracking->'discovery','null')) is false
      or public.analytics_valid_acquisition(nullif(tracking->'purchaseSession','null')) is false
    ) then receipt:=null; end if;
    if receipt is null then tracking:=null; end if;
    insert into public.analytics_order_context(dataset_id,order_id,buyer_key,line_snapshots,order_snapshot,
      receipt_id,visitor_id,session_id,device,discovery,purchase_session)
    values(ds,o.id,case when p_analytics->>'datasetId'=ds then p_analytics->>'buyerKey' end,
      analytics_source.lines(o.id),basis,receipt,tracking->>'visitorId',(tracking->>'sessionId')::uuid,
      tracking->>'device',nullif(tracking->'discovery','null'),nullif(tracking->'purchaseSession','null'));
  exception when others then
    raise warning 'checkout_analytics_reservation_unavailable';
  end;
  return result;
end;
$fn$;
revoke all on function public.reserve_checkout_inventory_v2_with_analytics(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_checkout_inventory_v2_with_analytics(jsonb,jsonb) to service_role;

-- Verified success is terminal for a command. Delayed after() callbacks and
-- historical negative provider reads cannot replace an accepted capture.
create or replace function analytics_source.publish(ds text, k text, source_id uuid, anchor timestamptz,
  oid uuid, buyer text, payload jsonb) returns void language plpgsql set search_path='' as $$
declare
  fid text := k||':'||source_id;
  prev public.analytics_fact_versions%rowtype;
  stamp timestamptz:=clock_timestamp();
begin
  if ds is null or anchor is null or ds is distinct from analytics_source.dataset(anchor) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(ds||':'||fid,0));
  select * into prev from public.analytics_fact_versions
    where dataset_id=ds and fact_id=fid order by revision desc limit 1;
  if k='payment_attempt' and prev.fact->'payload'->>'outcome'=payload->>'outcome'
    and (prev.fact->'payload'->>'resolvedAt')::timestamptz < (payload->>'resolvedAt')::timestamptz then
    payload:=payload||jsonb_build_object('resolvedAt',prev.fact->'payload'->'resolvedAt');
  end if;
  if prev.fact->'payload'=payload then return; end if;
  if k='payment_attempt' and prev.fact->'payload'->>'outcome'='succeeded'
    and payload->>'outcome' is distinct from 'succeeded' then return; end if;
  if k='payment_attempt' and prev.fact->'payload'->>'outcome' in ('succeeded','failed','canceled','expired')
    and payload->>'outcome' in ('pending','unknown') then return; end if;
  perform public.analytics_append_fact(jsonb_build_object('datasetId',ds,'kind',k,'factId',fid,
    'revision',coalesce(prev.revision,0)+1,'effectiveAt',coalesce(prev.effective_at,anchor),
    'recordedAt',stamp,'currency','USD','orderId',oid,'buyerKey',buyer,'payload',payload));
end;
$$;

-- Only facts already accepted by the guarded projection can publish. A signed
-- webhook receipt authorizes a provider read, so it is excluded from the
-- older reporting trigger that consumed self-contained event evidence.
create function analytics_source.project_checkout_payment(p_order_id uuid,p_payment_id text,p_provider_version text,p_source jsonb)
returns void language plpgsql security definer set search_path='' as $fn$
declare
  o public.orders; a public.checkout_payment_attempts; f public.checkout_financial_facts;
  c public.analytics_order_context; r public.square_refunds; aid uuid; outcome text;
  fee record; confirmed_at timestamptz; resolved_at timestamptz; sale jsonb; stamp text;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then return; end if;
  select * into c from public.analytics_order_context where order_id=o.id
    and dataset_id=analytics_source.dataset(o.created_at) and order_snapshot is not null;
  if not found then return; end if;
  select * into f from public.checkout_financial_facts where kind='payment'
    and order_id=o.id and payment_id=p_payment_id and provider_version=p_provider_version;
  if not found then return; end if;
  select * into a from public.checkout_payment_attempts where order_id=o.id and provider_payment_id=f.payment_id;
  if not found or a.amount_cents<>f.amount_cents then return; end if;

  aid:=analytics_source.source_id('sole-payment-attempt:'||a.square_idempotency_key);
  outcome:=case f.status when 'COMPLETED' then 'succeeded' when 'FAILED' then 'failed'
    when 'CANCELED' then 'canceled' when 'APPROVED' then 'pending' when 'PENDING' then 'pending' end;
  if outcome is null then return; end if;
  if outcome<>'pending' then
    resolved_at:=coalesce((p_source->>'resolvedAt')::timestamptz,clock_timestamp());
  end if;
  perform analytics_source.publish(c.dataset_id,'payment_attempt',aid,f.provider_time,o.id,c.buyer_key,
    jsonb_build_object('attemptId',aid,'stage','payment','method',a.method,'outcome',outcome,
      'reason',case outcome when 'failed' then 'declined' when 'canceled' then 'canceled' else 'none' end,
      'resolvedAt',resolved_at));

  if f.status<>'COMPLETED' then return; end if;
  for fee in
    select item, row_number() over(partition by item->>'type',(item->>'effectiveAt')::timestamptz order by n) occurrence
      from jsonb_array_elements(coalesce(p_source->'fees','[]'::jsonb)) with ordinality as fees(item,n)
  loop
    perform analytics_source.publish(c.dataset_id,'fee',analytics_source.source_id(
      concat_ws(':','fee',f.payment_id,fee.item->>'type',
        extract(epoch from (fee.item->>'effectiveAt')::timestamptz),fee.occurrence)),
      (fee.item->>'effectiveAt')::timestamptz,o.id,c.buyer_key,
      jsonb_build_object('adjustment',fee.item->'adjustment','amountCents',fee.item->'amountCents'));
  end loop;

  if o.checkout_financial_review is not null or o.payment_transaction_id is distinct from f.payment_id
    or o.status not in ('paid','shipped','partially_refunded','refunded')
    or not exists(select 1 from public.inventory_reservations where order_id=o.id and status='consumed')
    or exists(select 1 from public.inventory_reservations where order_id=o.id and status<>'consumed')
  then return; end if;
  stamp:=regexp_replace(p_source->>'capturedAt','([.][0-9]{6})[0-9]+','\1');
  if stamp is not null and extensions.jsonb_matches_schema(
    (public.analytics_fact_scalar_schemas()->'timestamp')::json,to_jsonb(stamp)) then
    confirmed_at:=stamp::timestamptz;
  end if;
  if confirmed_at is null or analytics_source.dataset(confirmed_at) is distinct from c.dataset_id then
    confirmed_at:=clock_timestamp();
  end if;
  sale:=c.order_snapshot||jsonb_build_object('totalCollectedCents',f.amount_cents,'paymentMethod',a.method,'taxCents',
    case when (c.order_snapshot->>'merchandiseCents')::bigint=round(o.subtotal*100)
      and (c.order_snapshot->>'shippingCents')::bigint=round(o.shipping*100)
      and (c.order_snapshot->>'totalCollectedCents')::bigint=f.amount_cents
    then to_jsonb(round(o.tax_amount*100)) end);
  perform analytics_source.sync_order(o,c,confirmed_at,sale);

  -- A refund may have been projected before the first verified sale.
  for r in select * from public.square_refunds where order_id=o.id and status='COMPLETED'
    and currency='USD' and square_created_at is not null
  loop
    perform analytics_source.publish(c.dataset_id,'refund',analytics_source.source_id('refund:'||r.square_refund_id),
      r.square_created_at,o.id,c.buyer_key,jsonb_build_object('refundId',analytics_source.source_id('refund:'||r.square_refund_id),
      'status','completed','totalCents',r.amount_cents,'merchandiseCents',null,'shippingCents',null,
      'taxCents',null,'unallocatedCents',r.amount_cents));
  end loop;
exception when others then
  raise warning 'checkout_analytics_payment_unavailable';
end;
$fn$;
revoke all on function analytics_source.project_checkout_payment(uuid,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.apply_checkout_payment_with_analytics(p_fact jsonb,p_provider_time timestamptz,p_source jsonb,p_review text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare result jsonb;
begin
  result:=public.apply_checkout_financial_fact(p_fact,p_provider_time,p_review);
  perform analytics_source.project_checkout_payment(
    (result->>'orderId')::uuid,p_fact->>'paymentId',p_fact->>'providerVersion',p_source);
  return result;
end;
$fn$;
revoke all on function public.apply_checkout_payment_with_analytics(jsonb,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_checkout_payment_with_analytics(jsonb,timestamptz,jsonb,text) to service_role;


-- These deferred effects share checkout transactions. An analytics failure
-- must not roll back stock, payment, refunds or receipt acknowledgement.
create or replace function analytics_source.order_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  c public.analytics_order_context%rowtype; o public.orders%rowtype;
  ds text;
  sale jsonb;
begin
  select * into o from public.orders where id=new.id;
  if not found then return null; end if;
  select * into c from public.analytics_order_context where order_id=o.id and order_snapshot is not null;
  if not found then
    -- Existing web eligibility remains unchanged. An independently confirmed
    -- zero-balance order has no Square payment or implied payment attempt.
    ds:=analytics_source.dataset(o.created_at);
    if ds is null or new.status is distinct from 'paid' or new.total is distinct from 0 or new.payment_transaction_id is not null
      or (tg_op='UPDATE' and old.status is not distinct from new.status)
      or coalesce(o.currency,'USD')<>'USD' then return null; end if;
    sale:=jsonb_build_object('grossMerchandiseCents',round(new.subtotal*100),'discountCents',0,
      'merchandiseCents',round(new.subtotal*100),'shippingCents',round(new.shipping*100),
      'taxCents',round(new.tax_amount*100),'totalCollectedCents',0,'paymentMethod',null,
      'fulfillment',new.fulfillment,'status','paid');
    insert into public.analytics_order_context(dataset_id,order_id,line_snapshots,order_snapshot)
      values(ds,new.id,analytics_source.lines(new.id),sale) on conflict do nothing;
    select * into c from public.analytics_order_context where order_id=o.id and dataset_id=ds;
  end if;
  if c.dataset_id is distinct from analytics_source.dataset(o.created_at) then return null; end if;
  if new.status='canceled' and new.failure_reason='checkout_expired' then
    perform analytics_source.publish(c.dataset_id,'payment_attempt',analytics_source.source_id('reservation:'||o.id),
      o.created_at,o.id,c.buyer_key,jsonb_build_object('attemptId',analytics_source.source_id('reservation:'||o.id),
      'stage','reservation','method',c.order_snapshot->'paymentMethod','outcome','expired','reason','expired',
      'resolvedAt',coalesce(new.updated_at,transaction_timestamp())));
  end if;
  if new.status='paid' and new.total=0 and new.payment_transaction_id is null
    and (tg_op='INSERT' or old.status is distinct from new.status)
    and (c.order_snapshot->>'totalCollectedCents')::bigint=0 then
    perform analytics_source.sync_order(o,c,coalesce(new.updated_at,transaction_timestamp()),
      c.order_snapshot||jsonb_build_object('paymentMethod',null));
  else
    perform analytics_source.sync_order(o,c,null,null);
  end if;
  return null;
exception when others then
  raise warning 'checkout_analytics_source_unavailable';
  return null;
end;
$$;
create or replace function analytics_source.inventory_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  observed_at timestamptz:=clock_timestamp();
  ds text:=analytics_source.dataset(observed_at);
  item public.product_variants%rowtype;
begin
  if ds is null then return null; end if;
  if tg_op='UPDATE' and new.stock is not distinct from old.stock then return null; end if;
  if tg_op='DELETE' then item:=old; item.stock:=0;
  else select * into item from public.product_variants where id=new.id; if not found then return null; end if;
  end if;
  perform analytics_source.publish(ds,'inventory',item.id,observed_at,null,null,
    jsonb_build_object('productId',item.product_id,'variantId',item.id,'availableUnits',item.stock));
  return null;
exception when others then
  raise warning 'checkout_analytics_source_unavailable';
  return null;
end;
$$;
create or replace function analytics_source.refund_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.analytics_order_context%rowtype; rid uuid; previous jsonb;
begin
  if new.status<>'COMPLETED' or new.currency<>'USD' or new.square_created_at is null then return null; end if;
  select * into c from public.analytics_order_context where order_id=new.order_id;
  if not found or not exists(select from public.analytics_fact_versions where dataset_id=c.dataset_id and fact_id='order:'||new.order_id)
    then return null; end if;
  rid:=analytics_source.source_id('refund:'||new.square_refund_id);
  select fact->'payload' into previous from public.analytics_fact_versions
    where dataset_id=c.dataset_id and fact_id='refund:'||rid order by revision desc limit 1;
  -- The Square refund interface supplies a total without per-line, shipping,
  -- or tax breakdown. Order-item cumulative refunds cannot identify this refund.
  if previous->>'totalCents' = new.amount_cents::text then return null; end if;
  perform analytics_source.publish(c.dataset_id,'refund',rid,new.square_created_at,new.order_id,c.buyer_key,
    jsonb_build_object('refundId',rid,'status','completed','totalCents',new.amount_cents,'merchandiseCents',null,
      'shippingCents',null,'taxCents',null,'unallocatedCents',new.amount_cents));
  return null;
exception when others then
  raise warning 'checkout_analytics_source_unavailable';
  return null;
end;
$$;
create or replace function analytics_source.payment_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  e jsonb:=new.event_data; c public.analytics_order_context%rowtype; status text; aid uuid;
  resolved timestamptz; start_time timestamptz:=new.square_created_at; source_fee record;
  method text; outcome text;
begin
  if new.recovery_receipt then return null; end if;
  if new.event_type not in ('payment.created','payment.updated','payment.reconciled') then return null; end if;
  select ctx.* into c from public.orders o join public.analytics_order_context ctx on ctx.order_id=o.id
    where o.square_order_id=e->>'squareOrderId' and ctx.dataset_id=analytics_source.dataset(o.created_at);
  if not found or e->>'currency' is distinct from 'USD' then return null; end if;
  status:=e->>'paymentStatus';
  outcome:=case status when 'COMPLETED' then 'succeeded' when 'FAILED' then 'failed'
    when 'CANCELED' then 'canceled' when 'APPROVED' then 'pending' when 'PENDING' then 'pending' else 'unknown' end;
  resolved:=case when outcome not in ('pending','unknown') then coalesce((e->>'resolvedAt')::timestamptz,new.processed_at) end;
  aid:=case when e->>'orderReference'=c.order_id::text and e->>'attemptId' is not null then (e->>'attemptId')::uuid
    else analytics_source.source_id('payment:'||(e->>'paymentId')) end;
  method:=c.order_snapshot->>'paymentMethod';
  perform analytics_source.publish(c.dataset_id,'payment_attempt',aid,start_time,c.order_id,c.buyer_key,
    jsonb_build_object('attemptId',aid,'stage','payment','method',method,'outcome',outcome,
    'reason',case outcome when 'failed' then 'declined' when 'canceled' then 'canceled' when 'unknown' then 'unknown' else 'none' end,
    'resolvedAt',resolved));
  if status='COMPLETED' then
    -- Square returns a cumulative fee list. Distinct same-type entries at the
    -- same effective instant retain separate occurrence numbers on replay.
    for source_fee in
      select f, row_number() over(partition by f->>'type',(f->>'effectiveAt')::timestamptz order by n) as occurrence
        from jsonb_array_elements(e->'fees') with ordinality entries(f,n)
    loop
      perform analytics_source.publish(c.dataset_id,'fee',analytics_source.source_id(
        concat_ws(':','fee',e->>'paymentId',source_fee.f->>'type',
          extract(epoch from (source_fee.f->>'effectiveAt')::timestamptz),source_fee.occurrence)),
        (source_fee.f->>'effectiveAt')::timestamptz,c.order_id,c.buyer_key,
        jsonb_build_object('adjustment',source_fee.f->'adjustment','amountCents',source_fee.f->'amountCents'));
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'checkout_analytics_source_unavailable';
  return null;
end;
$$;
create or replace function analytics_source.payment_method_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.analytics_order_context%rowtype; prev public.analytics_fact_versions%rowtype;
begin
  if new.amount_captured is null or new.amount_captured<=0 or new.payment_method is null or
    new.payment_method not in ('card','applePay','googlePay','afterpay','cashAppPay') then return null; end if;
  select ctx.* into c from public.analytics_order_context ctx join public.orders o on o.id=ctx.order_id
    where o.id=new.order_id and o.payment_transaction_id=new.square_payment_id and ctx.dataset_id=analytics_source.dataset(o.created_at);
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(c.dataset_id||':order:'||c.order_id,0));
  select * into prev from public.analytics_fact_versions where dataset_id=c.dataset_id and fact_id='order:'||c.order_id
    order by revision desc limit 1;
  if found and (prev.fact->'payload'->>'totalCollectedCents')::bigint>0 then
    perform analytics_source.publish(c.dataset_id,'order',c.order_id,prev.effective_at,c.order_id,c.buyer_key,
       (prev.fact->'payload')||jsonb_build_object('paymentMethod',new.payment_method));
  end if;
  return null;
exception when others then
  raise warning 'checkout_analytics_source_unavailable';
  return null;
end;
$$;

notify pgrst,'reload schema';
commit;
