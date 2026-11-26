-- No logins, project credentials, external connections or automatic dataset activation.
create role sole_analytics_staging_reader nologin;
create role sole_analytics_production_reader nologin;
create schema analytics_reporting;
revoke all on schema analytics_reporting from public, anon, authenticated, service_role;
grant usage on schema analytics_reporting to sole_analytics_staging_reader,sole_analytics_production_reader;

-- Fact recorded/effective time may be historical. Incremental sync follows local insertion.
alter table public.analytics_fact_versions add column export_updated_at timestamptz not null default clock_timestamp();
create index analytics_export_fact_updates on public.analytics_fact_versions(export_updated_at,dataset_id,fact_id);
create index analytics_export_revocations on public.analytics_consent_receipts(revoked_at,dataset_id,receipt_id) where revoked_at is not null;
create index analytics_export_receipt_orders on public.analytics_order_context(dataset_id,receipt_id) where receipt_id is not null;

create view analytics_reporting.eligible_datasets as
 select d.dataset_id,d.environment from public.analytics_datasets d
 where d.financial_source='warehouse' and d.schema_version=2 and d.activated_at<=statement_timestamp()
 and ((d.dataset_id='sole-staging' and d.environment='staging' and pg_has_role(current_user,'sole_analytics_staging_reader','member'))
   or (d.dataset_id='sole-production' and d.environment='production' and pg_has_role(current_user,'sole_analytics_production_reader','member')));

create view analytics_reporting.analytics_financial_export as
 select v.dataset_id,d.environment,v.fact_id,v.revision,v.kind,v.effective_at,v.recorded_at,v.fact->>'currency' currency,
   v.fact->>'orderId' order_id,v.fact->>'buyerKey' buyer_key,v.fact->'payload' payload,v.export_updated_at updated_at
 from public.analytics_fact_versions v join analytics_reporting.eligible_datasets d using(dataset_id)
 where not exists(select from public.analytics_fact_versions newer where newer.dataset_id=v.dataset_id and newer.fact_id=v.fact_id and newer.revision>v.revision);

-- Incremental connectors do not observe removed rows. Emit a keyed, cleared tombstone on revocation.
create view analytics_reporting.analytics_purchase_link_export as
 select c.dataset_id,c.order_id,true active,c.visitor_id,c.session_id,c.device,c.discovery,c.purchase_session,v.export_updated_at updated_at
 from public.analytics_order_context c join analytics_reporting.eligible_datasets d using(dataset_id)
 join public.analytics_fact_versions v on v.dataset_id=c.dataset_id and v.fact_id='order:'||c.order_id
 join public.analytics_consent_receipts r on r.dataset_id=c.dataset_id and r.receipt_id=c.receipt_id
 where v.kind='order' and v.revision=1 and r.granted_at<=v.effective_at and r.revoked_at is null
 union all
 select c.dataset_id,c.order_id,false,null::text,null::uuid,null::text,null::jsonb,null::jsonb,greatest(r.revoked_at,v.export_updated_at)
 from public.analytics_order_context c join analytics_reporting.eligible_datasets d using(dataset_id)
 join public.analytics_fact_versions v on v.dataset_id=c.dataset_id and v.fact_id='order:'||c.order_id
 join public.analytics_consent_receipts r on r.dataset_id=c.dataset_id and r.receipt_id=c.receipt_id
 where v.kind='order' and v.revision=1 and r.granted_at<=v.effective_at and r.revoked_at is not null;

