-- Minimized business observations have an independent lifetime from operational rows.
create extension if not exists pg_jsonschema with schema extensions;

create function public.analytics_valid_payload(p_kind text, p_payload jsonb)
returns boolean language sql immutable strict security definer set search_path = '' as $$
    with shape as (
      select case p_kind
        when 'order' then '{"grossMerchandiseCents":"money?","discountCents":"money?","merchandiseCents":"money?","shippingCents":"money?","taxCents":"money?","totalCollectedCents":"money","paymentMethod":"method?","fulfillment":"methodOfFulfillment?","status":"orderStatus"}'::jsonb
        when 'line' then '{"lineId":"id","productId":"id","variantId":"id?","productName":"label","brandId":"id?","brandLabel":"label?","categoryId":"id?","categoryLabel":"label?","sizeId":"id?","sizeLabel":"label?","quantity":"positive","unitGrossCents":"money?","discountCents":"money?","merchandiseCents":"money?","unitCostCents":"money?"}'::jsonb
        when 'refund' then '{"refundId":"id","status":"refundStatus","totalCents":"money","merchandiseCents":"money?","shippingCents":"money?","taxCents":"money?","unallocatedCents":"money"}'::jsonb
        when 'refund_line' then '{"refundId":"id","lineId":"id","merchandiseCents":"money?","quantity":"count?","restockedQuantity":"count?"}'::jsonb
        when 'payment_attempt' then '{"attemptId":"id","stage":"stage","outcome":"outcome","method":"method?","reason":"reason","resolvedAt":"timestamp?"}'::jsonb
        when 'shipping_cost' then '{"adjustment":"adjustment","amountCents":"money"}'::jsonb
        when 'fee' then '{"adjustment":"adjustment","amountCents":"money"}'::jsonb
        when 'fulfillment' then '{"method":"methodOfFulfillment","state":"fulfillmentState","paidAt":"timestamp?","fulfilledAt":"timestamp?"}'::jsonb
        when 'inventory' then '{"productId":"id","variantId":"id?","availableUnits":"count?"}'::jsonb
        when 'customer_summary' then '{"firstPurchaseAt":"timestamp","lastPurchaseAt":"timestamp","confirmedOrders":"positive","observedSpendCents":"money?"}'::jsonb
      end as fields
    ), compiled as (
      select jsonb_build_object(
        'type','object','required',jsonb_agg(key),'additionalProperties',false,
        'properties',jsonb_object_agg(key, case when right(value,1)='?' then
          jsonb_build_object('anyOf',jsonb_build_array(jsonb_build_object('type','null'),jsonb_build_object('$ref','#/definitions/'||rtrim(value,'?'))))
          else jsonb_build_object('$ref','#/definitions/'||value) end),
        'definitions',$definitions${
        "money":{"type":"integer","minimum":0,"maximum":9007199254740991},
        "positive":{"type":"integer","minimum":1,"maximum":9007199254740991},
        "count":{"$ref":"#/definitions/money"},
        "id":{"type":"string","format":"uuid","pattern":"^(?i:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$"},
        "timestamp":{"type":"string","format":"date-time"},
        "label":{"type":"string","maxLength":160,"pattern":"^[\\p{L}\\p{N}][\\p{L}\\p{N} .,'’&+()/#:!\"_\\-]*$","not":{"pattern":"[0-9](?:[ .()\\-]*[0-9]){8}|(?:[0-9]{1,3}\\.){3}[0-9]{1,3}|(?:[0-9A-Fa-f]{0,4}:){2,}|https?://"}},
        "method":{"enum":["card","applePay","googlePay","afterpay","cashAppPay","unknown"]},
        "orderStatus":{"enum":["pending","processing","paid","shipped","canceled","refunded","partially_refunded","refund_pending","refund_failed","failed","blocked","review"]},
        "methodOfFulfillment":{"enum":["ship","pickup"]},
        "refundStatus":{"enum":["pending","failed","canceled","completed"]},
        "stage":{"enum":["checkout","reservation","payment","verification"]},
        "outcome":{"enum":["pending","unknown","succeeded","failed","canceled","expired"]},
        "reason":{"enum":["none","unknown","declined","timeout","unavailable","invalid","inventory","expired","canceled","verification","blocked"]},
        "adjustment":{"enum":["charge","credit"]},
        "fulfillmentState":{"enum":["pending","processing","unfulfilled","ready","ready_for_pickup","shipped","delivered","picked_up","fulfilled","canceled","unknown"]}
        }$definitions$::jsonb) as schema
      from shape cross join lateral jsonb_each_text(fields)
      having count(*) > 0
    )
    select coalesce((select extensions.jsonb_matches_schema(schema::json,p_payload) from compiled),false);
