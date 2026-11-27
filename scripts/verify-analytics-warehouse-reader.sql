-- Read-only preflight. Run through psql as the proposed connector login, before exposing
-- a source. Exit 3 if its effective access exceeds the three reporting views.
\set ON_ERROR_STOP on
with actors as (
  -- SET can reach a NOINHERIT membership. Test every possible effective identity.
  select oid, rolname, rolsuper, rolbypassrls, rolcreatedb, rolreplication, rolcreaterole
  from pg_roles where pg_has_role(current_user,oid,'set')
), namespaces as (
  select oid, nspname from pg_namespace where nspname not in ('pg_catalog','information_schema')
    and nspname !~ '^pg_(toast|temp)'
), relations as (
  select c.oid, c.relkind, n.oid namespace,
    n.nspname='analytics_reporting' and c.relkind='v' and
    c.relname in ('analytics_financial_export','analytics_purchase_link_export','analytics_behavior_export') approved
  from pg_class c join namespaces n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','f','S')
), routines as (
  select p.oid,p.prorettype,n.oid namespace from pg_proc p join namespaces n on n.oid=p.pronamespace
  where p.prosecdef
), exposure as (
  select a.rolname,
    (select count(*) from relations r where r.approved and has_schema_privilege(a.oid,r.namespace,'usage')
      and has_table_privilege(a.oid,r.oid,'select')) as reporting_reads,
    (select count(*) from relations r where has_schema_privilege(a.oid,r.namespace,'usage') and (
      (r.relkind='S' and has_sequence_privilege(a.oid,r.oid,'usage,select,update')) or
      (r.relkind<>'S' and ((not r.approved and has_any_column_privilege(a.oid,r.oid,'select')) or
      has_any_column_privilege(a.oid,r.oid,'insert,update,references') or
      has_table_privilege(a.oid,r.oid,'delete,truncate,trigger,maintain'))))) as other_relation_rights,
    (select count(*) from routines p where has_schema_privilege(a.oid,p.namespace,'usage')
      and has_function_privilege(a.oid,p.oid,'execute') and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)) ordinary_definers,
    (select count(*) from routines p where has_schema_privilege(a.oid,p.namespace,'usage')
      and has_function_privilege(a.oid,p.oid,'execute') and p.prorettype='trigger'::regtype) trigger_definers,
    (select count(*) from routines p where has_schema_privilege(a.oid,p.namespace,'usage')
      and has_function_privilege(a.oid,p.oid,'execute') and p.prorettype='event_trigger'::regtype) event_definers,
    exists(select from pg_namespace n where n.nspname !~ '^pg_(toast_)?temp_' and has_schema_privilege(a.oid,n.oid,'create')) writable_schema,
    has_database_privilege(a.oid,current_database(),'create') db_create,
    has_database_privilege(a.oid,current_database(),'temp') db_temp,
    exists(select from pg_shdepend d where d.refclassid='pg_authid'::regclass and d.refobjid=a.oid and d.deptype='o'
      and d.dbid in (0,(select oid from pg_database where datname=current_database()))) owns_objects,
    (a.rolsuper or a.rolbypassrls or a.rolcreatedb or a.rolreplication or a.rolcreaterole
      or exists(select from pg_roles r where r.rolname ~ '^pg_' and pg_has_role(a.oid,r.oid,'usage'))) privileged,
    (pg_has_role(a.oid,'sole_analytics_staging_reader','member')::int +
      pg_has_role(a.oid,'sole_analytics_production_reader','member')::int) environments
  from actors a
), result as (
 select count(*) as reachable_roles,max(other_relation_rights) as other_rights,
   max(ordinary_definers) as ordinary_definers,max(trigger_definers) as trigger_definers,
   max(event_definers) as event_definers,bool_or(db_temp) as db_temp,bool_or(db_create) as db_create,
   bool_and(other_relation_rights=0 and ordinary_definers=0 and trigger_definers=0 and event_definers=0
     and not writable_schema and not owns_objects and not db_create and not privileged
     and environments<=1) and bool_or(rolname=current_user and reporting_reads=3 and environments=1)
     and not (pg_has_role(current_user,'sole_analytics_staging_reader','member') and
              pg_has_role(current_user,'sole_analytics_production_reader','member')) as eligible
 from exposure
)
select * from result
\gset audit_
\echo reachable_roles :audit_reachable_roles other_rights :audit_other_rights ordinary_definers :audit_ordinary_definers trigger_definers :audit_trigger_definers event_definers :audit_event_definers database_temp :audit_db_temp database_create :audit_db_create
\if :audit_eligible
\echo PASS warehouse reader access
\else
\echo UNAVAILABLE warehouse reader access exceeds the curated contract
-- ON_ERROR_STOP returns a nonzero psql status without changing database state.
do $gate$ begin raise exception 'Warehouse reader ineligible'; end $gate$;
\endif
