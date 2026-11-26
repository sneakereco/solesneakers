-- Read-only preflight. Run through psql as the proposed connector login, before exposing
-- a source. Exit 3 if its effective access exceeds the three reporting views.
\set ON_ERROR_STOP on
with surfaces as (
 select c.oid,c.relname,n.nspname,
   n.nspname='analytics_reporting' and c.relname in ('analytics_financial_export','analytics_purchase_link_export','analytics_behavior_export') approved
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
 and c.relkind in ('r','p','v','m','f') and has_schema_privilege(n.oid,'usage')
), effective as (
 select (select count(*) from surfaces where approved and has_table_privilege(oid,'select')) as reporting_reads,
 (select count(*) from surfaces where not approved and has_any_column_privilege(oid,'select')) as other_reads,
 (select count(*) from surfaces where has_any_column_privilege(oid,'insert,update,references') or has_table_privilege(oid,'delete,truncate,trigger')) as writes,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname not in ('pg_catalog','information_schema') and p.prosecdef and has_schema_privilege(n.oid,'usage') and has_function_privilege(p.oid,'execute')) as privileged_routines,
 (select count(*) from pg_namespace n where n.nspname not like 'pg_temp_%' and has_schema_privilege(n.oid,'create')) as writable_schemas,
 (select count(*) from pg_roles r where pg_has_role(current_user,r.oid,'member') and (r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolreplication or r.rolcreaterole or r.rolname in ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program','pg_monitor'))) as privileged_roles,
 (pg_has_role(current_user,'sole_analytics_staging_reader','member')::int + pg_has_role(current_user,'sole_analytics_production_reader','member')::int) as environments
)
select *, reporting_reads=3 and other_reads=0 and writes=0 and privileged_routines=0 and writable_schemas=0 and privileged_roles=0 and environments=1 as eligible from effective
\gset audit_
\echo reporting_reads :audit_reporting_reads other_reads :audit_other_reads writes :audit_writes privileged_routines :audit_privileged_routines writable_schemas :audit_writable_schemas privileged_roles :audit_privileged_roles environments :audit_environments
\if :audit_eligible
\echo PASS warehouse reader access
\else
\echo UNAVAILABLE warehouse reader access exceeds the curated contract
-- ON_ERROR_STOP returns a nonzero psql status without changing database state.
do $gate$ begin raise exception 'Warehouse reader ineligible'; end $gate$;
\endif