$$;

create table public.analytics_datasets (
    dataset_id text primary key check (dataset_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    environment text not null check (environment in ('staging','production')),
    activated_at timestamptz not null,
    schema_version integer not null default 2 check(schema_version=2),
    financial_source text not null default 'warehouse' check(financial_source in ('events','warehouse')),
    behavior_archive_cutoff timestamptz
);

create table public.analytics_consent_receipts (
    dataset_id text not null references public.analytics_datasets,
    receipt_id uuid not null default gen_random_uuid(),
    granted_at timestamptz not null default now(),
    revoked_at timestamptz check (revoked_at >= granted_at),
    primary key(dataset_id,receipt_id)
);

create function public.analytics_valid_acquisition(p_dimensions jsonb)
returns boolean language sql immutable strict set search_path = '' as $$
  select case when jsonb_typeof(p_dimensions) <> 'object' then false else not exists (
    select 1 from jsonb_each(p_dimensions) where key not in ('source','channel','campaign','placement')
      or jsonb_typeof(value) <> 'string' or value #>> '{}' !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
      or value #>> '{}' ~ '([a-z0-9]{24,}|token|secret|password|auth|session|key)'
  ) end;
$$;

create function public.analytics_valid_lines(p_lines jsonb)
returns boolean language sql immutable strict set search_path = '' as $$
  select case when jsonb_typeof(p_lines) <> 'array' then false else not exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where not public.analytics_valid_payload('line',value)
  ) end;
$$;

create table public.analytics_order_context (
    dataset_id text not null references public.analytics_datasets,
    order_id uuid not null,
    buyer_key text check(buyer_key ~ '^sole-buyer:v1:[a-f0-9]{64}$'),
    line_snapshots jsonb not null check(public.analytics_valid_lines(line_snapshots)),
    receipt_id uuid, visitor_id text check(visitor_id ~ '^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|sole-buyer:v1:[a-f0-9]{64})$'), session_id uuid,
    device text check(device in ('desktop','mobile','tablet','unknown')),
    discovery jsonb check(public.analytics_valid_acquisition(discovery)),
    purchase_session jsonb check(public.analytics_valid_acquisition(purchase_session)),
    tracked_publication_id uuid not null default gen_random_uuid() unique,
    primary key(dataset_id,order_id),
    foreign key(dataset_id,receipt_id) references public.analytics_consent_receipts(dataset_id,receipt_id),
    check ((receipt_id is null and visitor_id is null and session_id is null and device is null and discovery is null and purchase_session is null)
      or (receipt_id is not null and visitor_id is not null and session_id is not null and device is not null))
);

create table public.analytics_fact_versions (
    dataset_id text not null references public.analytics_datasets,
    fact_id text not null,
    revision integer not null check (revision > 0),
    kind text not null,
    effective_at timestamptz not null,
    recorded_at timestamptz not null,
    fact jsonb not null,
    primary key(dataset_id,fact_id,revision)
);
create index analytics_fact_history_by_time on public.analytics_fact_versions(dataset_id,effective_at);

create table public.analytics_publication_outbox (
    id uuid primary key default gen_random_uuid(),
    dataset_id text not null, fact_id text not null, revision integer not null,
    unique(dataset_id,fact_id,revision),
    foreign key(dataset_id,fact_id,revision) references public.analytics_fact_versions,
    status text not null default 'pending' check(status in ('pending','leased','delivered','failed')),
    attempts integer not null default 0 check(attempts between 0 and 8),
    next_attempt_at timestamptz not null default now(),
    lease_token uuid, lease_expires_at timestamptz, delivered_at timestamptz,
    failure_category text check(failure_category in ('not-configured','redirect','unauthorized','not-found','timeout','network','rate-limited','provider-unavailable','invalid-response','provider-rejected','invalid-events','lease-exhausted')),
    check((status='leased')=(lease_token is not null) and (status='leased')=(lease_expires_at is not null)),
    check((status='delivered')=(delivered_at is not null))
);
create index analytics_pending_publications on public.analytics_publication_outbox(next_attempt_at,id) where status='pending';
create index analytics_expired_publications on public.analytics_publication_outbox(lease_expires_at,id) where status='leased';

