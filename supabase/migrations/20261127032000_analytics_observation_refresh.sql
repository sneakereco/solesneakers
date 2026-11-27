begin;
-- The connector and the independent observer share the projection. Only the three
-- existing environment-filtered views carry reader grants.
create view analytics_reporting.source_finance as
 select v.dataset_id,d.environment,v.fact_id,v.revision,v.kind,v.effective_at,v.recorded_at,v.fact->>'currency' currency,
   v.fact->>'orderId' order_id,v.fact->>'buyerKey' buyer_key,v.fact->'payload' payload,v.export_updated_at updated_at
 from public.analytics_fact_versions v join public.analytics_datasets d using(dataset_id)
 where not exists(select from public.analytics_fact_versions newer where newer.dataset_id=v.dataset_id and newer.fact_id=v.fact_id and newer.revision>v.revision);

-- Incremental connectors do not observe removed rows. Emit a keyed, cleared tombstone on revocation.
create view analytics_reporting.source_links as
 select c.dataset_id,c.order_id,true active,c.visitor_id,c.session_id,c.device,c.discovery,c.purchase_session,v.export_updated_at updated_at
 from public.analytics_order_context c join public.analytics_datasets d using(dataset_id)
 join public.analytics_fact_versions v on v.dataset_id=c.dataset_id and v.fact_id='order:'||c.order_id
 join public.analytics_consent_receipts r on r.dataset_id=c.dataset_id and r.receipt_id=c.receipt_id
 where v.kind='order' and v.revision=1 and r.granted_at<=v.effective_at and r.revoked_at is null
 union all
 select c.dataset_id,c.order_id,false,null::text,null::uuid,null::text,null::jsonb,null::jsonb,greatest(r.revoked_at,v.export_updated_at)
 from public.analytics_order_context c join public.analytics_datasets d using(dataset_id)
 join public.analytics_fact_versions v on v.dataset_id=c.dataset_id and v.fact_id='order:'||c.order_id
 join public.analytics_consent_receipts r on r.dataset_id=c.dataset_id and r.receipt_id=c.receipt_id
 where v.kind='order' and v.revision=1 and r.granted_at<=v.effective_at and r.revoked_at is not null;


revoke all on analytics_reporting.source_finance,analytics_reporting.source_links from public,anon,authenticated,service_role,sole_analytics_staging_reader,sole_analytics_production_reader;
create or replace view analytics_reporting.analytics_financial_export as
 select f.* from analytics_reporting.source_finance f join analytics_reporting.eligible_datasets d using(dataset_id);
create or replace view analytics_reporting.analytics_purchase_link_export as
 select l.* from analytics_reporting.source_links l join analytics_reporting.eligible_datasets d using(dataset_id);

-- Depth-first work requires at most 15 siblings per level. No business transaction
-- reads or updates these rows. A lease identifies one immutable requested partition.
create table analytics_reporting.refresh_progress(
 dataset_id text primary key references public.analytics_datasets,
 pending text[] not null default array[''], cutoff timestamptz,
 token uuid, expires timestamptz);
revoke all on analytics_reporting.refresh_progress from public,anon,authenticated,service_role,sole_analytics_staging_reader,sole_analytics_production_reader;

