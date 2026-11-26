begin;
create schema analytics_source;
revoke all on schema analytics_source from public, anon, authenticated, service_role;

-- Omitted costs were historically written as zero. Only a trusted explicit
-- entry can establish that a zero is known. No historical rows are rewritten.
alter table public.product_variants add column unit_cost_recorded boolean not null default false;
alter table public.analytics_order_context add column order_snapshot jsonb
  check (order_snapshot is null or public.analytics_valid_payload('order',order_snapshot));

create index analytics_source_order_context_by_order on public.analytics_order_context(order_id);

-- A deployment database has one active first-party dataset. Ambiguous or
-- absent configuration suppresses collection, including in shared fixtures.
create function analytics_source.dataset(at_time timestamptz) returns text
language sql stable set search_path='' as $$
  select case when count(*)=1 then min(dataset_id) end from public.analytics_datasets
  where dataset_id='sole-'||environment and environment in ('staging','production')
    and schema_version=2 and activated_at<=at_time
$$;

-- Internal UUIDv8 for provider identifiers without a native UUID. Never
-- expose the provider key, raw note, payment ID, or transaction metadata.
create function analytics_source.source_id(source_key text) returns uuid
language sql immutable strict set search_path='' as $$
  select (substr(h,1,12)||'8'||substr(h,14,3)||'8'||substr(h,18,15))::uuid
  from (select encode(sha256(convert_to(source_key,'UTF8')),'hex') h) s
$$;

create function analytics_source.publish(ds text, k text, source_id uuid, anchor timestamptz,
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
  if k='payment_attempt' and prev.fact->'payload'->>'outcome' in ('succeeded','failed','canceled','expired')
    and payload->>'outcome' in ('pending','unknown') then return; end if;
  perform public.analytics_append_fact(jsonb_build_object('datasetId',ds,'kind',k,'factId',fid,
    'revision',coalesce(prev.revision,0)+1,'effectiveAt',coalesce(prev.effective_at,anchor),
    'recordedAt',stamp,'currency','USD','orderId',oid,'buyerKey',buyer,'payload',payload));
end;
$$;

create function analytics_source.lines(oid uuid) returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'productId',l.product_id,
    'variantId',l.variant_id,'productName',public.analytics_snapshot_catalog_label(l.product_name),
    'brandId',p.brand_id,'brandLabel',public.analytics_snapshot_catalog_label(l.brand),
    'categoryId',case when l.category is not null then analytics_source.source_id('category:'||l.category) end,
    'categoryLabel',public.analytics_snapshot_catalog_label(l.category),'sizeId',v.size_id,
    'sizeLabel',public.analytics_snapshot_catalog_label(l.size_label),'quantity',l.quantity,
    'unitGrossCents',round(l.unit_price*100),'discountCents',0,'merchandiseCents',round(l.line_total*100),
    'unitCostCents',case when v.unit_cost_cents>0 or v.unit_cost_recorded then v.unit_cost_cents end
  ) order by l.id),'[]') from public.order_items l
    left join public.products p on p.id=l.product_id
    left join public.product_variants v on v.id=l.variant_id
    where l.order_id=oid and l.product_id is not null
$$;