-- Only this routine writes fact history. Business hooks call it inside their own transaction.
create function public.analytics_append_fact(p_fact jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
    ds text := p_fact->>'datasetId';
    fid text := p_fact->>'factId';
    rev integer;
    existing public.analytics_fact_versions%rowtype;
    publication uuid;
begin
    if p_fact is null or not extensions.jsonb_matches_schema('{
      "type":"object","additionalProperties":false,
      "required":["datasetId","factId","revision","kind","effectiveAt","recordedAt","currency","buyerKey","orderId","payload"],
      "properties":{
        "datasetId":{"type":"string","pattern":"^[a-z0-9][a-z0-9_-]{0,63}$"},
        "factId":{"type":"string","pattern":"^(?i:(?:[a-z][a-z_]{0,31}:)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$"},
        "revision":{"type":"integer","minimum":1,"maximum":2147483647},"kind":{"type":"string"},
        "effectiveAt":{"type":"string","format":"date-time"},"recordedAt":{"type":"string","format":"date-time"},
        "currency":{"const":"USD"},"buyerKey":{"type":["string","null"],"pattern":"^sole-buyer:v1:[a-f0-9]{64}$"},
        "orderId":{"type":["string","null"],"format":"uuid"},"payload":{"type":"object"}
      }}',p_fact) or not public.analytics_valid_payload(p_fact->>'kind',p_fact->'payload') then
      raise exception 'Invalid analytics fact' using errcode='23514';
    end if;

    rev := (p_fact->>'revision')::integer;
    -- Serializes concurrent writers for one logical fact, including its first revision.
    perform pg_advisory_xact_lock(hashtextextended(ds||':'||fid,0));
    select * into existing from public.analytics_fact_versions where dataset_id=ds and fact_id=fid and revision=rev;
    if found then
      if existing.fact <> p_fact then
        raise exception 'Conflicting analytics fact revision' using errcode='23505';
      end if;
      select id into strict publication from public.analytics_publication_outbox where dataset_id=ds and fact_id=fid and revision=rev;
      return publication;
    end if;
    select * into existing from public.analytics_fact_versions where dataset_id=ds and fact_id=fid order by revision desc limit 1;
    if found and (existing.kind <> p_fact->>'kind' or existing.effective_at <> (p_fact->>'effectiveAt')::timestamptz) then
      raise exception 'Changed analytics fact identity or effective time' using errcode='23514';
    end if;
    if not exists(select from public.analytics_datasets where dataset_id=ds and activated_at <= (p_fact->>'effectiveAt')::timestamptz) then
      raise exception 'Inactive analytics dataset' using errcode='23514';
    end if;
    insert into public.analytics_fact_versions(dataset_id,fact_id,revision,kind,effective_at,recorded_at,fact)
      values(ds,fid,rev,p_fact->>'kind',(p_fact->>'effectiveAt')::timestamptz,(p_fact->>'recordedAt')::timestamptz,p_fact);
    insert into public.analytics_publication_outbox(dataset_id,fact_id,revision) values(ds,fid,rev) returning id into publication;
    return publication;
end;
$$;

create function public.analytics_claim_publications(p_dataset_id text,p_limit integer,p_lease_seconds integer)
returns table(publication_id uuid,lease_token uuid,lease_expires_at timestamptz,attempt integer,environment text,fact jsonb)
language plpgsql security definer set search_path = '' as $$
begin
    if p_limit is null or p_limit not between 1 and 200 or p_lease_seconds is null or p_lease_seconds not between 1 and 300 then
      raise exception 'Invalid analytics claim bounds' using errcode='22023';
    end if;
    with expired as (
      select q.id from public.analytics_publication_outbox q where q.dataset_id=p_dataset_id and q.status='leased' and q.lease_expires_at<=statement_timestamp() and q.attempts=8
      order by q.lease_expires_at,q.id limit p_limit for update skip locked
    )
    update public.analytics_publication_outbox q set status='failed',failure_category='lease-exhausted',lease_token=null,lease_expires_at=null
      from expired where q.id=expired.id;
    return query
    with candidates as (
      select q.id from public.analytics_publication_outbox q
      where q.dataset_id=p_dataset_id and ((q.status='pending' and q.next_attempt_at<=statement_timestamp()) or
            (q.status='leased' and q.lease_expires_at<=statement_timestamp() and q.attempts<8))
      order by coalesce(q.lease_expires_at,q.next_attempt_at),q.id limit p_limit for update skip locked
    ), claimed as (
      update public.analytics_publication_outbox q set status='leased', attempts=q.attempts+1,
         lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
      from candidates c where q.id=c.id returning q.*
    )
    select c.id,c.lease_token,c.lease_expires_at,c.attempts,d.environment,v.fact from claimed c
      join public.analytics_fact_versions v using(dataset_id,fact_id,revision)
      join public.analytics_datasets d using(dataset_id);
end;
$$;

create function public.analytics_complete_publication(p_dataset_id text,p_id uuid,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
    update public.analytics_publication_outbox set status='delivered',delivered_at=clock_timestamp(),failure_category=null,lease_token=null,lease_expires_at=null
    where dataset_id=p_dataset_id and id=p_id and status='leased' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
    return found;
end;
$$;

create function public.analytics_fail_publication(p_dataset_id text,p_id uuid,p_lease_token uuid,p_category text,p_terminal boolean,p_retry_after_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
    if p_terminal is null or p_category is null or p_retry_after_seconds is null or p_retry_after_seconds not between 0 and 3600 then
      raise exception 'Invalid analytics failure' using errcode='22023';
    end if;
    update public.analytics_publication_outbox set
      status=case when p_terminal or attempts>=8 then 'failed' else 'pending' end,
      next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(p_retry_after_seconds,ceil((2^attempts)*(1+random()))::integer)),
      failure_category=p_category,lease_token=null,lease_expires_at=null
    where dataset_id=p_dataset_id and id=p_id and status='leased' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
    return found;
end;
$$;

create function public.analytics_revoke_receipt(p_dataset_id text,p_receipt_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
    update public.analytics_consent_receipts set revoked_at=clock_timestamp()
      where dataset_id=p_dataset_id and receipt_id=p_receipt_id and revoked_at is null;
    return found;
end;
$$;

-- Supabase may have permissive default ACLs. Establish the full access boundary here.
alter table public.analytics_datasets enable row level security;
alter table public.analytics_consent_receipts enable row level security;
alter table public.analytics_order_context enable row level security;
alter table public.analytics_fact_versions enable row level security;
alter table public.analytics_publication_outbox enable row level security;
revoke all on table public.analytics_datasets,public.analytics_consent_receipts,public.analytics_order_context,public.analytics_fact_versions,public.analytics_publication_outbox from public,anon,authenticated,service_role;
grant select on public.analytics_datasets,public.analytics_consent_receipts,public.analytics_order_context,public.analytics_fact_versions,public.analytics_publication_outbox to service_role;
grant insert on public.analytics_order_context to service_role;
grant insert(dataset_id) on public.analytics_consent_receipts to service_role;

revoke all on function public.analytics_valid_payload(text,jsonb) from public,anon,authenticated;
grant execute on function public.analytics_valid_payload(text,jsonb) to service_role;
revoke all on function public.analytics_valid_lines(jsonb) from public,anon,authenticated;
grant execute on function public.analytics_valid_lines(jsonb) to service_role;
revoke all on function public.analytics_valid_acquisition(jsonb) from public,anon,authenticated;
grant execute on function public.analytics_valid_acquisition(jsonb) to service_role;
revoke all on function public.analytics_append_fact(jsonb) from public,anon,authenticated;
grant execute on function public.analytics_append_fact(jsonb) to service_role;
revoke all on function public.analytics_claim_publications(text,integer,integer) from public,anon,authenticated;
grant execute on function public.analytics_claim_publications(text,integer,integer) to service_role;
revoke all on function public.analytics_complete_publication(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.analytics_complete_publication(text,uuid,uuid) to service_role;
revoke all on function public.analytics_fail_publication(text,uuid,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.analytics_fail_publication(text,uuid,uuid,text,boolean,integer) to service_role;
revoke all on function public.analytics_revoke_receipt(text,uuid) from public,anon,authenticated;
grant execute on function public.analytics_revoke_receipt(text,uuid) to service_role;