create function public.analytics_refresh_claim(p_dataset_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job analytics_reporting.refresh_progress%rowtype;
begin
 if not exists(select 1 from public.analytics_datasets where dataset_id=p_dataset_id and dataset_id='sole-'||environment and financial_source='warehouse' and activated_at<=statement_timestamp())
 then raise exception 'Unavailable dataset'; end if;
 insert into analytics_reporting.refresh_progress(dataset_id) values(p_dataset_id) on conflict do nothing;
 update analytics_reporting.refresh_progress set token=gen_random_uuid(),expires=statement_timestamp()+interval '30 seconds'
 where dataset_id=p_dataset_id and (expires is null or expires<=statement_timestamp()) returning * into job;
 if not found then return null; end if;
 return jsonb_build_object('token',job.token,'prefix',job.pending[1],'cutoff',job.cutoff);
end $$;

create function public.analytics_refresh_snapshot(p_dataset_id text,p_token uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('observedAt',statement_timestamp(),'finance',(
   select coalesce(jsonb_agg(to_jsonb(f) order by fact_id),'[]') from
    (select * from analytics_reporting.source_finance where dataset_id=p_dataset_id and md5(fact_id) like job.pending[1]||'%' order by fact_id limit 501) f),
   'links',(
   select coalesce(jsonb_agg(to_jsonb(l) order by order_id),'[]') from
    (select * from analytics_reporting.source_links where dataset_id=p_dataset_id and md5(order_id::text) like job.pending[1]||'%' order by order_id limit 501) l))
 from analytics_reporting.refresh_progress job where dataset_id=p_dataset_id and token=p_token and expires>statement_timestamp()
$$;
create function public.analytics_refresh_finish(p_dataset_id text,p_token uuid,p_result text,p_observed_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare job analytics_reporting.refresh_progress%rowtype; todo text[];
begin
 select * into job from analytics_reporting.refresh_progress where dataset_id=p_dataset_id and token=p_token and expires>statement_timestamp() for update;
 if not found then return false; end if;
 todo:=job.pending[2:];
 if p_result='split' and length(job.pending[1])<32 then
   select array_agg(job.pending[1]||n order by n)||todo into todo from unnest(string_to_array('0123456789abcdef',null)) n;
 elsif p_result='retry' then todo:=job.pending;
 elsif p_result is distinct from 'matched' then raise exception 'Invalid partition result'; end if;
 if p_result='matched' then
   if p_observed_at is null or p_observed_at<job.expires-interval '30 seconds' or p_observed_at>statement_timestamp() then raise exception 'Invalid source instant'; end if;
   job.cutoff:=least(job.cutoff,p_observed_at);
 end if;
 if cardinality(todo)=0 then
   insert into analytics_reporting.warehouse_observations values(p_dataset_id,job.cutoff,statement_timestamp())
    on conflict(dataset_id) do update set source_fresh_through=greatest(analytics_reporting.warehouse_observations.source_fresh_through,excluded.source_fresh_through),observed_at=excluded.observed_at;
   delete from analytics_reporting.refresh_progress where dataset_id=p_dataset_id;
 else
   update analytics_reporting.refresh_progress set pending=todo,cutoff=job.cutoff,token=null,expires=null where dataset_id=p_dataset_id;
 end if;
 return true;
end $$;
revoke all on function public.analytics_refresh_claim(text), public.analytics_refresh_snapshot(text,uuid),
 public.analytics_refresh_finish(text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.analytics_refresh_claim(text), public.analytics_refresh_snapshot(text,uuid),
 public.analytics_refresh_finish(text,uuid,text,timestamptz) to service_role;

-- Two independently allocated server receipts. An unsuccessful probe is retried
-- with its original UUID/time. A long outage leaves a gap, never a future interval.
create table analytics_reporting.native_probes (
 dataset_id text primary key check(dataset_id in ('sole-staging','sole-production')),
 first_id uuid,first_at timestamptz,last_id uuid,last_at timestamptz);
revoke all on analytics_reporting.native_probes from public,anon,authenticated,service_role,sole_analytics_staging_reader,sole_analytics_production_reader;
create function public.analytics_native_probe(p_dataset_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p analytics_reporting.native_probes%rowtype;
begin
 insert into analytics_reporting.native_probes(dataset_id,last_id,last_at)
 values(p_dataset_id,gen_random_uuid(),statement_timestamp()) on conflict(dataset_id) do update
 set last_id=excluded.last_id,last_at=excluded.last_at
 where analytics_reporting.native_probes.last_id is null or analytics_reporting.native_probes.last_at<statement_timestamp()-interval '10 minutes';
 select * into strict p from analytics_reporting.native_probes where dataset_id=p_dataset_id;
 return to_jsonb(p);
end $$;
create function public.analytics_native_advance(p_dataset_id text,p_last_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare p analytics_reporting.native_probes%rowtype; launch timestamptz; lo timestamptz; prior_start timestamptz;
begin
 select * into p from analytics_reporting.native_probes where dataset_id=p_dataset_id and last_id=p_last_id for update;
 if not found then return false; end if;
 select activated_at into launch from public.analytics_datasets where dataset_id=p_dataset_id and environment=substring(p_dataset_id from 6) and financial_source='warehouse';
 lo:=greatest(launch,p.first_at);
 if p.first_at is not null and launch is not null and lo<p.last_at and p.last_at-p.first_at<=interval '10 minutes' then
   select start_at into prior_start from analytics_reporting.verified_behavior_intervals
     where dataset_id=p_dataset_id and source='native' and end_at=lo order by start_at limit 1 for update;
   if found then update analytics_reporting.verified_behavior_intervals set end_at=p.last_at,verified_at=statement_timestamp()
     where dataset_id=p_dataset_id and source='native' and start_at=prior_start;
   else insert into analytics_reporting.verified_behavior_intervals values(p_dataset_id,'native',lo,p.last_at,statement_timestamp()); end if;
 end if;
 update analytics_reporting.native_probes set first_id=last_id,first_at=last_at,last_id=null,last_at=null
   where dataset_id=p_dataset_id;
 return true;
end $$;
revoke all on function public.analytics_native_probe(text),public.analytics_native_advance(text,uuid) from public,anon,authenticated;
grant execute on function public.analytics_native_probe(text),public.analytics_native_advance(text,uuid) to service_role;
commit;