create function public.reserve_square_checkout_inventory_with_analytics(p_checkout jsonb,p_analytics jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  result jsonb; oid uuid; ds text; tracking jsonb; receipt uuid; totals jsonb; basis jsonb;
begin
  result:=public.reserve_square_checkout_inventory(
    (p_checkout->>'p_user_id')::uuid,p_checkout->>'p_guest_email',p_checkout->>'p_currency',
    p_checkout->>'p_fulfillment',p_checkout->>'p_payment_method',p_checkout->>'p_idempotency_key',
    p_checkout->>'p_cart_hash',(p_checkout->>'p_expires_at')::timestamptz,
    (p_checkout->>'p_subtotal_cents')::integer,(p_checkout->>'p_shipping_cents')::integer,
    (p_checkout->>'p_tax_cents')::integer,(p_checkout->>'p_total_cents')::integer,
    p_checkout->>'p_tax_calculation_id',p_checkout->>'p_customer_state',
    nullif(p_checkout->'p_shipping_address','null'),nullif(p_checkout->'p_billing_address','null'),
    p_checkout->'p_items',p_checkout->'p_protection_evidence',nullif(p_checkout->'p_pickup_contact','null'));
  if (result->>'reused')::boolean then return result; end if;
  oid:=(result->>'order_id')::uuid;
  ds:=analytics_source.dataset(transaction_timestamp());
  if ds is null or (p_analytics->>'datasetId' is not null and ds<>p_analytics->>'datasetId') then return result; end if;
  totals:=p_analytics->'totals';
  basis:=jsonb_build_object('grossMerchandiseCents',p_checkout->'p_subtotal_cents','discountCents',0,
    'merchandiseCents',p_checkout->'p_subtotal_cents','shippingCents',p_checkout->'p_shipping_cents',
    'taxCents',coalesce(totals->'taxCents',p_checkout->'p_tax_cents'),
    'totalCollectedCents',coalesce(totals->'totalCents',p_checkout->'p_total_cents'),
    'paymentMethod',p_checkout->'p_payment_method','fulfillment',p_checkout->'p_fulfillment','status','pending');
  tracking:=p_analytics->'tracking';
  if tracking->>'receiptId' is not null then
    select receipt_id into receipt from public.analytics_consent_receipts
      where dataset_id=ds and receipt_id::text=tracking->>'receiptId' and revoked_at is null
        and granted_at<=clock_timestamp() for share;
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
  values(ds,oid,p_analytics->>'buyerKey',analytics_source.lines(oid),basis,
    receipt,tracking->>'visitorId',(tracking->>'sessionId')::uuid,tracking->>'device',
    nullif(tracking->'discovery','null'),nullif(tracking->'purchaseSession','null'));
  return result;
end;
$$;
revoke all on function public.reserve_square_checkout_inventory_with_analytics(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_square_checkout_inventory_with_analytics(jsonb,jsonb) to service_role;

-- First entry requires a live transition into authoritative paid status.
-- Later order edits can only revise lifecycle fields of that original sale.
create index analytics_completed_payment_source on public.square_webhook_events
  ((event_data->>'squareOrderId'),(event_data->>'paymentId'),processed_at desc)
  where event_data->>'paymentStatus'='COMPLETED' and processed_at is not null;

create function analytics_source.order_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  c public.analytics_order_context%rowtype; o public.orders%rowtype;
  prev public.analytics_fact_versions%rowtype; ds text; anchor timestamptz;
  sale jsonb; line jsonb; method text; state text; fulfilled timestamptz; event jsonb;
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
  select * into prev from public.analytics_fact_versions
    where dataset_id=c.dataset_id and fact_id='order:'||o.id order by revision desc limit 1;
  if prev.fact is null then
    if new.status is distinct from 'paid' or (tg_op='UPDATE' and old.status is not distinct from new.status) then return null; end if;
    select e.event_data into event from public.square_webhook_events e
      where e.event_data->>'paymentId'=new.payment_transaction_id and e.event_data->>'squareOrderId'=o.square_order_id
        and e.event_data->>'paymentStatus'='COMPLETED' and e.processed_at is not null
      order by e.processed_at desc limit 1;
    anchor:=coalesce((event->>'resolvedAt')::timestamptz,new.updated_at,transaction_timestamp());
    sale:=c.order_snapshot;
    if event->>'amountCents' is not null then
      sale:=sale||jsonb_build_object('totalCollectedCents',event->'amountCents','taxCents',
        (event->>'amountCents')::bigint-(sale->>'merchandiseCents')::bigint-(sale->>'shippingCents')::bigint);
    end if;
    for line in select value from jsonb_array_elements(c.line_snapshots) loop
      perform analytics_source.publish(c.dataset_id,'line',(line->>'lineId')::uuid,anchor,o.id,c.buyer_key,line);
    end loop;
  else
    anchor:=prev.effective_at;
    sale:=prev.fact->'payload';
  end if;
  if (sale->>'totalCollectedCents')::bigint>0 then
    select payment_method into method from public.payment_transactions where order_id=o.id
      and square_payment_id=o.payment_transaction_id and amount_captured>0;
    if method in ('card','applePay','googlePay','afterpay','cashAppPay') then sale:=sale||jsonb_build_object('paymentMethod',method); end if;
  end if;
  perform analytics_source.publish(c.dataset_id,'order',o.id,anchor,o.id,c.buyer_key,sale||jsonb_build_object('status',coalesce(o.status,sale->>'status')));
  state:=lower(coalesce(o.fulfillment_status,'unfulfilled'));
  if o.status='shipped' and state in ('pending','unfulfilled') then state:='shipped'; end if;
  if state not in ('pending','processing','unfulfilled','ready','ready_for_pickup','shipped','delivered','picked_up','fulfilled','canceled') then state:='unknown'; end if;
  if state in ('shipped','delivered','picked_up','fulfilled') then
    select (fact->'payload'->>'fulfilledAt')::timestamptz into fulfilled from public.analytics_fact_versions
      where dataset_id=c.dataset_id and fact_id='fulfillment:'||o.id order by revision desc limit 1;
    fulfilled:=coalesce(fulfilled,o.shipped_at,new.updated_at,transaction_timestamp());
  end if;
  if sale->>'fulfillment' in ('ship','pickup') then
    perform analytics_source.publish(c.dataset_id,'fulfillment',o.id,anchor,o.id,c.buyer_key,
      jsonb_build_object('method',sale->'fulfillment','state',state,'paidAt',anchor,'fulfilledAt',fulfilled));
  end if;
  if o.label_created_at is not null and o.actual_shipping_cost_cents>=0 then
    perform analytics_source.publish(c.dataset_id,'shipping_cost',o.id,o.label_created_at,o.id,c.buyer_key,
      jsonb_build_object('adjustment','charge','amountCents',o.actual_shipping_cost_cents));
  end if;
  return null;
end;
$$;
create constraint trigger analytics_order_changed after insert or update on public.orders
deferrable initially deferred for each row execute function analytics_source.order_changed();

create function analytics_source.inventory_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare ds text:=analytics_source.dataset(transaction_timestamp()); item public.product_variants%rowtype;
begin
  if ds is null then return null; end if;
  if tg_op='UPDATE' and new.stock is not distinct from old.stock then return null; end if;
  if tg_op='DELETE' then item:=old; item.stock:=0;
  else select * into item from public.product_variants where id=new.id; if not found then return null; end if;
  end if;
  perform analytics_source.publish(ds,'inventory',item.id,transaction_timestamp(),null,null,
    jsonb_build_object('productId',item.product_id,'variantId',item.id,'availableUnits',item.stock));
  return null;
end;
$$;
create constraint trigger analytics_inventory_changed after insert or update or delete on public.product_variants
deferrable initially deferred for each row execute function analytics_source.inventory_changed();

create function analytics_source.refund_changed() returns trigger
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
end;
$$;
create constraint trigger analytics_refund_changed after insert or update on public.square_refunds
deferrable initially deferred for each row execute function analytics_source.refund_changed();
create function public.analytics_record_operational_outcome(p_dataset_id text,p_outcome jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  oid uuid:=(p_outcome->>'orderId')::uuid; aid uuid:=(p_outcome->>'attemptId')::uuid;
  anchor timestamptz:=(p_outcome->>'effectiveAt')::timestamptz; buyer text;
begin
  if p_dataset_id is distinct from analytics_source.dataset(anchor) then return; end if;
  if oid is not null then
    select buyer_key into buyer from public.analytics_order_context where order_id=oid and dataset_id=p_dataset_id;
    if not found then return; end if;
  end if;
  -- Optional linkage is private to the purchase context. A supplied receipt
  -- never enters operational facts and cannot authorize behavioral publication.
  perform analytics_source.publish(p_dataset_id,'payment_attempt',aid,anchor,oid,buyer,
    p_outcome - array['effectiveAt','orderId','receiptId']);
end;
$$;
revoke all on function public.analytics_record_operational_outcome(text,jsonb) from public,anon,authenticated;
grant execute on function public.analytics_record_operational_outcome(text,jsonb) to service_role;

create function analytics_source.payment_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  e jsonb:=new.event_data; c public.analytics_order_context%rowtype; status text; aid uuid;
  resolved timestamptz; start_time timestamptz:=new.square_created_at; source_fee record;
  method text; outcome text;
begin
  if new.event_type not in ('payment.created','payment.updated','payment.reconciled') then return null; end if;
  select ctx.* into c from public.orders o join public.analytics_order_context ctx on ctx.order_id=o.id
    where o.square_order_id=e->>'squareOrderId' and ctx.dataset_id=analytics_source.dataset(o.created_at);
  if not found or e->>'currency'<>'USD' then return null; end if;
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
end;
$$;
create constraint trigger analytics_payment_event after update of processed_at on public.square_webhook_events
deferrable initially deferred for each row when (new.processed_at is not null)
execute function analytics_source.payment_event();

-- Provider-confirmed wallet detail can arrive after order confirmation.
create function analytics_source.payment_method_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.analytics_order_context%rowtype; prev public.analytics_fact_versions%rowtype;
begin
  if new.amount_captured is null or new.amount_captured<=0 or new.payment_method is null or
    new.payment_method not in ('card','applePay','googlePay','afterpay','cashAppPay') then return null; end if;
  select ctx.* into c from public.analytics_order_context ctx join public.orders o on o.id=ctx.order_id
    where o.id=new.order_id and o.payment_transaction_id=new.square_payment_id and ctx.dataset_id=analytics_source.dataset(o.created_at);
  if not found then return null; end if;
  select * into prev from public.analytics_fact_versions where dataset_id=c.dataset_id and fact_id='order:'||c.order_id
    order by revision desc limit 1;
  if found and (prev.fact->'payload'->>'totalCollectedCents')::bigint>0 then
    perform analytics_source.publish(c.dataset_id,'order',c.order_id,prev.effective_at,c.order_id,c.buyer_key,
       (prev.fact->'payload')||jsonb_build_object('paymentMethod',new.payment_method));
  end if;
  return null;
end;
$$;
create constraint trigger analytics_payment_method_changed after insert or update on public.payment_transactions
deferrable initially deferred for each row execute function analytics_source.payment_method_changed();

revoke all on all functions in schema analytics_source from public,anon,authenticated,service_role;
commit;
