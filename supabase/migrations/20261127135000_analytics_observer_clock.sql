begin;

-- Take database time before the provider read so delayed observations cannot
-- overwrite newer retention evidence and client clock skew cannot invalidate it.
create function public.analytics_observer_clock(p_dataset_id text)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select case
    when p_dataset_id in ('sole-staging', 'sole-production') then pg_catalog.statement_timestamp()
  end;
$$;

revoke all on function public.analytics_observer_clock(text)
  from public, anon, authenticated, sole_analytics_staging_reader, sole_analytics_production_reader;
grant execute on function public.analytics_observer_clock(text) to service_role;

commit;
