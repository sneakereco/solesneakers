begin;
alter table analytics_reporting.native_probes
  add column retention_months integer,
  add column retention_verified_at timestamptz,
  add column retained_from date;

alter function public.analytics_native_advance(text,uuid) set schema analytics_reporting;
revoke all on function analytics_reporting.analytics_native_advance(text,uuid) from public,anon,authenticated,service_role;
create function public.analytics_record_native_retention(p_dataset_id text,p_months integer,p_retained_from date,p_verified_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_months not between 1 and 1200 or ((p_months is null) <> (p_retained_from is null))
   or p_verified_at is null or p_verified_at not between statement_timestamp()-interval '24 hours' and statement_timestamp()
 then raise exception 'Invalid native retention metadata' using errcode='22023'; end if;
 insert into analytics_reporting.native_probes(dataset_id,retention_months,retained_from,retention_verified_at)
 values(p_dataset_id,p_months,p_retained_from,p_verified_at)
 on conflict(dataset_id) do update set retention_months=excluded.retention_months,
 retained_from=greatest(analytics_reporting.native_probes.retained_from,excluded.retained_from),
 retention_verified_at=excluded.retention_verified_at
 where analytics_reporting.native_probes.retention_verified_at is null
 or analytics_reporting.native_probes.retention_verified_at<=excluded.retention_verified_at;
 return found;
end $$;
revoke all on function public.analytics_record_native_retention(text,integer,date,timestamptz) from public,anon,authenticated;
grant execute on function public.analytics_record_native_retention(text,integer,date,timestamptz) to service_role;
create function public.analytics_native_advance(p_dataset_id text,p_last_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from analytics_reporting.native_probes where dataset_id=p_dataset_id and (retention_months is null or retention_months>=24)
    and retention_verified_at between statement_timestamp()-interval '24 hours' and statement_timestamp()) then return false; end if;
 return analytics_reporting.analytics_native_advance(p_dataset_id,p_last_id);
end $$;
revoke all on function public.analytics_native_advance(text,uuid) from public,anon,authenticated;
grant execute on function public.analytics_native_advance(text,uuid) to service_role;

alter function public.activate_analytics_dataset(text,timestamptz) set schema analytics_reporting;
revoke all on function analytics_reporting.activate_analytics_dataset(text,timestamptz) from public,anon,authenticated,service_role;
create function public.activate_analytics_dataset(p_environment text,p_at timestamptz,p_history_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_history_mode is null or p_history_mode not in ('native','archive') then
   raise exception 'History mode required' using errcode='22023';
 end if;
 if p_history_mode='native' and not exists(select from public.analytics_datasets where dataset_id='sole-'||p_environment)
   and not exists(select from analytics_reporting.native_probes where dataset_id='sole-'||p_environment
      and first_id is not null and first_at between p_at-interval '10 minutes' and p_at
      and first_at>=statement_timestamp()-interval '10 minutes'
      and (retention_months is null or retention_months>=24) and retention_verified_at>=statement_timestamp()-interval '24 hours')
 then raise exception 'Native launch requires a verified opening receipt' using errcode='22023'; end if;
 return analytics_reporting.activate_analytics_dataset(p_environment,p_at);
end $$;
revoke all on function public.activate_analytics_dataset(text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.activate_analytics_dataset(text,timestamptz,text) to service_role;

create or replace function public.analytics_read_history_evidence(p_dataset_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 with usable as (
   select i.source, case when i.source='archive' then i.start_at else greatest(i.start_at,
     statement_timestamp()-make_interval(months=>p.retention_months), p.retained_from::timestamp at time zone 'UTC') end as lo,i.end_at as hi
   from analytics_reporting.verified_behavior_intervals i
   left join analytics_reporting.native_probes p on p.dataset_id=i.dataset_id
   where i.dataset_id=p_dataset_id and i.verified_at<=statement_timestamp()
     and (i.source='archive' or ((p.retention_months is null or p.retention_months>=24)
       and p.retention_verified_at between statement_timestamp()-interval '24 hours' and statement_timestamp()))
 )
 select jsonb_build_object(
   'archive',coalesce(jsonb_agg(jsonb_build_object('start',lo,'end',hi) order by lo) filter(where source='archive'),'[]'::jsonb),
   'native',coalesce(jsonb_agg(jsonb_build_object('start',lo,'end',hi) order by lo) filter(where source='native'),'[]'::jsonb),
   'observation',(select jsonb_build_object('sourceFreshThrough',o.source_fresh_through,'observedAt',o.observed_at)
     from analytics_reporting.warehouse_observations o where o.dataset_id=p_dataset_id and o.observed_at<=statement_timestamp()))
 from usable where lo<hi;
$$;
commit;
