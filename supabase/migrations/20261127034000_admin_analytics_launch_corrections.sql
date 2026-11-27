begin;

alter table analytics_reporting.native_probes
  add column if not exists retention_loss_through timestamptz;

-- Calendar-month subtraction clamps at short months. Carry the previous UTC
-- day's end so that the floor cannot move backward across a clamped midnight.
create or replace function analytics_reporting.native_rolling_floor(p_at timestamptz,p_months integer)
returns timestamptz language sql immutable strict set search_path='' as $$
  select greatest(
    p_at at time zone 'UTC' - make_interval(months=>p_months),
    date_trunc('day',p_at at time zone 'UTC') - interval '1 microsecond' - make_interval(months=>p_months)
  ) at time zone 'UTC';
$$;
revoke all on function analytics_reporting.native_rolling_floor(timestamptz,integer)
  from public,anon,authenticated,service_role,sole_analytics_staging_reader,sole_analytics_production_reader;

create or replace function public.analytics_record_native_retention(p_dataset_id text,p_months integer,p_retained_from date,p_verified_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_months not between 1 and 1200 or ((p_months is null) <> (p_retained_from is null))
    or p_verified_at is null or p_verified_at not between statement_timestamp()-interval '24 hours' and statement_timestamp()
  then raise exception 'Invalid native retention metadata' using errcode='22023'; end if;
  insert into analytics_reporting.native_probes as p (
    dataset_id,retention_months,retained_from,retention_verified_at,retention_loss_through
  ) values (
    p_dataset_id,p_months,p_retained_from,p_verified_at,
    analytics_reporting.native_rolling_floor(p_verified_at,p_months)
  )
  on conflict(dataset_id) do update set retention_months=excluded.retention_months,
    retained_from=greatest(p.retained_from,excluded.retained_from),
    retention_verified_at=excluded.retention_verified_at,
    -- Preserve both observed policies' loss. The former policy can prove loss
    -- only through its own verification window.
    retention_loss_through=greatest(p.retention_loss_through,excluded.retention_loss_through,
      analytics_reporting.native_rolling_floor(
        least(excluded.retention_verified_at,p.retention_verified_at+interval '24 hours'),p.retention_months))
  where p.retention_verified_at is null or p.retention_verified_at<=excluded.retention_verified_at;
  return found;
end $$;

create or replace function public.analytics_native_advance(p_dataset_id text,p_last_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from analytics_reporting.native_probes p
    where p.dataset_id=p_dataset_id and p.last_id=p_last_id
    and p.retention_verified_at between statement_timestamp()-interval '24 hours' and statement_timestamp()
    for update;
  if not found then return false; end if;
  return analytics_reporting.analytics_native_advance(p_dataset_id,p_last_id);
end $$;

create or replace function public.activate_analytics_dataset(p_environment text,p_at timestamptz,p_history_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_history_mode is null or p_history_mode not in ('native','archive') then
    raise exception 'History mode required' using errcode='22023';
  end if;
  if p_history_mode='native' and not exists(select from public.analytics_datasets where dataset_id='sole-'||p_environment)
    and not exists(select from analytics_reporting.native_probes p where p.dataset_id='sole-'||p_environment
      and p.first_id is not null and p.first_at between p_at-interval '10 minutes' and p_at
      and p.first_at>=statement_timestamp()-interval '10 minutes'
      and p.retention_verified_at between statement_timestamp()-interval '24 hours' and statement_timestamp()
      and p.first_at>=greatest(p.first_at,p.retained_from::timestamp at time zone 'UTC',p.retention_loss_through,
        analytics_reporting.native_rolling_floor(statement_timestamp(),p.retention_months)))
  then raise exception 'Native launch requires a verified opening receipt' using errcode='22023'; end if;
  return analytics_reporting.activate_analytics_dataset(p_environment,p_at);
end $$;

create or replace function public.analytics_read_history_evidence(p_dataset_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  with usable as (
    select i.source,case when i.source='archive' then i.start_at else greatest(i.start_at,
      p.retained_from::timestamp at time zone 'UTC',p.retention_loss_through,
      analytics_reporting.native_rolling_floor(statement_timestamp(),p.retention_months)) end as lo,i.end_at as hi
    from analytics_reporting.verified_behavior_intervals i
    left join analytics_reporting.native_probes p on p.dataset_id=i.dataset_id
    where i.dataset_id=p_dataset_id and i.verified_at<=statement_timestamp()
      and (i.source='archive' or p.retention_verified_at between statement_timestamp()-interval '24 hours' and statement_timestamp())
  )
  select jsonb_build_object(
    'archive',coalesce(jsonb_agg(jsonb_build_object('start',lo,'end',hi) order by lo) filter(where source='archive'),'[]'::jsonb),
    'native',coalesce(jsonb_agg(jsonb_build_object('start',lo,'end',hi) order by lo) filter(where source='native'),'[]'::jsonb),
    'observation',(select jsonb_build_object('sourceFreshThrough',o.source_fresh_through,'observedAt',o.observed_at)
      from analytics_reporting.warehouse_observations o where o.dataset_id=p_dataset_id and o.observed_at<=statement_timestamp()))
  from usable where lo<hi;
$$;

-- Read the canonical consent-gated projection and return only a boolean.
create or replace function public.analytics_has_active_journey_link(p_dataset_id text,p_order_id uuid,p_session_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select from analytics_reporting.source_links l join public.analytics_datasets d using(dataset_id)
    where d.dataset_id=p_dataset_id and d.dataset_id='sole-staging' and d.environment='staging'
      and d.schema_version=2 and d.financial_source='warehouse' and d.activated_at<=statement_timestamp()
      and l.order_id=p_order_id and l.session_id=p_session_id and l.active
  );
$$;
revoke all on function public.analytics_has_active_journey_link(text,uuid,uuid)
  from public,anon,authenticated,sole_analytics_staging_reader,sole_analytics_production_reader;
grant execute on function public.analytics_has_active_journey_link(text,uuid,uuid) to service_role;

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
end;
$$;

commit;
