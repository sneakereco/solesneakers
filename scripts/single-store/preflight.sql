-- Catalog-only half of the report. Run through preflight.mjs, which supplies
-- the explicit READ ONLY / REPEATABLE READ transaction and runs guarded,
-- aggregate-only business queries. No routine bodies or policy expressions
-- leave this query; they are used only to count possible dependencies.
WITH relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
         c.relowner, c.relacl, n.nspname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'storage', 'supabase_migrations')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), columns AS (
  SELECT r.nspname, r.relname, r.relkind, a.attname,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull
  FROM relations r
  JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
  WHERE a.attnum > 0 AND NOT a.attisdropped
), routines AS (
  SELECT p.oid, p.proowner, p.proacl, p.prosecdef, p.prorettype,
         pg_catalog.pg_get_functiondef(p.oid) ILIKE '%tenant%' AS tenant_dependent,
         EXISTS (SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%') AS configured_search_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
), policies AS (
  SELECT p.schemaname,
         concat_ws(' ', p.qual, p.with_check) ILIKE '%tenant%' AS tenant_dependent
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname IN ('public', 'storage')
), triggers AS (
  SELECT t.oid, coalesce(f.tenant_dependent, false) AS tenant_dependent,
         EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = t.tgrelid AND a.attname = 'tenant_id'
             AND a.attnum = ANY(t.tgattr::smallint[])
         ) AS tenant_column_updates
  FROM pg_catalog.pg_trigger t
  JOIN relations r ON r.oid = t.tgrelid AND r.nspname = 'public'
  LEFT JOIN routines f ON f.oid = t.tgfoid
  WHERE NOT t.tgisinternal
), application_roles AS (
  SELECT names.name, r.oid
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) names(name)
  LEFT JOIN pg_catalog.pg_roles r ON r.rolname = names.name
)
SELECT jsonb_build_object(
  'columns', (SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM columns c),
  'transaction', jsonb_build_object(
    'isolation', current_setting('transaction_isolation'),
    'readOnly', current_setting('transaction_read_only') = 'on',
    'statementTimeoutMs', extract(epoch FROM current_setting('statement_timeout')::interval) * 1000,
    'rowSecurity', current_setting('row_security')
  ),
  'dependencies', jsonb_build_object(
    'policies', jsonb_build_object(
      'public', (SELECT count(*) FROM policies WHERE schemaname = 'public'),
      'storage', (SELECT count(*) FROM policies WHERE schemaname = 'storage'),
      'tenantDependent', (SELECT count(*) FROM policies WHERE tenant_dependent)
    ),
    'routines', jsonb_build_object(
      'total', (SELECT count(*) FROM routines),
      'tenantDependent', (SELECT count(*) FROM routines WHERE tenant_dependent),
      'tenantDependentOrdinary', (SELECT count(*) FROM routines WHERE tenant_dependent AND prorettype <> 'pg_catalog.trigger'::regtype),
      'tenantDependentTriggerFunctions', (SELECT count(*) FROM routines WHERE tenant_dependent AND prorettype = 'pg_catalog.trigger'::regtype),
      'securityDefiner', (SELECT count(*) FROM routines WHERE prosecdef),
      'securityDefinerWithoutConfiguredSearchPath', (SELECT count(*) FROM routines WHERE prosecdef AND NOT configured_search_path)
    ),
    'triggers', jsonb_build_object(
      'total', (SELECT count(*) FROM triggers),
      'tenantDependentFunction', (SELECT count(*) FROM triggers WHERE tenant_dependent),
      'tenantColumnUpdates', (SELECT count(*) FROM triggers WHERE tenant_column_updates)
    ),
    'rowSecurity', jsonb_build_object(
      'publicTables', (SELECT count(*) FROM relations WHERE nspname = 'public' AND relkind IN ('r', 'p')),
      'enabledTables', (SELECT count(*) FROM relations WHERE nspname = 'public' AND relrowsecurity),
      'forcedTables', (SELECT count(*) FROM relations WHERE nspname = 'public' AND relforcerowsecurity)
    ),
    'acl', jsonb_build_object(
      'publicExecutableRoutines', (SELECT count(*) FROM routines p WHERE EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      )),
      'roles', (SELECT jsonb_agg(jsonb_build_object(
        'role', r.name, 'present', r.oid IS NOT NULL,
        'effectiveExecutableRoutines', (SELECT count(*) FROM routines f WHERE r.oid IS NOT NULL AND pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE')),
        'tenantDependentExecutableRoutines', (SELECT count(*) FROM routines f WHERE f.tenant_dependent AND r.oid IS NOT NULL AND pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE')),
        'effectiveSelectablePublicTables', (SELECT count(*) FROM relations t WHERE t.nspname = 'public' AND r.oid IS NOT NULL AND pg_catalog.has_table_privilege(r.oid, t.oid, 'SELECT')),
        'effectiveSelectableStorageTables', (SELECT count(*) FROM relations t WHERE t.nspname = 'storage' AND r.oid IS NOT NULL AND pg_catalog.has_table_privilege(r.oid, t.oid, 'SELECT'))
      ) ORDER BY r.name) FROM application_roles r)
    )
  )
) AS report;