-- Private destination for the optional, allowlisted PostHog SQL export. Provision destination
-- writers separately, scoped to this schema in a single environment, after owner capability checks.
create schema analytics_archive;
revoke all on schema analytics_archive from public,anon,authenticated,service_role;
create domain analytics_archive.dimension as text check(value ~ '^[a-z0-9][a-z0-9_-]{0,63}$' and value !~ '([a-z0-9]{24,}|token|secret|password|auth|session|key|([0-9][ _-]?){7})');
create domain analytics_archive.pathname as text check(value ~ '^(/|/(store|cart|checkout|hours|brands|contact|authenticity-guarantee|privacy|terms|refunds|shipping|legal/(privacy|terms|shipping|refunds))|/store/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$');
create table analytics_archive.analytics_behavior_archive(
 dataset_id text not null check(dataset_id in ('sole-staging','sole-production')),
 event_uuid uuid not null,event_name text not null check(event_name in ('public_page_viewed','storefront_viewed','product_viewed','product_added_to_cart','checkout_started')),
 occurred_at timestamptz not null, visitor_id text not null check(visitor_id ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|sole-buyer:v1:[0-9a-f]{64})$'),
 session_id uuid not null,pathname analytics_archive.pathname not null,device text check(device in ('desktop','mobile','tablet','unknown')),
 product_id uuid,variant_id uuid,landing_pathname analytics_archive.pathname,referrer_host text check(length(referrer_host)<=253 and referrer_host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' and referrer_host !~ '([a-z0-9]{24,}|token|secret|password|auth|session|key|([0-9][ _-]?){7})'),
 discovery_source analytics_archive.dimension,
 discovery_channel analytics_archive.dimension,
 discovery_campaign analytics_archive.dimension,
 discovery_placement analytics_archive.dimension,
 session_source analytics_archive.dimension,
 session_channel analytics_archive.dimension,
 session_campaign analytics_archive.dimension,
 session_placement analytics_archive.dimension,
 updated_at timestamptz not null default clock_timestamp(),
 check((event_name in ('product_added_to_cart','product_viewed'))=(product_id is not null)),
 check((event_name='product_added_to_cart')=(variant_id is not null)),
 check(event_name not in ('product_added_to_cart','product_viewed') or pathname='/store/'||product_id),
 check(event_name<>'checkout_started' or pathname='/checkout'),
 check(event_name<>'storefront_viewed' or pathname='/store')
);
create index analytics_archive_uuid on analytics_archive.analytics_behavior_archive(dataset_id,event_uuid,updated_at);
create index analytics_archive_updates on analytics_archive.analytics_behavior_archive(updated_at,dataset_id,event_uuid);
-- Native SQL exports append overlaps and backfills. First eligible observation wins for a UUID.
create view analytics_reporting.analytics_behavior_export as
 select distinct on (a.dataset_id,a.event_uuid) a.dataset_id,a.event_uuid,a.event_name,a.occurred_at,a.visitor_id,a.session_id,a.pathname,a.device,a.product_id,a.variant_id,a.landing_pathname,a.referrer_host,a.discovery_source,a.discovery_channel,a.discovery_campaign,a.discovery_placement,a.session_source,a.session_channel,a.session_campaign,a.session_placement,a.updated_at
 from analytics_archive.analytics_behavior_archive a join analytics_reporting.eligible_datasets d using(dataset_id)
 join public.analytics_datasets launch using(dataset_id)
 where a.occurred_at>=launch.activated_at order by a.dataset_id,a.event_uuid,a.updated_at;

revoke all on all tables in schema analytics_reporting,analytics_archive from public,anon,authenticated,service_role;
grant select on analytics_reporting.analytics_financial_export,analytics_reporting.analytics_purchase_link_export,analytics_reporting.analytics_behavior_export to sole_analytics_staging_reader,sole_analytics_production_reader;

create function public.analytics_reconciliation_source(p_dataset_id text,p_start timestamptz,p_end timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('revisions',count(*),'facts',count(distinct v.fact_id),
  'pending',count(*) filter(where q.status='pending'),'leased',count(*) filter(where q.status='leased'),
  'failed',count(*) filter(where q.status='failed'),'oldestOutstandingAt',min(v.export_updated_at) filter(where q.status is distinct from 'delivered'))
 from public.analytics_fact_versions v left join public.analytics_publication_outbox q using(dataset_id,fact_id,revision)
 where v.dataset_id=p_dataset_id and v.effective_at>=p_start and v.effective_at<p_end
$$;
revoke all on function public.analytics_reconciliation_source(text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.analytics_reconciliation_source(text,timestamptz,timestamptz) to service_role;

-- Measured coverage is owner-managed evidence, independent of query time and last activity.
create table analytics_reporting.verified_behavior_intervals(
 dataset_id text not null references public.analytics_datasets,source text not null check(source in ('native','archive')),
 start_at timestamptz not null,end_at timestamptz not null,verified_at timestamptz not null,
 primary key(dataset_id,source,start_at),check(start_at<end_at and end_at<=verified_at)
);
create table analytics_reporting.warehouse_observations(
 dataset_id text primary key references public.analytics_datasets,source_fresh_through timestamptz not null,
 observed_at timestamptz not null,check(source_fresh_through<=observed_at)
);
revoke all on analytics_reporting.verified_behavior_intervals,analytics_reporting.warehouse_observations from public,anon,authenticated,service_role,sole_analytics_staging_reader,sole_analytics_production_reader;

create function public.analytics_read_history_evidence(p_dataset_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('archive',coalesce(jsonb_agg(i.interval order by i.start_at) filter(where i.source='archive'),'[]'::jsonb),
 'native',coalesce(jsonb_agg(i.interval order by i.start_at) filter(where i.source='native'),'[]'::jsonb),
 'observation',(select jsonb_build_object('sourceFreshThrough',o.source_fresh_through,'observedAt',o.observed_at) from analytics_reporting.warehouse_observations o where o.dataset_id=p_dataset_id and o.observed_at<=statement_timestamp()))
 from (select source,start_at,jsonb_build_object('start',start_at,'end',end_at) as interval from analytics_reporting.verified_behavior_intervals
 where dataset_id=p_dataset_id and verified_at<=statement_timestamp()) i
$$;
revoke all on function public.analytics_read_history_evidence(text) from public,anon,authenticated;
grant execute on function public.analytics_read_history_evidence(text) to service_role;

-- One MVCC source snapshot. The independent total detects over-cap windows; callers may
-- narrow their date range but cannot declare a partial comparison matched.
create function public.analytics_reconciliation_snapshot(p_dataset_id text,p_start timestamptz,p_end timestamptz,p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 2000 or p_start is null or p_end is null or p_start>=p_end then
   raise exception 'Invalid reconciliation window' using errcode='22023';
 end if;
 if not exists(select from public.analytics_datasets d where d.dataset_id=p_dataset_id and d.dataset_id='sole-'||d.environment
   and d.financial_source='warehouse' and d.schema_version=2 and d.activated_at<=statement_timestamp()) then
   raise exception 'Reconciliation dataset unavailable' using errcode='22023';
 end if;
 return public.analytics_reconciliation_source(p_dataset_id,p_start,p_end) || jsonb_build_object(
 'publications',(select coalesce(jsonb_agg(jsonb_build_object('publicationId',s.id,'fact',s.fact) order by s.fact_id,s.revision),'[]'::jsonb)
 from (select q.id,v.fact,v.fact_id,v.revision from public.analytics_fact_versions v
 left join public.analytics_publication_outbox q using(dataset_id,fact_id,revision)
 where v.dataset_id=p_dataset_id and v.effective_at>=p_start and v.effective_at<p_end
 order by v.fact_id,v.revision limit p_limit) s));
end;
$$;
revoke all on function public.analytics_reconciliation_snapshot(text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.analytics_reconciliation_snapshot(text,timestamptz,timestamptz,integer) to service_role;
