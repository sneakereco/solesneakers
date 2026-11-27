begin;

-- The connector needs one row to materialize each table before dataset activation.
-- Persist the cursor once so incremental sync can pick up the metadata on retry.
create table analytics_source.reporting_schema_bootstrap (
  environment text primary key check (environment in ('staging', 'production')),
  initialized_at timestamptz not null default clock_timestamp()
);
alter table analytics_source.reporting_schema_bootstrap enable row level security;
revoke all on analytics_source.reporting_schema_bootstrap
  from public, anon, authenticated, service_role, sole_analytics_staging_reader, sole_analytics_production_reader;
insert into analytics_source.reporting_schema_bootstrap (environment) values ('staging'), ('production');

-- Reporting and reconciliation use the canonical sole-* dataset IDs. Reserve a
-- separate ID for each environment's schema metadata, outside application data.
create or replace view analytics_reporting.analytics_financial_export as
  select f.* from analytics_reporting.source_finance f join analytics_reporting.eligible_datasets d using (dataset_id)
  union all
  select '__analytics_schema_bootstrap_' || b.environment || '__', b.environment,
    '__schema_bootstrap__'::text, 1, '__schema_bootstrap__'::text,
    b.initialized_at, b.initialized_at, null::text, null::text, null::text, '{}'::jsonb, b.initialized_at
  from analytics_source.reporting_schema_bootstrap b
  where (b.environment = 'staging' and pg_has_role(current_user, 'sole_analytics_staging_reader', 'member'))
     or (b.environment = 'production' and pg_has_role(current_user, 'sole_analytics_production_reader', 'member'));

create or replace view analytics_reporting.analytics_purchase_link_export as
  select l.* from analytics_reporting.source_links l join analytics_reporting.eligible_datasets d using (dataset_id)
  union all
  select '__analytics_schema_bootstrap_' || b.environment || '__', '00000000-0000-0000-0000-000000000000'::uuid,
    false, null::text, null::uuid, null::text, null::jsonb, null::jsonb, b.initialized_at
  from analytics_source.reporting_schema_bootstrap b
  where (b.environment = 'staging' and pg_has_role(current_user, 'sole_analytics_staging_reader', 'member'))
     or (b.environment = 'production' and pg_has_role(current_user, 'sole_analytics_production_reader', 'member'));

-- A bootstrap identifier must never also identify an application dataset.
do $$
begin
  if exists (
    select 1 from public.analytics_datasets
    where dataset_id in ('__analytics_schema_bootstrap_staging__', '__analytics_schema_bootstrap_production__')
  ) then
    raise exception 'Analytics schema bootstrap identifier collides with a dataset';
  end if;
end $$;

commit;
