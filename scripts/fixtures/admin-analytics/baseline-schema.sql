--
-- PostgreSQL database dump
--

\restrict SoleAnalyticsLocalSchemaOnly

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS extensions;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
    revoke trigger on cron.job_run_details from postgres;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
    ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

    ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
    ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

    REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: accept_tag_candidate(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_tag_candidate(candidate_id uuid, accepted_label text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  candidate public.tag_candidates%rowtype;
  target_id uuid;
begin
  select * into candidate
  from public.tag_candidates
  where id = candidate_id
  for update;

  if not found or candidate.status <> 'new' then
    raise exception 'Candidate is not available';
  end if;
  if not public.is_admin_for_tenant(candidate.tenant_id) then
    raise exception 'Not authorized';
  end if;
  if length(trim(accepted_label)) = 0 then
    raise exception 'Canonical label is required';
  end if;

  if candidate.entity_type = 'brand' then
    select id into target_id from public.tag_brands
    where tenant_id = candidate.tenant_id and lower(canonical_label) = lower(trim(accepted_label));
    if target_id is null then
      insert into public.tag_brands (tenant_id, canonical_label)
      values (candidate.tenant_id, trim(accepted_label)) returning id into target_id;
    end if;
    if not exists (
      select 1 from public.tag_aliases
      where tenant_id = candidate.tenant_id and entity_type = 'brand' and alias_normalized = candidate.normalized_text
    ) then
      insert into public.tag_aliases (tenant_id, entity_type, brand_id, alias_label, alias_normalized)
      values (candidate.tenant_id, 'brand', target_id, candidate.raw_text, candidate.normalized_text);
    end if;
  else
    select id into target_id from public.tag_models
    where tenant_id = candidate.tenant_id
      and brand_id = candidate.parent_brand_id
      and lower(canonical_label) = lower(trim(accepted_label));
    if target_id is null then
      insert into public.tag_models (tenant_id, brand_id, canonical_label)
      values (candidate.tenant_id, candidate.parent_brand_id, trim(accepted_label)) returning id into target_id;
    end if;
    if not exists (
      select 1 from public.tag_aliases
      where tenant_id = candidate.tenant_id and entity_type = 'model' and alias_normalized = candidate.normalized_text
    ) then
      insert into public.tag_aliases (tenant_id, entity_type, model_id, alias_label, alias_normalized)
      values (candidate.tenant_id, 'model', target_id, candidate.raw_text, candidate.normalized_text);
    end if;
  end if;

  update public.tag_candidates set status = 'accepted' where id = candidate.id;
  return jsonb_build_object('entityType', candidate.entity_type, 'targetId', target_id);
end;
$$;


--
-- Name: attach_square_checkout_order(uuid, text, integer, integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_square_checkout_order(p_order_id uuid, p_square_order_id text, p_square_order_version integer, p_shipping_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_calculation_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_updated integer;
begin
  if nullif(trim(p_square_order_id), '') is null
    or p_square_order_version < 0
    or p_shipping_cents < 0
    or p_tax_cents < 0
    or p_total_cents <= 0
    or nullif(trim(p_tax_calculation_id), '') is null
    or p_tax_calculation_id not like 'square:%'
  then
    raise exception 'invalid_square_checkout_order';
  end if;

  update public.orders
  set
    square_order_id = p_square_order_id,
    square_order_version = p_square_order_version,
    shipping = p_shipping_cents::numeric / 100,
    tax_amount = p_tax_cents::numeric / 100,
    total = p_total_cents::numeric / 100,
    tax_calculation_id = p_tax_calculation_id,
    checkout_protection_evidence = coalesce(checkout_protection_evidence, '{}'::jsonb)
      || jsonb_build_object(
        'tax_calculation_id', p_tax_calculation_id,
        'square_order_id', p_square_order_id,
        'square_order_version', p_square_order_version,
        'square_tax_cents', p_tax_cents,
        'square_total_cents', p_total_cents
      ),
    updated_at = now()
  where id = p_order_id
    and status = 'pending'
    and expires_at > now()
    and round(subtotal * 100)::integer + p_shipping_cents + p_tax_cents = p_total_cents
    and round(shipping * 100)::integer = p_shipping_cents
    and (square_order_id is null or square_order_id = p_square_order_id);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


--
-- Name: attach_square_payment_link(uuid, text, text, text, integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_square_payment_link(p_order_id uuid, p_square_payment_link_id text, p_square_order_id text, p_square_payment_link_url text, p_shipping_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_calculation_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_updated integer;
begin
  if p_shipping_cents < 0
    or p_tax_cents < 0
    or p_total_cents <= 0
    or nullif(trim(p_tax_calculation_id), '') is null
    or p_tax_calculation_id not like 'square:%'
  then
    raise exception 'invalid_square_checkout_totals';
  end if;

  update public.orders
  set
    square_payment_link_id = p_square_payment_link_id,
    square_order_id = p_square_order_id,
    square_payment_link_url = p_square_payment_link_url,
    square_payment_link_deleted_at = null,
    shipping = p_shipping_cents::numeric / 100,
    tax_amount = p_tax_cents::numeric / 100,
    total = p_total_cents::numeric / 100,
    tax_calculation_id = p_tax_calculation_id,
    checkout_protection_evidence = coalesce(checkout_protection_evidence, '{}'::jsonb)
      || jsonb_build_object(
        'tax_calculation_id', p_tax_calculation_id,
        'square_order_id', p_square_order_id,
        'square_tax_cents', p_tax_cents,
        'square_total_cents', p_total_cents
      ),
    updated_at = now()
  where id = p_order_id
    and status = 'pending'
    and expires_at > now()
    and round(subtotal * 100)::integer + p_shipping_cents + p_tax_cents = p_total_cents
    and round(shipping * 100)::integer = p_shipping_cents
    and (
      square_payment_link_id is null
      or square_payment_link_id = p_square_payment_link_id
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


--
-- Name: block_privileged_field_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_privileged_field_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  acting_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  select role into acting_role
  from public.profiles
  where id = auth.uid();

  if acting_role in ('admin', 'super_admin', 'dev') then
    return new;
  end if;

  if new.role <> old.role then
    raise exception 'Cannot modify role';
  end if;

  if new.totp_secret <> old.totp_secret then
    raise exception 'Cannot modify totp_secret';
  end if;

  if new.twofa_enabled <> old.twofa_enabled then
    raise exception 'Cannot modify twofa_enabled';
  end if;

  if new.is_primary_admin <> old.is_primary_admin then
    raise exception 'Cannot modify is_primary_admin';
  end if;

  return new;
end;
$$;


--
-- Name: claim_checkout_notifications(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_checkout_notifications(p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  with candidates as (
    select id
    from public.checkout_notification_outbox
    where (
      status in ('pending', 'failed') and next_attempt_at <= now()
    ) or (
      status = 'processing' and updated_at <= now() - interval '10 minutes'
    )
    order by created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ), claimed as (
    update public.checkout_notification_outbox as notification
    set status = 'processing', attempts = attempts + 1, updated_at = now()
    from candidates
    where notification.id = candidates.id
    returning notification.id, notification.order_id, notification.kind,
      notification.payload
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', id,
      'orderId', order_id,
      'kind', kind,
      'payload', payload
    )),
    '[]'::jsonb
  ) into v_result
  from claimed;

  return v_result;
end;
$$;


--
-- Name: claim_checkout_notifications_for_order(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_checkout_notifications_for_order(p_order_id uuid, p_limit integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  with candidates as (
    select id
    from public.checkout_notification_outbox
    where order_id = p_order_id
      and (
        (status in ('pending', 'failed') and next_attempt_at <= now())
        or (status = 'processing' and updated_at <= now() - interval '10 minutes')
      )
    order by created_at, id
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  ), claimed as (
    update public.checkout_notification_outbox as notification
    set status = 'processing', attempts = attempts + 1, updated_at = now()
    from candidates
    where notification.id = candidates.id
    returning notification.id, notification.order_id, notification.kind,
      notification.payload
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', id,
      'orderId', order_id,
      'kind', kind,
      'payload', payload
    )),
    '[]'::jsonb
  ) into v_result
  from claimed;

  return v_result;
end;
$$;


--
-- Name: consume_square_checkout_reservation(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_square_checkout_reservation(p_order_id uuid, p_square_payment_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders%rowtype;
  v_active_count integer;
  v_released_count integer;
begin
  select orders.*
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if v_order.status = 'paid'
    and v_order.payment_transaction_id = p_square_payment_id
  then
    return true;
  end if;

  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'released')
  into v_active_count, v_released_count
  from public.inventory_reservations
  where order_id = p_order_id;

  if v_active_count = 0
    or v_released_count > 0
    or v_order.expires_at is null
    or v_order.expires_at <= now()
  then
    update public.orders
    set status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'late_or_released_square_payment',
      updated_at = now()
    where id = p_order_id;
    return false;
  end if;

  update public.inventory_reservations
  set
    status = 'consumed',
    consumed_at = now(),
    updated_at = now()
  where order_id = p_order_id
    and status = 'active';

  update public.orders
  set
    status = 'paid',
    payment_transaction_id = p_square_payment_id,
    failure_reason = null,
    updated_at = now()
  where id = p_order_id;

  return true;
end;
$$;


--
-- Name: consume_square_checkout_reservation(uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_square_checkout_reservation(p_order_id uuid, p_square_payment_id text, p_paid_at timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders%rowtype;
  v_active_count integer;
  v_released_count integer;
begin
  select orders.*
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if v_order.status = 'paid'
    and v_order.payment_transaction_id = p_square_payment_id
  then
    return true;
  end if;

  select
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'released')
  into v_active_count, v_released_count
  from public.inventory_reservations
  where order_id = p_order_id;

  if v_active_count = 0
    or v_released_count > 0
    or v_order.expires_at is null
    or v_order.expires_at <= coalesce(p_paid_at, now())
  then
    update public.orders
    set status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'late_or_released_square_payment',
      updated_at = now()
    where id = p_order_id;
    return false;
  end if;

  update public.inventory_reservations
  set
    status = 'consumed',
    consumed_at = now(),
    updated_at = now()
  where order_id = p_order_id
    and status = 'active';

  update public.orders
  set
    status = 'paid',
    payment_transaction_id = p_square_payment_id,
    failure_reason = null,
    updated_at = now()
  where id = p_order_id;

  return true;
end;
$$;


--
-- Name: decrement_variant_stock(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_variant_stock(p_variant_id uuid, p_quantity integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE product_variants
  SET stock = stock - p_quantity
  WHERE id = p_variant_id
  AND stock >= p_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient stock for variant %', p_variant_id;
  END IF;
END;
$$;


--
-- Name: enforce_single_shipping_origin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_single_shipping_origin() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (SELECT count(*) FROM public.shipping_origins) > 1 THEN
    RAISE EXCEPTION 'Only one shipping origin is allowed.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: finish_checkout_notification(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_checkout_notification(p_notification_id uuid, p_succeeded boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_updated integer;
begin
  update public.checkout_notification_outbox
  set
    status = case when p_succeeded then 'sent' else 'failed' end,
    next_attempt_at = case
      when p_succeeded then next_attempt_at
      else now() + make_interval(mins => least(greatest(attempts, 1) * 5, 60))
    end,
    updated_at = now()
  where id = p_notification_id and status = 'processing';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


--
-- Name: increment_variant_stock(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_variant_stock(p_variant_id uuid, p_quantity integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Increment quantity must be positive';
  END IF;

  UPDATE product_variants
  SET stock = stock + p_quantity
  WHERE id = p_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', p_variant_id;
  END IF;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin', 'dev')
  );
$$;


--
-- Name: is_admin_for_tenant(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_for_tenant(target_tenant uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin', 'dev')
      and p.tenant_id = target_tenant
  );
$$;


--
-- Name: is_dev(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_dev() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'dev'
  );
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('super_admin', 'dev')
  );
$$;


--
-- Name: mark_order_paid_and_decrement(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_order_paid_and_decrement(p_order_id uuid, p_payment_transaction_id text, p_items jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
  v_order_updated integer;
  v_expected integer;
  v_updated integer;
begin
  update public.orders
  set
    status = 'paid',
    payment_transaction_id = p_payment_transaction_id,
    failure_reason = null
  where id = p_order_id
    and status in ('pending', 'processing', 'failed')
  returning 1 into v_order_updated;

  if v_order_updated is null then
    return false;
  end if;

  with raw_items as (
    select
      (item->>'variant_id')::uuid as variant_id,
      (item->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where (item->>'variant_id') is not null
  ),
  aggregated_items as (
    select variant_id, sum(quantity) as quantity
    from raw_items
    where quantity > 0
    group by variant_id
  ),
  updated_variants as (
    update public.product_variants product_variant
    set stock = product_variant.stock - aggregated_items.quantity
    from aggregated_items
    where product_variant.id = aggregated_items.variant_id
      and product_variant.stock >= aggregated_items.quantity
    returning product_variant.id
  )
  select
    (select count(*) from aggregated_items),
    (select count(*) from updated_variants)
  into v_expected, v_updated;

  return true;
end;
$$;


--
-- Name: mark_square_payment_link_deleted(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_square_payment_link_deleted(p_order_id uuid, p_square_payment_link_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_updated integer;
begin
  update public.orders
  set
    square_payment_link_deleted_at = coalesce(square_payment_link_deleted_at, now()),
    updated_at = now()
  where id = p_order_id
    and square_payment_link_id = p_square_payment_link_id;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;


--
-- Name: process_square_dispute_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, text, timestamp with time zone, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_square_dispute_event(p_square_event_id text, p_event_type text, p_merchant_id text, p_location_id text, p_square_created_at timestamp with time zone, p_payload_sha256 text, p_event_data jsonb, p_square_dispute_id text, p_square_payment_id text, p_dispute_state text, p_dispute_reason text, p_due_at timestamp with time zone, p_amount_cents bigint, p_currency text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_inserted integer;
  v_order public.orders%rowtype;
begin
  insert into public.square_webhook_events (
    square_event_id, event_type, merchant_id, location_id, square_created_at,
    payload_sha256, event_data
  ) values (
    p_square_event_id, p_event_type, p_merchant_id, p_location_id,
    p_square_created_at, p_payload_sha256, coalesce(p_event_data, '{}'::jsonb)
  ) on conflict (square_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select orders.* into v_order
    from public.orders as orders
    join public.square_disputes as disputes on disputes.order_id = orders.id
    where disputes.square_dispute_id = p_square_dispute_id;
    return jsonb_build_object(
      'duplicate', true,
      'fulfillment_authorized', false,
      'order_id', v_order.id
    );
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.payment_transaction_id = p_square_payment_id
  for update;

  if not found then
    raise exception 'square_dispute_order_not_found';
  end if;
  if p_currency <> coalesce(v_order.currency, 'USD') then
    raise exception 'square_dispute_currency_mismatch';
  end if;

  insert into public.square_disputes (
    square_dispute_id, order_id, tenant_id, square_payment_id, state, reason,
    amount_cents, currency, due_at, square_created_at, updated_at
  ) values (
    p_square_dispute_id, v_order.id, v_order.tenant_id, p_square_payment_id,
    p_dispute_state, p_dispute_reason, p_amount_cents, p_currency, p_due_at,
    p_square_created_at, now()
  ) on conflict (square_dispute_id) do update set
    state = excluded.state,
    reason = excluded.reason,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    due_at = excluded.due_at,
    square_created_at = excluded.square_created_at,
    updated_at = now();

  insert into public.order_events(order_id, type, message)
  values (
    v_order.id,
    case when p_event_type = 'dispute.created'
      then 'payment_dispute_created'
      else 'payment_dispute_updated'
    end,
    'Square dispute state: ' || p_dispute_state
  );

  update public.square_webhook_events
  set processed_at = now()
  where square_event_id = p_square_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'fulfillment_authorized', false,
    'order_id', v_order.id
  );
end;
$$;


--
-- Name: process_square_payment_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, bigint, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_square_payment_event(p_square_event_id text, p_event_type text, p_merchant_id text, p_location_id text, p_square_created_at timestamp with time zone, p_payload_sha256 text, p_event_data jsonb, p_square_order_id text, p_square_payment_id text, p_payment_status text, p_amount_cents bigint, p_currency text, p_risk_level text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_inserted integer;
  v_order public.orders%rowtype;
  v_fulfillment_authorized boolean := false;
  v_base_cents bigint;
  v_tax_cents bigint;
begin
  insert into public.square_webhook_events (
    square_event_id,
    event_type,
    merchant_id,
    location_id,
    square_created_at,
    payload_sha256,
    event_data
  ) values (
    p_square_event_id,
    p_event_type,
    p_merchant_id,
    p_location_id,
    p_square_created_at,
    p_payload_sha256,
    coalesce(p_event_data, '{}'::jsonb)
  )
  on conflict (square_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('duplicate', true, 'fulfillment_authorized', false);
  end if;

  if p_payment_status <> 'COMPLETED' then
    update public.square_webhook_events
    set processed_at = now()
    where square_event_id = p_square_event_id;

    return jsonb_build_object('duplicate', false, 'fulfillment_authorized', false);
  end if;

  select orders.*
  into v_order
  from public.orders
  where orders.square_order_id = p_square_order_id
  for update;

  if not found then
    raise exception 'square_order_not_found';
  end if;

  v_base_cents := round(v_order.subtotal * 100)::bigint
    + round(v_order.shipping * 100)::bigint;
  v_tax_cents := p_amount_cents - v_base_cents;

  if coalesce(v_order.currency, 'USD') <> p_currency
    or v_tax_cents < 0
  then
    update public.orders
    set
      status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'square_payment_amount_mismatch',
      updated_at = now()
    where id = v_order.id;
  elsif upper(coalesce(p_risk_level, '')) = 'HIGH' then
    update public.orders
    set
      status = 'review',
      payment_transaction_id = p_square_payment_id,
      failure_reason = 'square_payment_high_risk',
      updated_at = now()
    where id = v_order.id;
  else
    update public.orders
    set
      tax_amount = v_tax_cents::numeric / 100,
      total = p_amount_cents::numeric / 100,
      tax_calculation_id = 'square:payment:' || p_square_payment_id,
      checkout_protection_evidence = coalesce(checkout_protection_evidence, '{}'::jsonb)
        || jsonb_build_object(
          'square_final_tax_cents', v_tax_cents,
          'square_final_total_cents', p_amount_cents,
          'square_payment_id', p_square_payment_id
        ),
      updated_at = now()
    where id = v_order.id;

    v_fulfillment_authorized := public.consume_square_checkout_reservation(
      v_order.id,
      p_square_payment_id,
      p_square_created_at
    );
  end if;

  update public.square_webhook_events
  set processed_at = now()
  where square_event_id = p_square_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'fulfillment_authorized', v_fulfillment_authorized,
    'order_id', v_order.id
  );
end;
$$;


--
-- Name: process_square_refund_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_square_refund_event(p_square_event_id text, p_event_type text, p_merchant_id text, p_location_id text, p_square_created_at timestamp with time zone, p_payload_sha256 text, p_event_data jsonb, p_square_payment_id text, p_square_refund_id text, p_refund_status text, p_amount_cents bigint, p_currency text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_inserted integer;
  v_order public.orders%rowtype;
  v_completed_refund_cents bigint;
  v_order_total_cents bigint;
  v_order_status text;
begin
  insert into public.square_webhook_events (
    square_event_id, event_type, merchant_id, location_id, square_created_at,
    payload_sha256, event_data
  ) values (
    p_square_event_id, p_event_type, p_merchant_id, p_location_id,
    p_square_created_at, p_payload_sha256, coalesce(p_event_data, '{}'::jsonb)
  ) on conflict (square_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select orders.* into v_order
    from public.orders as orders
    join public.square_refunds as refunds on refunds.order_id = orders.id
    where refunds.square_refund_id = p_square_refund_id;
    return jsonb_build_object(
      'duplicate', true,
      'fulfillment_authorized', false,
      'order_id', v_order.id
    );
  end if;

  select orders.* into v_order
  from public.orders as orders
  where orders.payment_transaction_id = p_square_payment_id
  for update;

  if not found then
    raise exception 'square_refund_order_not_found';
  end if;
  if p_currency <> coalesce(v_order.currency, 'USD') then
    raise exception 'square_refund_currency_mismatch';
  end if;

  insert into public.square_refunds (
    square_refund_id, order_id, tenant_id, square_payment_id, status,
    amount_cents, currency, reason, square_created_at, updated_at
  ) values (
    p_square_refund_id, v_order.id, v_order.tenant_id, p_square_payment_id,
    upper(p_refund_status), p_amount_cents, p_currency,
    nullif(p_event_data->>'reason', ''), p_square_created_at, now()
  ) on conflict (square_refund_id) do update set
    status = excluded.status,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    reason = excluded.reason,
    square_created_at = excluded.square_created_at,
    updated_at = now();

  select coalesce(sum(amount_cents), 0) into v_completed_refund_cents
  from public.square_refunds
  where order_id = v_order.id and status = 'COMPLETED';

  v_order_total_cents := round(v_order.total * 100)::bigint;
  v_order_status := case
    when upper(p_refund_status) = 'COMPLETED'
      and v_completed_refund_cents >= v_order_total_cents then 'refunded'
    when upper(p_refund_status) = 'COMPLETED' then 'partially_refunded'
    when upper(p_refund_status) = 'PENDING' then 'refund_pending'
    when upper(p_refund_status) in ('FAILED', 'REJECTED') then 'refund_failed'
    else v_order.status
  end;

  update public.orders
  set
    status = case
      when status in ('refunded', 'partially_refunded')
        and v_order_status in ('refund_pending', 'refund_failed') then status
      else v_order_status
    end,
    refund_amount = v_completed_refund_cents,
    refunded_at = case
      when v_completed_refund_cents > 0 then coalesce(refunded_at, now())
      else refunded_at
    end,
    updated_at = now()
  where id = v_order.id;

  insert into public.order_events(order_id, type, message)
  values (
    v_order.id,
    case
      when v_order_status = 'refunded' then 'payment_refunded'
      when v_order_status = 'partially_refunded' then 'payment_refund_partial'
      when v_order_status = 'refund_pending' then 'payment_refund_pending'
      else 'payment_refund_failed'
    end,
    'Square refund status: ' || upper(p_refund_status)
  );

  update public.square_webhook_events
  set processed_at = now()
  where square_event_id = p_square_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'fulfillment_authorized', false,
    'order_id', v_order.id
  );
end;
$$;


--
-- Name: queue_label_created_notification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_label_created_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.fulfillment = 'ship' and new.status = 'paid'
    and new.fulfillment_status = 'ready_to_ship'
    and nullif(new.label_url, '') is not null
    and nullif(new.tracking_number, '') is not null
    and (old.label_url is distinct from new.label_url
      or old.tracking_number is distinct from new.tracking_number) then
    insert into public.checkout_notification_outbox(
      event_key, order_id, tenant_id, kind, payload
    ) values (
      'label_created:' || new.id::text || ':' || new.tracking_number,
      new.id, new.tenant_id, 'label_created',
      jsonb_build_object('trackingNumber', new.tracking_number,
        'carrier', new.shipping_carrier, 'trackingUrl', new.tracking_url)
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;


--
-- Name: queue_paid_order_confirmation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_paid_order_confirmation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    insert into public.checkout_notification_outbox(
      event_key, order_id, tenant_id, kind
    ) values (
      'order_confirmation:' || new.id::text,
      new.id,
      new.tenant_id,
      'order_confirmation'
    ) on conflict (event_key) do nothing;

    if new.fulfillment = 'pickup' then
      insert into public.checkout_notification_outbox(
        event_key, order_id, tenant_id, kind
      ) values (
        'pickup_instructions:' || new.id::text,
        new.id,
        new.tenant_id,
        'pickup_instructions'
      ) on conflict (event_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: queue_square_refund_confirmation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_square_refund_confirmation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.status <> 'COMPLETED' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from 'COMPLETED' then
    return new;
  end if;

  insert into public.checkout_notification_outbox(
    event_key, order_id, tenant_id, kind, payload
  ) values (
    'refund_confirmation:' || new.square_refund_id,
    new.order_id,
    new.tenant_id,
    'refund_confirmation',
    jsonb_build_object('refundAmountCents', new.amount_cents)
  ) on conflict (event_key) do nothing;
  return new;
end;
$$;


--
-- Name: rdk_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rdk_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: record_shippo_tracking_update(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_shippo_tracking_update(p_tracking_number text, p_status text, p_carrier text, p_tracking_url text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders%rowtype;
  v_kind text;
  v_queued integer;
begin
  if p_status not in ('shipped', 'delivered') or p_status is null then
    raise exception 'unsupported_tracking_status';
  end if;
  -- Serialize callbacks for this order, including concurrent duplicate events.
  select * into v_order from public.orders
  where tracking_number = p_tracking_number and fulfillment = 'ship'
  limit 1 for update;
  if not found then
    return jsonb_build_object('matched', false);
  end if;
  if v_order.fulfillment_status = 'delivered' and p_status = 'shipped' then
    return jsonb_build_object('matched', true, 'queued', false, 'stale', true);
  end if;

  v_kind := case when p_status = 'delivered' then 'delivery_confirmation' else 'shipping_update' end;
  insert into public.checkout_notification_outbox(event_key, order_id, tenant_id, kind, payload)
  values (
    v_kind || ':' || v_order.id::text || ':' || p_tracking_number,
    v_order.id, v_order.tenant_id, v_kind,
    jsonb_build_object('trackingNumber', p_tracking_number,
      'carrier', coalesce(v_order.shipping_carrier, p_carrier), 'trackingUrl', p_tracking_url)
  ) on conflict (event_key) do nothing;
  get diagnostics v_queued = row_count;

  update public.orders set fulfillment_status = p_status
    where id = v_order.id and fulfillment_status is distinct from p_status;
  if not exists (select 1 from public.order_events where order_id = v_order.id and type = p_status) then
    insert into public.order_events(order_id, type, message)
    values (v_order.id, p_status, case when p_status = 'delivered'
      then 'Order delivered.' else 'Order is in transit with the carrier.' end);
  end if;
  return jsonb_build_object('matched', true, 'queued', v_queued = 1, 'orderId', v_order.id);
end;
$$;


--
-- Name: record_square_payment_details(text, text, text, bigint, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_square_payment_details(p_square_order_id text, p_square_payment_id text, p_payment_status text, p_amount_cents bigint, p_currency text, p_details jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders%rowtype;
  v_method text;
begin
  select * into v_order from public.orders where square_order_id = p_square_order_id;
  if not found then raise exception 'square_order_not_found'; end if;
  if nullif(p_square_payment_id, '') is null or p_amount_cents is null or p_amount_cents <= 0
    or p_currency is distinct from coalesce(v_order.currency, 'USD')
    or p_payment_status is null or p_payment_status not in ('APPROVED', 'PENDING', 'COMPLETED', 'CANCELED', 'FAILED')
  then raise exception 'square_payment_details_invalid'; end if;

  v_method := coalesce(
    p_details ->> 'payment_method',
    v_order.checkout_protection_evidence ->> 'payment_method',
    case when p_details ->> 'source_type' = 'CARD' then 'card' end
  );

  insert into public.payment_transactions (
    order_id, tenant_id, square_payment_id, payment_method,
    amount_requested, amount_authorized, amount_captured, currency,
    card_type, card_last4, card_expiry_month, card_expiry_year,
    avs_result_code, cvv2_result_code,
    billing_name, billing_phone, billing_address, billing_city,
    billing_state, billing_zip, billing_country, customer_email
  )
  select
    v_order.id, v_order.tenant_id, p_square_payment_id, v_method,
    p_amount_cents::numeric / 100,
    case when p_payment_status in ('APPROVED', 'COMPLETED') then p_amount_cents::numeric / 100 end,
    case when p_payment_status = 'COMPLETED' then p_amount_cents::numeric / 100 end,
    p_currency,
    p_details ->> 'card_type', p_details ->> 'card_last4',
    (p_details ->> 'card_expiry_month')::integer, (p_details ->> 'card_expiry_year')::integer,
    p_details ->> 'avs_result_code', p_details ->> 'cvv2_result_code',
    billing.name, billing.phone, billing.line1 || coalesce(' ' || billing.line2, ''),
    billing.city, billing.state, billing.postal_code, billing.country,
    coalesce(profile.email, v_order.guest_email)
  from (select 1) singleton
  left join public.order_billing billing on billing.order_id = v_order.id
  left join public.profiles profile on profile.id = v_order.user_id
  on conflict (square_payment_id) do update set
    payment_method = case
      when excluded.payment_method in ('applePay', 'googlePay', 'afterpay', 'cashAppPay') then excluded.payment_method
      else coalesce(payment_transactions.payment_method, excluded.payment_method)
    end,
    amount_authorized = greatest(payment_transactions.amount_authorized, excluded.amount_authorized),
    amount_captured = greatest(payment_transactions.amount_captured, excluded.amount_captured),
    card_type = coalesce(excluded.card_type, payment_transactions.card_type),
    card_last4 = coalesce(excluded.card_last4, payment_transactions.card_last4),
    card_expiry_month = coalesce(excluded.card_expiry_month, payment_transactions.card_expiry_month),
    card_expiry_year = coalesce(excluded.card_expiry_year, payment_transactions.card_expiry_year),
    avs_result_code = coalesce(excluded.avs_result_code, payment_transactions.avs_result_code),
    cvv2_result_code = coalesce(excluded.cvv2_result_code, payment_transactions.cvv2_result_code)
  where payment_transactions.order_id = excluded.order_id;
  if not found then raise exception 'square_payment_order_mismatch'; end if;
end;
$$;


--
-- Name: release_square_checkout_reservation(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_square_checkout_reservation(p_order_id uuid, p_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_order public.orders%rowtype;
  v_active_count integer;
begin
  select orders.*
  into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    return false;
  end if;

  if v_order.square_payment_link_id is not null
    and v_order.square_payment_link_deleted_at is null
  then
    raise exception 'square_link_must_be_deleted_before_inventory_release';
  end if;

  if v_order.status in ('paid', 'shipped', 'refunded', 'partially_refunded') then
    return false;
  end if;

  with active_reservations as (
    select reservation.variant_id, sum(reservation.quantity)::integer as quantity
    from public.inventory_reservations as reservation
    where reservation.order_id = p_order_id
      and reservation.status = 'active'
    group by reservation.variant_id
  ),
  restored as (
    update public.product_variants as product_variant
    set stock = product_variant.stock + active_reservations.quantity
    from active_reservations
    where product_variant.id = active_reservations.variant_id
    returning product_variant.id
  )
  select count(*) into v_active_count from restored;

  update public.inventory_reservations
  set
    status = 'released',
    released_at = now(),
    updated_at = now()
  where order_id = p_order_id
    and status = 'active';

  update public.orders
  set
    status = 'canceled',
    failure_reason = left(coalesce(nullif(trim(p_reason), ''), 'reservation_released'), 500),
    updated_at = now()
  where id = p_order_id;

  return v_active_count > 0;
end;
$$;


--
-- Name: reserve_square_checkout_inventory(uuid, uuid, text, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_square_checkout_inventory(p_tenant_id uuid, p_user_id uuid, p_guest_email text, p_currency text, p_fulfillment text, p_payment_method text, p_idempotency_key text, p_cart_hash text, p_expires_at timestamp with time zone, p_subtotal_cents integer, p_shipping_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_calculation_id text, p_customer_state text, p_shipping_address jsonb, p_billing_address jsonb, p_items jsonb, p_protection_evidence jsonb, p_pickup_contact jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_result jsonb;
begin
  if p_payment_method not in ('card', 'afterpay', 'applePay', 'googlePay', 'cashAppPay') then
    raise exception 'invalid_checkout_payment_method';
  end if;

  if p_fulfillment = 'pickup' and (
    jsonb_typeof(p_pickup_contact) is distinct from 'object'
    or coalesce(length(trim(p_pickup_contact ->> 'name')), 0) not between 1 and 100
    or coalesce(length(trim(p_pickup_contact ->> 'phone')), 0) not between 7 and 30
    or coalesce(trim(p_pickup_contact ->> 'phone'), '') !~ '^\+?[0-9 ().-]+$'
    or regexp_replace(coalesce(p_pickup_contact ->> 'phone', ''), '[^0-9]', '', 'g') !~ '^[0-9]{7,15}$'
  ) then
    raise exception 'checkout_pickup_contact_required';
  end if;
  if p_fulfillment <> 'pickup' and p_pickup_contact is not null then
    raise exception 'checkout_pickup_contact_not_allowed';
  end if;

  if p_billing_address is null then
    raise exception 'checkout_billing_address_required';
  end if;

  if p_billing_address is not null and (
    jsonb_typeof(p_billing_address) is distinct from 'object'
    or upper(coalesce(p_billing_address ->> 'country', '')) <> 'US'
    or nullif(trim(p_billing_address ->> 'given_name'), '') is null
    or nullif(trim(p_billing_address ->> 'family_name'), '') is null
    or nullif(trim(p_billing_address ->> 'line1'), '') is null
    or nullif(trim(p_billing_address ->> 'city'), '') is null
    or upper(coalesce(p_billing_address ->> 'state', '')) !~ '^[A-Z]{2}$'
    or coalesce(p_billing_address ->> 'postal_code', '') !~ '^\d{5}(-\d{4})?$'
  ) then
    raise exception 'invalid_checkout_billing_address';
  end if;

  v_result := public.reserve_square_checkout_inventory_without_billing(
    p_tenant_id,
    p_user_id,
    p_guest_email,
    p_currency,
    p_fulfillment,
    p_idempotency_key,
    p_cart_hash,
    p_expires_at,
    p_subtotal_cents,
    p_shipping_cents,
    p_tax_cents,
    p_total_cents,
    p_tax_calculation_id,
    p_customer_state,
    p_shipping_address,
    p_items,
    p_protection_evidence
  );

  if p_billing_address is not null then
    insert into public.order_billing (
      order_id,
      name,
      phone,
      line1,
      line2,
      city,
      state,
      postal_code,
      country
    ) values (
      (v_result ->> 'order_id')::uuid,
      trim(concat_ws(
        ' ',
        p_billing_address ->> 'given_name',
        p_billing_address ->> 'family_name'
      )),
      nullif(trim(p_billing_address ->> 'phone'), ''),
      trim(p_billing_address ->> 'line1'),
      nullif(trim(p_billing_address ->> 'line2'), ''),
      trim(p_billing_address ->> 'city'),
      upper(trim(p_billing_address ->> 'state')),
      trim(p_billing_address ->> 'postal_code'),
      'US'
    )
    on conflict (order_id) do nothing;
  end if;

  if p_fulfillment = 'pickup' then
    if coalesce((v_result ->> 'reused')::boolean, false) then
      if not exists (
        select 1 from public.orders
        where id = (v_result ->> 'order_id')::uuid
          and pickup_name = trim(p_pickup_contact ->> 'name')
          and pickup_phone = trim(p_pickup_contact ->> 'phone')
      ) then
        raise exception 'checkout_pickup_contact_conflict';
      end if;
    else
      update public.orders
      set pickup_name = trim(p_pickup_contact ->> 'name'),
          pickup_phone = trim(p_pickup_contact ->> 'phone')
      where id = (v_result ->> 'order_id')::uuid and tenant_id = p_tenant_id;
    end if;
  end if;

  return v_result;
end;
$_$;


--
-- Name: reserve_square_checkout_inventory_with_address(uuid, uuid, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_square_checkout_inventory_with_address(p_tenant_id uuid, p_user_id uuid, p_guest_email text, p_currency text, p_fulfillment text, p_idempotency_key text, p_cart_hash text, p_expires_at timestamp with time zone, p_subtotal_cents integer, p_shipping_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_calculation_id text, p_customer_state text, p_shipping_address jsonb, p_items jsonb, p_protection_evidence jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_existing_order public.orders%rowtype;
  v_order_id uuid;
  v_requested_count integer;
  v_updated_count integer;
  v_computed_subtotal integer;
begin
  if p_currency <> 'USD' then
    raise exception 'unsupported_checkout_currency';
  end if;

  if p_fulfillment not in ('ship', 'pickup') then
    raise exception 'invalid_checkout_fulfillment';
  end if;

  if p_customer_state !~ '^[A-Z]{2}$'
    or nullif(trim(p_tax_calculation_id), '') is null
  then
    raise exception 'invalid_checkout_tax_evidence';
  end if;

  if p_fulfillment = 'ship' and (
    p_shipping_address is null
    or jsonb_typeof(p_shipping_address) is distinct from 'object'
    or upper(coalesce(p_shipping_address ->> 'country', '')) <> 'US'
    or upper(coalesce(p_shipping_address ->> 'state', '')) <> p_customer_state
  ) then
    raise exception 'invalid_checkout_shipping_address';
  end if;

  if p_fulfillment = 'pickup' and p_shipping_address is not null then
    raise exception 'pickup_checkout_has_shipping_address';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 minutes' then
    raise exception 'invalid_checkout_expiration';
  end if;

  if p_subtotal_cents < 0
    or p_shipping_cents < 0
    or p_tax_cents < 0
    or p_total_cents <= 0
    or p_total_cents <> p_subtotal_cents + p_shipping_cents + p_tax_cents
  then
    raise exception 'invalid_checkout_totals';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_checkout_cart';
  end if;

  select orders.*
  into v_existing_order
  from public.orders
  where orders.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_order.tenant_id is distinct from p_tenant_id
      or v_existing_order.cart_hash is distinct from p_cart_hash
    then
      raise exception 'checkout_idempotency_conflict';
    end if;

    return jsonb_build_object(
      'order_id', v_existing_order.id,
      'reused', true,
      'expires_at', v_existing_order.expires_at,
      'square_payment_link_id', v_existing_order.square_payment_link_id,
      'square_order_id', v_existing_order.square_order_id,
      'square_payment_link_url', v_existing_order.square_payment_link_url
    );
  end if;

  select
    count(*),
    coalesce(sum(item.line_total_cents), 0)
  into v_requested_count, v_computed_subtotal
  from jsonb_to_recordset(p_items) as item(
    product_id uuid,
    variant_id uuid,
    quantity integer,
    unit_price_cents integer,
    unit_cost_cents integer,
    line_total_cents integer,
    variant_sku text,
    product_name text,
    brand text,
    model text,
    category text,
    condition text,
    size_label text
  );

  if v_requested_count <> (
    select count(distinct item.variant_id)
    from jsonb_to_recordset(p_items) as item(variant_id uuid)
  ) then
    raise exception 'duplicate_checkout_variant';
  end if;

  if v_computed_subtotal <> p_subtotal_cents then
    raise exception 'checkout_subtotal_mismatch';
  end if;

  with requested as (
    select
      item.product_id,
      item.variant_id,
      item.quantity
    from jsonb_to_recordset(p_items) as item(
      product_id uuid,
      variant_id uuid,
      quantity integer
    )
    where item.quantity > 0
  ),
  updated as (
    update public.product_variants as product_variant
    set stock = product_variant.stock - requested.quantity
    from requested
    where product_variant.id = requested.variant_id
      and product_variant.product_id = requested.product_id
      and product_variant.tenant_id = p_tenant_id
      and product_variant.stock >= requested.quantity
      and exists (
        select 1
        from public.products as product
        where product.id = requested.product_id
          and product.tenant_id = p_tenant_id
          and product.is_active = true
          and product.is_out_of_stock = false
          and product.go_live_at <= now()
      )
    returning product_variant.id
  )
  select count(*) into v_updated_count from updated;

  if v_updated_count <> v_requested_count then
    raise exception 'checkout_inventory_unavailable';
  end if;

  insert into public.orders (
    user_id,
    guest_email,
    tenant_id,
    currency,
    subtotal,
    shipping,
    tax_amount,
    tax_calculation_id,
    customer_state,
    total,
    status,
    fulfillment,
    idempotency_key,
    cart_hash,
    expires_at,
    checkout_protection_evidence
  ) values (
    p_user_id,
    nullif(trim(p_guest_email), ''),
    p_tenant_id,
    p_currency,
    p_subtotal_cents::numeric / 100,
    p_shipping_cents::numeric / 100,
    p_tax_cents::numeric / 100,
    p_tax_calculation_id,
    p_customer_state,
    p_total_cents::numeric / 100,
    'pending',
    p_fulfillment,
    p_idempotency_key,
    p_cart_hash,
    p_expires_at,
    coalesce(p_protection_evidence, '{}'::jsonb)
  )
  returning id into v_order_id;

  if p_fulfillment = 'ship' then
    insert into public.order_shipping (
      order_id,
      name,
      phone,
      line1,
      line2,
      city,
      state,
      postal_code,
      country
    ) values (
      v_order_id,
      nullif(trim(p_shipping_address ->> 'name'), ''),
      nullif(trim(p_shipping_address ->> 'phone'), ''),
      nullif(trim(p_shipping_address ->> 'line1'), ''),
      nullif(trim(p_shipping_address ->> 'line2'), ''),
      nullif(trim(p_shipping_address ->> 'city'), ''),
      upper(nullif(trim(p_shipping_address ->> 'state'), '')),
      nullif(trim(p_shipping_address ->> 'postal_code'), ''),
      'US'
    );
  end if;

  insert into public.order_items (
    order_id,
    product_id,
    variant_id,
    variant_sku,
    product_name,
    brand,
    model,
    category,
    condition,
    size_label,
    quantity,
    unit_price,
    unit_cost,
    line_total
  )
  select
    v_order_id,
    item.product_id,
    item.variant_id,
    item.variant_sku,
    item.product_name,
    item.brand,
    item.model,
    item.category,
    item.condition,
    item.size_label,
    item.quantity,
    item.unit_price_cents::numeric / 100,
    item.unit_cost_cents::numeric / 100,
    item.line_total_cents::numeric / 100
  from jsonb_to_recordset(p_items) as item(
    product_id uuid,
    variant_id uuid,
    quantity integer,
    unit_price_cents integer,
    unit_cost_cents integer,
    line_total_cents integer,
    variant_sku text,
    product_name text,
    brand text,
    model text,
    category text,
    condition text,
    size_label text
  );

  insert into public.inventory_reservations (
    tenant_id,
    order_id,
    variant_id,
    quantity,
    expires_at
  )
  select
    p_tenant_id,
    v_order_id,
    item.variant_id,
    item.quantity,
    p_expires_at
  from jsonb_to_recordset(p_items) as item(
    variant_id uuid,
    quantity integer
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'reused', false,
    'expires_at', p_expires_at
  );
end;
$_$;


--
-- Name: reserve_square_checkout_inventory_without_billing(uuid, uuid, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_square_checkout_inventory_without_billing(p_tenant_id uuid, p_user_id uuid, p_guest_email text, p_currency text, p_fulfillment text, p_idempotency_key text, p_cart_hash text, p_expires_at timestamp with time zone, p_subtotal_cents integer, p_shipping_cents integer, p_tax_cents integer, p_total_cents integer, p_tax_calculation_id text, p_customer_state text, p_shipping_address jsonb, p_items jsonb, p_protection_evidence jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_result jsonb;
begin
  v_result := public.reserve_square_checkout_inventory_with_address(
    p_tenant_id,
    p_user_id,
    p_guest_email,
    p_currency,
    p_fulfillment,
    p_idempotency_key,
    p_cart_hash,
    p_expires_at,
    p_subtotal_cents,
    p_shipping_cents,
    p_tax_cents,
    p_total_cents,
    p_tax_calculation_id,
    p_customer_state,
    case
      when p_fulfillment = 'ship' and p_shipping_address is null then
        jsonb_build_object('country', 'US', 'state', p_customer_state)
      else p_shipping_address
    end,
    p_items,
    p_protection_evidence
  );

  if p_fulfillment = 'ship' and p_shipping_address is null then
    delete from public.order_shipping
    where order_id = (v_result ->> 'order_id')::uuid
      and square_synced_at is null
      and name is null
      and phone is null
      and line1 is null
      and line2 is null
      and city is null
      and postal_code is null;
  end if;

  return v_result;
end;
$$;


--
-- Name: set_label_created_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_label_created_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.label_url IS NOT NULL AND OLD.label_url IS NULL THEN
    NEW.label_created_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trigger_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_chargeback_evidence_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_chargeback_evidence_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_orders_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_orders_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_payment_transactions_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payment_transactions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_product_out_of_stock_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_out_of_stock_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  product_id_to_check uuid;
  total_stock integer;
begin
  if (tg_op = 'DELETE') then
    product_id_to_check := old.product_id;
  else
    product_id_to_check := new.product_id;
  end if;

  if product_id_to_check is null then
    return null;
  end if;

  select coalesce(sum(stock), 0)
  into total_stock
  from public.product_variants
  where product_id = product_id_to_check;

  update public.products
  set is_out_of_stock = (total_stock <= 0)
  where id = product_id_to_check;

  return null;
end;
$$;


--
-- Name: update_shipping_carriers_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_shipping_carriers_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_state_sales_tracking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_state_sales_tracking() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    INSERT INTO public.state_sales_tracking AS tracking (
      tenant_id,
      state_code,
      year,
      month,
      total_sales,
      taxable_sales,
      transaction_count
    )
    VALUES (
      NEW.tenant_id,
      COALESCE(NEW.customer_state, 'SC'), -- Default to SC for pickups
      EXTRACT(YEAR FROM NEW.created_at),
      EXTRACT(MONTH FROM NEW.created_at),
      NEW.total,
      NEW.total - COALESCE(NEW.shipping, 0),
      1
    )
    ON CONFLICT (tenant_id, state_code, year, month)
    DO UPDATE SET
      total_sales = tracking.total_sales + EXCLUDED.total_sales,
      taxable_sales = tracking.taxable_sales + EXCLUDED.taxable_sales,
      transaction_count = tracking.transaction_count + EXCLUDED.transaction_count,
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: validate_product_taxonomy_refs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_product_taxonomy_refs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  brand_tenant uuid;
  model_tenant uuid;
begin
  select tenant_id into brand_tenant from public.tag_brands where id = new.brand_id;
  if not found then
    raise exception 'Unknown brand';
  end if;
  if brand_tenant is not null and brand_tenant is distinct from new.tenant_id then
    raise exception 'Brand belongs to another tenant';
  end if;

  if new.model_id is not null then
    select tenant_id into model_tenant from public.tag_models where id = new.model_id;
    if not found then
      raise exception 'Unknown model';
    end if;
    if model_tenant is not null and model_tenant is distinct from new.tenant_id then
      raise exception 'Model belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: validate_variant_size_ref(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_variant_size_ref() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  product_size_type text;
  product_tenant uuid;
  option_size_type text;
  option_tenant uuid;
begin
  select size_type, tenant_id into product_size_type, product_tenant
  from public.products where id = new.product_id;
  select size_type, tenant_id into option_size_type, option_tenant
  from public.tag_sizes where id = new.size_id;

  if option_size_type is distinct from product_size_type then
    raise exception 'Size option does not match product size type';
  end if;
  if option_tenant is not null and option_tenant is distinct from product_tenant then
    raise exception 'Size option belongs to another tenant';
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    action text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: admin_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    accepted_by uuid,
    CONSTRAINT admin_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'super_admin'::text])))
);


--
-- Name: chargeback_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chargeback_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    avs_result_code text,
    cvv_result_code text,
    customer_ip inet,
    device_fingerprint text,
    payment_transaction_id text,
    payment_amount numeric(10,2),
    payment_currency text,
    payment_method_last4 text,
    payment_method_type text,
    billing_address_snapshot jsonb,
    shipping_address_snapshot jsonb,
    carrier text,
    tracking_number text,
    delivery_confirmed_at timestamp with time zone,
    delivery_event_snapshot jsonb,
    order_snapshot jsonb,
    tax_calculation_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checkout_api_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkout_api_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    tenant_id uuid,
    request_id text,
    route text NOT NULL,
    method text DEFAULT 'POST'::text NOT NULL,
    http_status integer,
    duration_ms integer,
    event_label text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_payload jsonb,
    response_payload jsonb
);


--
-- Name: checkout_notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkout_notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkout_notification_outbox_kind_check CHECK ((kind = ANY (ARRAY['order_confirmation'::text, 'pickup_instructions'::text, 'refund_confirmation'::text, 'label_created'::text, 'shipping_update'::text, 'delivery_confirmation'::text]))),
    CONSTRAINT checkout_notification_outbox_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: contact_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    email text NOT NULL,
    subject text,
    message text NOT NULL,
    source text,
    user_id uuid,
    attachments jsonb
);


--
-- Name: email_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    tenant_id uuid NOT NULL,
    email_type text NOT NULL,
    recipient_email text NOT NULL,
    subject text,
    html_snapshot text,
    plain_text_snapshot text,
    message_id text,
    delivery_status text DEFAULT 'sent'::text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    notification_id uuid
);


--
-- Name: email_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    source text
);


--
-- Name: email_subscription_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_subscription_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    token text NOT NULL,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: featured_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.featured_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    tenant_id uuid,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE featured_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.featured_items IS 'Products featured on the home page';


--
-- Name: COLUMN featured_items.sort_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.featured_items.sort_order IS 'Display order (lower numbers first)';


--
-- Name: inventory_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    quantity integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_reservations_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT inventory_reservations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'consumed'::text, 'released'::text])))
);


--
-- Name: nexus_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexus_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    state_code character varying(2) NOT NULL,
    registration_type character varying(20) NOT NULL,
    is_registered boolean DEFAULT false NOT NULL,
    registered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tracking_started_at timestamp with time zone,
    CONSTRAINT nexus_registrations_registration_type_check CHECK (((registration_type)::text = ANY (ARRAY[('physical'::character varying)::text, ('economic'::character varying)::text])))
);


--
-- Name: order_access_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_access_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_billing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_billing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    name text,
    phone text,
    line1 text,
    line2 text,
    city text,
    state text,
    postal_code text,
    country text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    type text NOT NULL,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    line_total numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    unit_cost numeric(10,2),
    refund_amount numeric(10,2),
    refunded_at timestamp with time zone,
    variant_sku text,
    product_name text,
    brand text,
    model text,
    category text,
    condition text,
    size_label text,
    CONSTRAINT order_items_line_total_check CHECK ((line_total >= (0)::numeric)),
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: order_shipping; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_shipping (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    name text,
    phone text,
    line1 text,
    line2 text,
    city text,
    state text,
    postal_code text,
    country text,
    created_at timestamp with time zone DEFAULT now(),
    square_synced_at timestamp with time zone
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    tenant_id uuid,
    seller_id uuid,
    subtotal numeric(10,2) NOT NULL,
    shipping numeric(10,2) NOT NULL,
    total numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    cart_hash text,
    currency text DEFAULT 'USD'::text,
    expires_at timestamp with time zone,
    fee numeric(10,2),
    fulfillment text,
    idempotency_key text,
    public_token text,
    payment_transaction_id text,
    updated_at timestamp with time zone DEFAULT now(),
    fulfillment_status text DEFAULT 'unfulfilled'::text,
    shipping_carrier text,
    tracking_number text,
    shipped_at timestamp with time zone,
    refund_amount numeric(10,2),
    refunded_at timestamp with time zone,
    actual_shipping_cost_cents integer,
    label_created_at timestamp without time zone,
    label_created_by uuid,
    label_url text,
    guest_email text,
    pickup_location_id uuid,
    pickup_instructions text,
    customer_state character varying(2),
    tax_transaction_id character varying(255),
    tax_amount numeric(10,2) DEFAULT 0,
    tax_calculation_id character varying(255),
    failure_reason text,
    square_payment_link_id text,
    square_order_id text,
    square_payment_link_url text,
    square_payment_link_deleted_at timestamp with time zone,
    checkout_protection_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    square_order_version integer,
    pickup_name text,
    pickup_phone text,
    tracking_url text,
    CONSTRAINT orders_contact_info_required_when_paid CHECK (((status = ANY (ARRAY['pending'::text, 'canceled'::text, 'failed'::text, 'blocked'::text, 'review'::text])) OR (user_id IS NOT NULL) OR (guest_email IS NOT NULL))),
    CONSTRAINT orders_fulfillment_check CHECK ((fulfillment = ANY (ARRAY['ship'::text, 'pickup'::text]))),
    CONSTRAINT orders_pickup_contact_complete CHECK ((((pickup_name IS NULL) AND (pickup_phone IS NULL)) OR ((fulfillment = 'pickup'::text) AND (pickup_name IS NOT NULL) AND (pickup_phone IS NOT NULL) AND ((length(TRIM(BOTH FROM pickup_name)) >= 1) AND (length(TRIM(BOTH FROM pickup_name)) <= 100)) AND ((length(pickup_phone) >= 7) AND (length(pickup_phone) <= 30)) AND (pickup_phone ~ '^\+?[0-9 ().-]+$'::text) AND (regexp_replace(pickup_phone, '[^0-9]'::text, ''::text, 'g'::text) ~ '^[0-9]{7,15}$'::text)))),
    CONSTRAINT orders_square_order_version_check CHECK (((square_order_version IS NULL) OR (square_order_version >= 0))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'paid'::text, 'shipped'::text, 'canceled'::text, 'refunded'::text, 'partially_refunded'::text, 'refund_pending'::text, 'refund_failed'::text, 'failed'::text, 'blocked'::text, 'review'::text])))
);


--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_transaction_id uuid NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid,
    event_type character varying(50) NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid,
    card_type character varying(20),
    card_last4 character varying(4),
    card_bin character varying(8),
    avs_result_code text,
    cvv2_result_code text,
    three_ds_status character varying(2),
    three_ds_eci character varying(2),
    amount_requested numeric(10,2) NOT NULL,
    amount_authorized numeric(10,2),
    amount_captured numeric(10,2),
    amount_refunded numeric(10,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    billing_name character varying(255),
    billing_address text,
    billing_city character varying(100),
    billing_state character varying(50),
    billing_zip character varying(20),
    billing_country character varying(2),
    billing_phone character varying(50),
    customer_email character varying(255),
    customer_ip character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    card_expiry_month smallint,
    card_expiry_year smallint,
    square_payment_id text,
    payment_method text,
    CONSTRAINT payment_transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['card'::text, 'applePay'::text, 'googlePay'::text, 'afterpay'::text, 'cashAppPay'::text])))
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    url text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_primary boolean DEFAULT false NOT NULL
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    sale_price_cents integer NOT NULL,
    stock integer DEFAULT 1 NOT NULL,
    unit_cost_cents integer DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    tenant_id uuid NOT NULL,
    sku text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    size_id uuid NOT NULL,
    CONSTRAINT product_variants_sale_price_cents_check CHECK ((sale_price_cents >= 0)),
    CONSTRAINT product_variants_sku_nonempty_check CHECK ((length(TRIM(BOTH FROM sku)) > 0)),
    CONSTRAINT product_variants_stock_check CHECK ((stock >= 0)),
    CONSTRAINT product_variants_unit_cost_cents_check CHECK ((unit_cost_cents >= 0))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    condition text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_out_of_stock boolean DEFAULT false NOT NULL,
    go_live_at timestamp with time zone DEFAULT now() NOT NULL,
    size_type text DEFAULT 'none'::text NOT NULL,
    shipping_price_cents integer,
    archived_at timestamp with time zone,
    product_created_at timestamp with time zone DEFAULT now() NOT NULL,
    product_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    brand_id uuid NOT NULL,
    model_id uuid,
    CONSTRAINT products_category_check CHECK ((category = ANY (ARRAY['sneakers'::text, 'clothing'::text, 'accessories'::text, 'electronics'::text]))),
    CONSTRAINT products_condition_check CHECK ((condition = ANY (ARRAY['new'::text, 'used'::text]))),
    CONSTRAINT products_shipping_price_cents_check CHECK (((shipping_price_cents IS NULL) OR (shipping_price_cents >= 0))),
    CONSTRAINT products_size_type_check CHECK ((size_type = ANY (ARRAY['shoe'::text, 'clothing'::text, 'custom'::text, 'none'::text])))
);


--
-- Name: COLUMN products.go_live_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.go_live_at IS 'UTC timestamp when the product becomes visible to customers. Defaults to immediate publish.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    role text DEFAULT 'customer'::text,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    full_name text,
    is_primary_admin boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'admin'::text, 'super_admin'::text, 'dev'::text])))
);


--
-- Name: sellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sellers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shipping_carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_carriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enabled_carriers text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipping_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_defaults (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    category text NOT NULL,
    shipping_cost_cents numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    default_weight_oz numeric NOT NULL,
    default_length_in numeric NOT NULL,
    default_width_in numeric NOT NULL,
    default_height_in numeric NOT NULL
);


--
-- Name: shipping_origins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_origins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    company text,
    phone text,
    line1 text NOT NULL,
    line2 text,
    city text NOT NULL,
    state text NOT NULL,
    postal_code text NOT NULL,
    country text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipping_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_profiles (
    user_id uuid NOT NULL,
    tenant_id uuid,
    full_name text,
    phone text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    postal_code text,
    country text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shipping_tracking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_tracking_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    carrier text NOT NULL,
    tracking_number text NOT NULL,
    event_timestamp timestamp with time zone NOT NULL,
    status text NOT NULL,
    location text,
    description text,
    raw_carrier_response jsonb,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: square_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_disputes (
    square_dispute_id text NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    square_payment_id text NOT NULL,
    state text NOT NULL,
    reason text NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    due_at timestamp with time zone,
    square_created_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT square_disputes_amount_cents_check CHECK ((amount_cents >= 0))
);


--
-- Name: square_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_refunds (
    square_refund_id text NOT NULL,
    order_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    square_payment_id text NOT NULL,
    status text NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    reason text,
    square_created_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT square_refunds_amount_cents_check CHECK ((amount_cents >= 0))
);


--
-- Name: square_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.square_webhook_events (
    square_event_id text NOT NULL,
    event_type text NOT NULL,
    merchant_id text,
    location_id text,
    square_created_at timestamp with time zone,
    payload_sha256 text NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    processing_error text
);


--
-- Name: state_sales_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.state_sales_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    state_code character varying(2) NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    total_sales numeric(10,2) DEFAULT 0 NOT NULL,
    taxable_sales numeric(10,2) DEFAULT 0 NOT NULL,
    transaction_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tax_collected numeric(10,2) DEFAULT 0 NOT NULL
);


--
-- Name: tag_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    entity_type text NOT NULL,
    brand_id uuid,
    model_id uuid,
    alias_label text NOT NULL,
    alias_normalized text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_aliases_alias_label_check CHECK ((length(TRIM(BOTH FROM alias_label)) > 0)),
    CONSTRAINT tag_aliases_alias_normalized_check CHECK ((length(TRIM(BOTH FROM alias_normalized)) > 0)),
    CONSTRAINT tag_aliases_entity_type_check CHECK ((entity_type = ANY (ARRAY['brand'::text, 'model'::text]))),
    CONSTRAINT tag_aliases_target_check CHECK ((((entity_type = 'brand'::text) AND (brand_id IS NOT NULL) AND (model_id IS NULL)) OR ((entity_type = 'model'::text) AND (model_id IS NOT NULL) AND (brand_id IS NULL))))
);


--
-- Name: tag_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    canonical_label text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_brands_canonical_label_check CHECK ((length(TRIM(BOTH FROM canonical_label)) > 0))
);


--
-- Name: tag_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    raw_text text NOT NULL,
    normalized_text text NOT NULL,
    parent_brand_id uuid,
    status text DEFAULT 'new'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_candidates_entity_type_check CHECK ((entity_type = ANY (ARRAY['brand'::text, 'model'::text]))),
    CONSTRAINT tag_candidates_normalized_text_check CHECK ((length(TRIM(BOTH FROM normalized_text)) > 0)),
    CONSTRAINT tag_candidates_parent_check CHECK ((((entity_type = 'brand'::text) AND (parent_brand_id IS NULL)) OR ((entity_type = 'model'::text) AND (parent_brand_id IS NOT NULL)))),
    CONSTRAINT tag_candidates_raw_text_check CHECK ((length(TRIM(BOTH FROM raw_text)) > 0)),
    CONSTRAINT tag_candidates_status_check CHECK ((status = ANY (ARRAY['new'::text, 'accepted'::text, 'rejected'::text])))
);


--
-- Name: tag_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    brand_id uuid NOT NULL,
    canonical_label text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_models_canonical_label_check CHECK ((length(TRIM(BOTH FROM canonical_label)) > 0))
);


--
-- Name: tag_sizes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tag_sizes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    size_type text NOT NULL,
    canonical_label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tag_sizes_canonical_label_check CHECK ((length(TRIM(BOTH FROM canonical_label)) > 0)),
    CONSTRAINT tag_sizes_size_type_check CHECK ((size_type = ANY (ARRAY['shoe'::text, 'clothing'::text, 'custom'::text, 'none'::text]))),
    CONSTRAINT tag_sizes_sort_order_check CHECK ((sort_order >= 0))
);


--
-- Name: tax_rate_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rate_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zip_code text NOT NULL,
    state_code text,
    combined_rate numeric(6,4) NOT NULL,
    state_rate numeric(6,4),
    county_rate numeric(6,4),
    city_rate numeric(6,4),
    district_rate numeric(6,4),
    breakdown jsonb,
    cached_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL
);


--
-- Name: tenant_checkout_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_checkout_settings (
    tenant_id uuid NOT NULL,
    flat_shipping_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_checkout_settings_flat_shipping_cents_check CHECK ((flat_shipping_cents >= 0))
);


--
-- Name: tenant_store_access_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_store_access_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    site_lock_enabled boolean DEFAULT false NOT NULL,
    site_unlock_at timestamp with time zone,
    checkout_lock_enabled boolean DEFAULT false NOT NULL,
    checkout_lock_message text DEFAULT 'sorry we currently can not accept payments please message @realdealkickzsc on instagram the items you would like to purchase.'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: tenant_tax_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_tax_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    home_state character varying(2) NOT NULL,
    business_name character varying(255),
    tax_id_number character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tax_enabled boolean DEFAULT false NOT NULL,
    tax_code_overrides jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: transaction_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    tenant_id uuid NOT NULL,
    event_type text NOT NULL,
    actor text NOT NULL,
    data jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text,
    phone text,
    line1 text,
    line2 text,
    city text,
    state text,
    postal_code text,
    country text,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_billing_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_billing_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text,
    phone text,
    line1 text,
    line2 text,
    city text,
    state text,
    postal_code text,
    country text,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: admin_invites admin_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invites
    ADD CONSTRAINT admin_invites_pkey PRIMARY KEY (id);


--
-- Name: admin_invites admin_invites_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invites
    ADD CONSTRAINT admin_invites_token_hash_key UNIQUE (token_hash);


--
-- Name: chargeback_evidence chargeback_evidence_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chargeback_evidence
    ADD CONSTRAINT chargeback_evidence_order_id_key UNIQUE (order_id);


--
-- Name: chargeback_evidence chargeback_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chargeback_evidence
    ADD CONSTRAINT chargeback_evidence_pkey PRIMARY KEY (id);


--
-- Name: checkout_api_logs checkout_api_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_api_logs
    ADD CONSTRAINT checkout_api_logs_pkey PRIMARY KEY (id);


--
-- Name: checkout_notification_outbox checkout_notification_outbox_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_notification_outbox
    ADD CONSTRAINT checkout_notification_outbox_event_key_key UNIQUE (event_key);


--
-- Name: checkout_notification_outbox checkout_notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_notification_outbox
    ADD CONSTRAINT checkout_notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: contact_messages contact_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);


--
-- Name: email_audit_log email_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_audit_log
    ADD CONSTRAINT email_audit_log_pkey PRIMARY KEY (id);


--
-- Name: email_subscribers email_subscribers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_subscribers
    ADD CONSTRAINT email_subscribers_email_key UNIQUE (email);


--
-- Name: email_subscribers email_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_subscribers
    ADD CONSTRAINT email_subscribers_pkey PRIMARY KEY (id);


--
-- Name: email_subscription_tokens email_subscription_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_subscription_tokens
    ADD CONSTRAINT email_subscription_tokens_pkey PRIMARY KEY (id);


--
-- Name: featured_items featured_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_items
    ADD CONSTRAINT featured_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_reservations inventory_reservations_order_id_variant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_id_variant_id_key UNIQUE (order_id, variant_id);


--
-- Name: inventory_reservations inventory_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_pkey PRIMARY KEY (id);


--
-- Name: nexus_registrations nexus_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexus_registrations
    ADD CONSTRAINT nexus_registrations_pkey PRIMARY KEY (id);


--
-- Name: nexus_registrations nexus_registrations_tenant_id_state_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexus_registrations
    ADD CONSTRAINT nexus_registrations_tenant_id_state_code_key UNIQUE (tenant_id, state_code);


--
-- Name: order_access_tokens order_access_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_access_tokens
    ADD CONSTRAINT order_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: order_billing order_billing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_billing
    ADD CONSTRAINT order_billing_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_shipping order_shipping_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_order_id_key UNIQUE (order_id);


--
-- Name: order_shipping order_shipping_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_square_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_square_payment_id_key UNIQUE (square_payment_id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_tenant_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_tenant_sku_key UNIQUE (tenant_id, sku);


--
-- Name: product_variants product_variants_unique_per_size; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_unique_per_size UNIQUE (product_id, size_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: sellers sellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_pkey PRIMARY KEY (id);


--
-- Name: shipping_carriers shipping_carriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_carriers
    ADD CONSTRAINT shipping_carriers_pkey PRIMARY KEY (id);


--
-- Name: shipping_defaults shipping_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_defaults
    ADD CONSTRAINT shipping_defaults_pkey PRIMARY KEY (id);


--
-- Name: shipping_origins shipping_origins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_origins
    ADD CONSTRAINT shipping_origins_pkey PRIMARY KEY (id);


--
-- Name: shipping_profiles shipping_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_profiles
    ADD CONSTRAINT shipping_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: shipping_tracking_events shipping_tracking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_tracking_events
    ADD CONSTRAINT shipping_tracking_events_pkey PRIMARY KEY (id);


--
-- Name: square_disputes square_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_disputes
    ADD CONSTRAINT square_disputes_pkey PRIMARY KEY (square_dispute_id);


--
-- Name: square_refunds square_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_refunds
    ADD CONSTRAINT square_refunds_pkey PRIMARY KEY (square_refund_id);


--
-- Name: square_webhook_events square_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_pkey PRIMARY KEY (square_event_id);


--
-- Name: state_sales_tracking state_sales_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_sales_tracking
    ADD CONSTRAINT state_sales_tracking_pkey PRIMARY KEY (id);


--
-- Name: state_sales_tracking state_sales_tracking_tenant_id_state_code_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_sales_tracking
    ADD CONSTRAINT state_sales_tracking_tenant_id_state_code_year_month_key UNIQUE (tenant_id, state_code, year, month);


--
-- Name: tag_aliases tag_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_aliases
    ADD CONSTRAINT tag_aliases_pkey PRIMARY KEY (id);


--
-- Name: tag_brands tag_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_brands
    ADD CONSTRAINT tag_brands_pkey PRIMARY KEY (id);


--
-- Name: tag_candidates tag_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_candidates
    ADD CONSTRAINT tag_candidates_pkey PRIMARY KEY (id);


--
-- Name: tag_models tag_models_id_brand_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_models
    ADD CONSTRAINT tag_models_id_brand_key UNIQUE (id, brand_id);


--
-- Name: tag_models tag_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_models
    ADD CONSTRAINT tag_models_pkey PRIMARY KEY (id);


--
-- Name: tag_sizes tag_sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_sizes
    ADD CONSTRAINT tag_sizes_pkey PRIMARY KEY (id);


--
-- Name: tax_rate_cache tax_rate_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate_cache
    ADD CONSTRAINT tax_rate_cache_pkey PRIMARY KEY (id);


--
-- Name: tax_rate_cache tax_rate_cache_zip_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rate_cache
    ADD CONSTRAINT tax_rate_cache_zip_code_key UNIQUE (zip_code);


--
-- Name: tenant_checkout_settings tenant_checkout_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_checkout_settings
    ADD CONSTRAINT tenant_checkout_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_store_access_settings tenant_store_access_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_store_access_settings
    ADD CONSTRAINT tenant_store_access_settings_pkey PRIMARY KEY (id);


--
-- Name: tenant_tax_settings tenant_tax_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tax_settings
    ADD CONSTRAINT tenant_tax_settings_pkey PRIMARY KEY (id);


--
-- Name: tenant_tax_settings tenant_tax_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tax_settings
    ADD CONSTRAINT tenant_tax_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: transaction_audit_log transaction_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_pkey PRIMARY KEY (id);


--
-- Name: featured_items unique_featured_product_per_tenant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_items
    ADD CONSTRAINT unique_featured_product_per_tenant UNIQUE (tenant_id, product_id);


--
-- Name: user_addresses user_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_pkey PRIMARY KEY (id);


--
-- Name: user_billing_addresses user_billing_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_billing_addresses
    ADD CONSTRAINT user_billing_addresses_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: admin_audit_log_admin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_log_admin_idx ON public.admin_audit_log USING btree (admin_id);


--
-- Name: admin_invites_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_invites_created_by_idx ON public.admin_invites USING btree (created_by, created_at DESC);


--
-- Name: checkout_api_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkout_api_logs_created_at_idx ON public.checkout_api_logs USING btree (created_at);


--
-- Name: checkout_api_logs_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkout_api_logs_order_id_idx ON public.checkout_api_logs USING btree (order_id);


--
-- Name: checkout_notification_outbox_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkout_notification_outbox_ready_idx ON public.checkout_notification_outbox USING btree (status, next_attempt_at);


--
-- Name: contact_messages_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_messages_created_at_idx ON public.contact_messages USING btree (created_at DESC);


--
-- Name: contact_messages_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_messages_email_idx ON public.contact_messages USING btree (email);


--
-- Name: contact_messages_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_messages_user_idx ON public.contact_messages USING btree (user_id);


--
-- Name: email_audit_log_notification_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_audit_log_notification_sent_idx ON public.email_audit_log USING btree (notification_id) WHERE (delivery_status = 'sent'::text);


--
-- Name: email_subscribers_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_subscribers_email_idx ON public.email_subscribers USING btree (email);


--
-- Name: email_subscription_tokens_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_subscription_tokens_email_idx ON public.email_subscription_tokens USING btree (email);


--
-- Name: email_subscription_tokens_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_subscription_tokens_token_key ON public.email_subscription_tokens USING btree (token);


--
-- Name: idx_chargeback_evidence_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chargeback_evidence_order_id ON public.chargeback_evidence USING btree (order_id);


--
-- Name: idx_chargeback_evidence_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chargeback_evidence_tenant_id ON public.chargeback_evidence USING btree (tenant_id);


--
-- Name: idx_email_audit_log_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_audit_log_order_id ON public.email_audit_log USING btree (order_id);


--
-- Name: idx_email_audit_log_tenant_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_audit_log_tenant_sent ON public.email_audit_log USING btree (tenant_id, sent_at DESC);


--
-- Name: idx_featured_items_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_featured_items_product ON public.featured_items USING btree (product_id);


--
-- Name: idx_featured_items_tenant_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_featured_items_tenant_sort ON public.featured_items USING btree (tenant_id, sort_order);


--
-- Name: idx_nexus_registrations_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nexus_registrations_state ON public.nexus_registrations USING btree (state_code);


--
-- Name: idx_nexus_registrations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nexus_registrations_tenant ON public.nexus_registrations USING btree (tenant_id);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_order_refunded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_refunded_at ON public.order_items USING btree (order_id, refunded_at);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);


--
-- Name: idx_order_shipping_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_shipping_order_id ON public.order_shipping USING btree (order_id);


--
-- Name: idx_orders_cart_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_cart_hash ON public.orders USING btree (cart_hash);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_customer_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_state ON public.orders USING btree (customer_state);


--
-- Name: idx_orders_fulfillment_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_fulfillment_created_at ON public.orders USING btree (fulfillment, created_at DESC);


--
-- Name: idx_orders_fulfillment_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_fulfillment_status_created_at ON public.orders USING btree (fulfillment_status, created_at DESC);


--
-- Name: idx_orders_label_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_label_created_at ON public.orders USING btree (label_created_at) WHERE (label_created_at IS NOT NULL);


--
-- Name: idx_orders_label_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_label_url ON public.orders USING btree (label_url) WHERE (label_url IS NOT NULL);


--
-- Name: idx_orders_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_created_at ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_orders_user_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_created_at ON public.orders USING btree (user_id, created_at DESC);


--
-- Name: idx_payment_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_order ON public.payment_events USING btree (order_id);


--
-- Name: idx_payment_events_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_transaction ON public.payment_events USING btree (payment_transaction_id);


--
-- Name: idx_payment_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_events_type ON public.payment_events USING btree (event_type);


--
-- Name: idx_payment_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_order ON public.payment_transactions USING btree (order_id);


--
-- Name: idx_payment_transactions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_tenant ON public.payment_transactions USING btree (tenant_id);


--
-- Name: idx_product_images_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_product_id ON public.product_images USING btree (product_id);


--
-- Name: idx_product_images_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_sort ON public.product_images USING btree (product_id, is_primary DESC, sort_order);


--
-- Name: idx_product_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_id ON public.product_variants USING btree (product_id);


--
-- Name: idx_product_variants_product_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_price ON public.product_variants USING btree (product_id, sale_price_cents);


--
-- Name: idx_product_variants_product_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_sort_order ON public.product_variants USING btree (product_id, sort_order);


--
-- Name: idx_product_variants_tenant_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_tenant_sku ON public.product_variants USING btree (tenant_id, sku);


--
-- Name: idx_products_archived_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_archived_at ON public.products USING btree (archived_at);


--
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category ON public.products USING btree (category);


--
-- Name: idx_products_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_created_at ON public.products USING btree (created_at DESC);


--
-- Name: idx_products_go_live_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_go_live_at ON public.products USING btree (go_live_at);


--
-- Name: idx_products_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_active ON public.products USING btree (is_active);


--
-- Name: idx_products_product_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_product_created_at ON public.products USING btree (product_created_at DESC);


--
-- Name: idx_products_product_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_product_updated_at ON public.products USING btree (product_updated_at DESC);


--
-- Name: idx_products_tenant_archived_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_archived_at ON public.products USING btree (tenant_id, archived_at);


--
-- Name: idx_products_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_id ON public.products USING btree (tenant_id);


--
-- Name: idx_shipping_profiles_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_profiles_tenant_id ON public.shipping_profiles USING btree (tenant_id);


--
-- Name: idx_shipping_tracking_events_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_tracking_events_order_id ON public.shipping_tracking_events USING btree (order_id, event_timestamp DESC);


--
-- Name: idx_shipping_tracking_events_tracking_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipping_tracking_events_tracking_number ON public.shipping_tracking_events USING btree (tracking_number);


--
-- Name: idx_state_sales_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_state_sales_date ON public.state_sales_tracking USING btree (year, month);


--
-- Name: idx_state_sales_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_state_sales_state ON public.state_sales_tracking USING btree (state_code);


--
-- Name: idx_state_sales_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_state_sales_tenant ON public.state_sales_tracking USING btree (tenant_id);


--
-- Name: idx_state_sales_tracking_tax_collected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_state_sales_tracking_tax_collected ON public.state_sales_tracking USING btree (tenant_id, state_code, tax_collected);


--
-- Name: idx_tax_rate_cache_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_rate_cache_expires_at ON public.tax_rate_cache USING btree (expires_at);


--
-- Name: idx_tax_rate_cache_zip_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_rate_cache_zip_code ON public.tax_rate_cache USING btree (zip_code);


--
-- Name: idx_tenant_tax_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_tax_settings_tenant ON public.tenant_tax_settings USING btree (tenant_id);


--
-- Name: idx_transaction_audit_log_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_audit_log_order_id ON public.transaction_audit_log USING btree (order_id);


--
-- Name: idx_transaction_audit_log_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_audit_log_tenant_created ON public.transaction_audit_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_user_addresses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_addresses_user_id ON public.user_addresses USING btree (user_id);


--
-- Name: idx_user_addresses_user_line_postal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_addresses_user_line_postal ON public.user_addresses USING btree (user_id, line1, postal_code);


--
-- Name: inventory_reservations_active_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_reservations_active_expiry_idx ON public.inventory_reservations USING btree (expires_at) WHERE (status = 'active'::text);


--
-- Name: order_access_tokens_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_access_tokens_order_id_idx ON public.order_access_tokens USING btree (order_id);


--
-- Name: order_access_tokens_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_access_tokens_token_hash_key ON public.order_access_tokens USING btree (token_hash);


--
-- Name: order_billing_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_billing_order_id_idx ON public.order_billing USING btree (order_id);


--
-- Name: order_billing_order_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX order_billing_order_id_unique ON public.order_billing USING btree (order_id);


--
-- Name: order_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_events_created_at_idx ON public.order_events USING btree (created_at);


--
-- Name: order_events_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_events_order_id_idx ON public.order_events USING btree (order_id);


--
-- Name: orders_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_idempotency_key_key ON public.orders USING btree (idempotency_key);


--
-- Name: orders_square_order_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_square_order_id_key ON public.orders USING btree (square_order_id) WHERE (square_order_id IS NOT NULL);


--
-- Name: orders_square_payment_link_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_square_payment_link_id_key ON public.orders USING btree (square_payment_link_id) WHERE (square_payment_link_id IS NOT NULL);


--
-- Name: orders_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_tenant_idx ON public.orders USING btree (tenant_id);


--
-- Name: orders_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_user_id_idx ON public.orders USING btree (user_id);


--
-- Name: product_variants_size_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_variants_size_id_idx ON public.product_variants USING btree (size_id);


--
-- Name: products_brand_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_brand_id_idx ON public.products USING btree (brand_id);


--
-- Name: products_model_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_model_id_idx ON public.products USING btree (model_id);


--
-- Name: profiles_primary_admin_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_primary_admin_unique ON public.profiles USING btree (is_primary_admin) WHERE is_primary_admin;


--
-- Name: profiles_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_tenant_idx ON public.profiles USING btree (tenant_id);


--
-- Name: shipping_defaults_tenant_category_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shipping_defaults_tenant_category_key ON public.shipping_defaults USING btree (tenant_id, category);


--
-- Name: square_disputes_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX square_disputes_order_id_idx ON public.square_disputes USING btree (order_id);


--
-- Name: square_disputes_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX square_disputes_payment_id_idx ON public.square_disputes USING btree (square_payment_id);


--
-- Name: square_refunds_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX square_refunds_order_id_idx ON public.square_refunds USING btree (order_id);


--
-- Name: square_refunds_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX square_refunds_payment_id_idx ON public.square_refunds USING btree (square_payment_id);


--
-- Name: square_webhook_events_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX square_webhook_events_received_at_idx ON public.square_webhook_events USING btree (received_at);


--
-- Name: tag_aliases_global_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_aliases_global_key ON public.tag_aliases USING btree (entity_type, alias_normalized) WHERE (tenant_id IS NULL);


--
-- Name: tag_aliases_tenant_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_aliases_tenant_key ON public.tag_aliases USING btree (tenant_id, entity_type, alias_normalized) WHERE (tenant_id IS NOT NULL);


--
-- Name: tag_brands_global_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_brands_global_label_key ON public.tag_brands USING btree (lower(canonical_label)) WHERE (tenant_id IS NULL);


--
-- Name: tag_brands_tenant_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_brands_tenant_label_key ON public.tag_brands USING btree (tenant_id, lower(canonical_label)) WHERE (tenant_id IS NOT NULL);


--
-- Name: tag_candidates_tenant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_candidates_tenant_status_idx ON public.tag_candidates USING btree (tenant_id, status, created_at DESC);


--
-- Name: tag_models_global_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_models_global_label_key ON public.tag_models USING btree (brand_id, lower(canonical_label)) WHERE (tenant_id IS NULL);


--
-- Name: tag_models_tenant_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_models_tenant_label_key ON public.tag_models USING btree (tenant_id, brand_id, lower(canonical_label)) WHERE (tenant_id IS NOT NULL);


--
-- Name: tag_sizes_global_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_sizes_global_label_key ON public.tag_sizes USING btree (size_type, lower(canonical_label)) WHERE (tenant_id IS NULL);


--
-- Name: tag_sizes_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tag_sizes_sort_idx ON public.tag_sizes USING btree (size_type, sort_order, canonical_label);


--
-- Name: tag_sizes_tenant_label_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tag_sizes_tenant_label_key ON public.tag_sizes USING btree (tenant_id, size_type, lower(canonical_label)) WHERE (tenant_id IS NOT NULL);


--
-- Name: tenant_store_access_settings_tenant_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_store_access_settings_tenant_id_key ON public.tenant_store_access_settings USING btree (tenant_id);


--
-- Name: user_billing_addresses_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_billing_addresses_user_id_idx ON public.user_billing_addresses USING btree (user_id);


--
-- Name: profiles block_privileged_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_privileged_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.block_privileged_field_changes();


--
-- Name: product_variants product_variant_stock_change_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_variant_stock_change_trigger AFTER INSERT OR DELETE OR UPDATE OF stock ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_product_out_of_stock_status();


--
-- Name: product_variants product_variants_validate_size; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_variants_validate_size BEFORE INSERT OR UPDATE OF product_id, size_id ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.validate_variant_size_ref();


--
-- Name: products products_validate_taxonomy; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_validate_taxonomy BEFORE INSERT OR UPDATE OF tenant_id, brand_id, model_id ON public.products FOR EACH ROW EXECUTE FUNCTION public.validate_product_taxonomy_refs();


--
-- Name: orders queue_label_created_notification; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_label_created_notification AFTER UPDATE OF label_url, tracking_number ON public.orders FOR EACH ROW EXECUTE FUNCTION public.queue_label_created_notification();


--
-- Name: orders queue_paid_order_confirmation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_paid_order_confirmation AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.queue_paid_order_confirmation();


--
-- Name: square_refunds queue_square_refund_confirmation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER queue_square_refund_confirmation AFTER INSERT OR UPDATE OF status ON public.square_refunds FOR EACH ROW EXECUTE FUNCTION public.queue_square_refund_confirmation();


--
-- Name: featured_items set_featured_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_featured_items_updated_at BEFORE UPDATE ON public.featured_items FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();


--
-- Name: shipping_origins single_shipping_origin_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER single_shipping_origin_trigger BEFORE INSERT ON public.shipping_origins FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_single_shipping_origin();


--
-- Name: tag_aliases tag_aliases_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_aliases_set_updated_at BEFORE UPDATE ON public.tag_aliases FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: tag_brands tag_brands_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_brands_set_updated_at BEFORE UPDATE ON public.tag_brands FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: tag_candidates tag_candidates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_candidates_set_updated_at BEFORE UPDATE ON public.tag_candidates FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: tag_models tag_models_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_models_set_updated_at BEFORE UPDATE ON public.tag_models FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: tag_sizes tag_sizes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tag_sizes_set_updated_at BEFORE UPDATE ON public.tag_sizes FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: chargeback_evidence trg_chargeback_evidence_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_chargeback_evidence_updated_at BEFORE UPDATE ON public.chargeback_evidence FOR EACH ROW EXECUTE FUNCTION public.update_chargeback_evidence_updated_at();


--
-- Name: orders trg_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_orders_updated_at();


--
-- Name: payment_transactions trg_payment_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_transactions_updated_at BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.update_payment_transactions_updated_at();


--
-- Name: product_variants trg_product_variants_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_product_variants_set_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: products trg_products_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: shipping_profiles trg_shipping_profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shipping_profiles_set_updated_at BEFORE UPDATE ON public.shipping_profiles FOR EACH ROW EXECUTE FUNCTION public.rdk_set_updated_at();


--
-- Name: user_addresses trg_user_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_addresses_updated_at BEFORE UPDATE ON public.user_addresses FOR EACH ROW EXECUTE FUNCTION public.update_orders_updated_at();


--
-- Name: orders trigger_set_label_created_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_set_label_created_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_label_created_at();


--
-- Name: orders trigger_update_state_sales_tracking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_state_sales_tracking AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_state_sales_tracking();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shipping_carriers update_shipping_carriers_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shipping_carriers_timestamp BEFORE UPDATE ON public.shipping_carriers FOR EACH ROW EXECUTE FUNCTION public.update_shipping_carriers_updated_at();


--
-- Name: shipping_profiles update_shipping_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shipping_profiles_updated_at BEFORE UPDATE ON public.shipping_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: admin_audit_log admin_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.profiles(id);


--
-- Name: admin_invites admin_invites_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invites
    ADD CONSTRAINT admin_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: admin_invites admin_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_invites
    ADD CONSTRAINT admin_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: chargeback_evidence chargeback_evidence_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chargeback_evidence
    ADD CONSTRAINT chargeback_evidence_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: chargeback_evidence chargeback_evidence_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chargeback_evidence
    ADD CONSTRAINT chargeback_evidence_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: checkout_api_logs checkout_api_logs_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_api_logs
    ADD CONSTRAINT checkout_api_logs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: checkout_notification_outbox checkout_notification_outbox_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_notification_outbox
    ADD CONSTRAINT checkout_notification_outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: checkout_notification_outbox checkout_notification_outbox_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_notification_outbox
    ADD CONSTRAINT checkout_notification_outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contact_messages contact_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: email_audit_log email_audit_log_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_audit_log
    ADD CONSTRAINT email_audit_log_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.checkout_notification_outbox(id) ON DELETE SET NULL;


--
-- Name: email_audit_log email_audit_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_audit_log
    ADD CONSTRAINT email_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: email_audit_log email_audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_audit_log
    ADD CONSTRAINT email_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: featured_items featured_items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_items
    ADD CONSTRAINT featured_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: featured_items featured_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_items
    ADD CONSTRAINT featured_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: featured_items featured_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_items
    ADD CONSTRAINT featured_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: inventory_reservations inventory_reservations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: inventory_reservations inventory_reservations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: inventory_reservations inventory_reservations_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_reservations
    ADD CONSTRAINT inventory_reservations_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT;


--
-- Name: nexus_registrations nexus_registrations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexus_registrations
    ADD CONSTRAINT nexus_registrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: order_access_tokens order_access_tokens_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_access_tokens
    ADD CONSTRAINT order_access_tokens_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_billing order_billing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_billing
    ADD CONSTRAINT order_billing_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: order_shipping order_shipping_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_shipping
    ADD CONSTRAINT order_shipping_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_label_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_label_created_by_fkey FOREIGN KEY (label_created_by) REFERENCES public.profiles(id);


--
-- Name: orders orders_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.sellers(id);


--
-- Name: orders orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: payment_events payment_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: payment_events payment_events_payment_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_transaction_id_fkey FOREIGN KEY (payment_transaction_id) REFERENCES public.payment_transactions(id) ON DELETE CASCADE;


--
-- Name: payment_events payment_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: payment_transactions payment_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: payment_transactions payment_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_size_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_size_id_fkey FOREIGN KEY (size_id) REFERENCES public.tag_sizes(id) ON DELETE RESTRICT;


--
-- Name: product_variants product_variants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.tag_brands(id) ON DELETE RESTRICT;


--
-- Name: products products_model_brand_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_model_brand_fkey FOREIGN KEY (model_id, brand_id) REFERENCES public.tag_models(id, brand_id) ON DELETE RESTRICT;


--
-- Name: products products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: sellers sellers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sellers
    ADD CONSTRAINT sellers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: shipping_profiles shipping_profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_profiles
    ADD CONSTRAINT shipping_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: shipping_profiles shipping_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_profiles
    ADD CONSTRAINT shipping_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: shipping_tracking_events shipping_tracking_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_tracking_events
    ADD CONSTRAINT shipping_tracking_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: shipping_tracking_events shipping_tracking_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_tracking_events
    ADD CONSTRAINT shipping_tracking_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: square_disputes square_disputes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_disputes
    ADD CONSTRAINT square_disputes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: square_disputes square_disputes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_disputes
    ADD CONSTRAINT square_disputes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: square_refunds square_refunds_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_refunds
    ADD CONSTRAINT square_refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: square_refunds square_refunds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.square_refunds
    ADD CONSTRAINT square_refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: state_sales_tracking state_sales_tracking_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.state_sales_tracking
    ADD CONSTRAINT state_sales_tracking_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tag_aliases tag_aliases_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_aliases
    ADD CONSTRAINT tag_aliases_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.tag_brands(id) ON DELETE CASCADE;


--
-- Name: tag_aliases tag_aliases_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_aliases
    ADD CONSTRAINT tag_aliases_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.tag_models(id) ON DELETE CASCADE;


--
-- Name: tag_aliases tag_aliases_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_aliases
    ADD CONSTRAINT tag_aliases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tag_brands tag_brands_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_brands
    ADD CONSTRAINT tag_brands_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tag_candidates tag_candidates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_candidates
    ADD CONSTRAINT tag_candidates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: tag_candidates tag_candidates_parent_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_candidates
    ADD CONSTRAINT tag_candidates_parent_brand_id_fkey FOREIGN KEY (parent_brand_id) REFERENCES public.tag_brands(id) ON DELETE RESTRICT;


--
-- Name: tag_candidates tag_candidates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_candidates
    ADD CONSTRAINT tag_candidates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tag_models tag_models_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_models
    ADD CONSTRAINT tag_models_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.tag_brands(id) ON DELETE RESTRICT;


--
-- Name: tag_models tag_models_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_models
    ADD CONSTRAINT tag_models_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tag_sizes tag_sizes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tag_sizes
    ADD CONSTRAINT tag_sizes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_checkout_settings tenant_checkout_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_checkout_settings
    ADD CONSTRAINT tenant_checkout_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_store_access_settings tenant_store_access_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_store_access_settings
    ADD CONSTRAINT tenant_store_access_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_tax_settings tenant_tax_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tax_settings
    ADD CONSTRAINT tenant_tax_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: transaction_audit_log transaction_audit_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: transaction_audit_log transaction_audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: user_addresses user_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_billing_addresses user_billing_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_billing_addresses
    ADD CONSTRAINT user_billing_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_carriers Admin can manage shipping carriers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage shipping carriers" ON public.shipping_carriers TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text]))))));


--
-- Name: tenant_checkout_settings Admins can manage checkout settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage checkout settings" ON public.tenant_checkout_settings TO authenticated USING (public.is_admin_for_tenant(tenant_id)) WITH CHECK (public.is_admin_for_tenant(tenant_id));


--
-- Name: featured_items Admins can manage featured items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage featured items" ON public.featured_items USING ((auth.uid() IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text]))))) WITH CHECK ((auth.uid() IN ( SELECT profiles.id
   FROM public.profiles
  WHERE (profiles.role = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text])))));


--
-- Name: product_images Admins can manage images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage images" ON public.product_images TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: nexus_registrations Admins can manage nexus registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage nexus registrations" ON public.nexus_registrations USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: products Admins can manage products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage products" ON public.products TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: tenant_store_access_settings Admins can manage store access settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage store access settings" ON public.tenant_store_access_settings USING (public.is_admin_for_tenant(tenant_id)) WITH CHECK (public.is_admin_for_tenant(tenant_id));


--
-- Name: tag_aliases Admins can manage tag aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage tag aliases" ON public.tag_aliases USING ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin()))) WITH CHECK ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin())));


--
-- Name: tag_brands Admins can manage tag brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage tag brands" ON public.tag_brands USING ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin()))) WITH CHECK ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin())));


--
-- Name: tag_candidates Admins can manage tag candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage tag candidates" ON public.tag_candidates USING (public.is_admin_for_tenant(tenant_id)) WITH CHECK (public.is_admin_for_tenant(tenant_id));


--
-- Name: tag_models Admins can manage tag models; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage tag models" ON public.tag_models USING ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin()))) WITH CHECK ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin())));


--
-- Name: tag_sizes Admins can manage tag sizes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage tag sizes" ON public.tag_sizes USING ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin()))) WITH CHECK ((public.is_admin_for_tenant(tenant_id) OR ((tenant_id IS NULL) AND public.is_admin())));


--
-- Name: tenant_tax_settings Admins can manage tax settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage tax settings" ON public.tenant_tax_settings USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: product_variants Admins can manage variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage variants" ON public.product_variants TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: payment_events Admins can read own tenant payment_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read own tenant payment_events" ON public.payment_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'staff'::text])) AND ((payment_events.tenant_id IS NULL) OR (profiles.tenant_id = payment_events.tenant_id))))));


--
-- Name: payment_transactions Admins can read own tenant payment_transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read own tenant payment_transactions" ON public.payment_transactions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'staff'::text])) AND ((payment_transactions.tenant_id IS NULL) OR (profiles.tenant_id = payment_transactions.tenant_id))))));


--
-- Name: state_sales_tracking Admins can view state sales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view state sales" ON public.state_sales_tracking FOR SELECT USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: shipping_origins Allow admin full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admin full access" ON public.shipping_origins TO authenticated USING ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text]))) WITH CHECK ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text])));


--
-- Name: contact_messages Allow admin read contact messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow admin read contact messages" ON public.contact_messages FOR SELECT USING (public.is_admin());


--
-- Name: contact_messages Allow contact message inserts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow contact message inserts" ON public.contact_messages FOR INSERT WITH CHECK (true);


--
-- Name: tenants Allow service role to read tenants for signup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow service role to read tenants for signup" ON public.tenants FOR SELECT TO service_role USING (true);


--
-- Name: admin_invites Devs can create invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Devs can create invites" ON public.admin_invites FOR INSERT WITH CHECK (((created_by = auth.uid()) AND public.is_dev() AND (role = ANY (ARRAY['admin'::text, 'super_admin'::text]))));


--
-- Name: featured_items Featured items are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Featured items are viewable by everyone" ON public.featured_items FOR SELECT USING (true);


--
-- Name: admin_invites Privileged admins can view invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Privileged admins can view invites" ON public.admin_invites FOR SELECT USING (public.is_super_admin());


--
-- Name: products Public can view active products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active products" ON public.products FOR SELECT USING ((is_active = true));


--
-- Name: tag_aliases Public can view active tag aliases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active tag aliases" ON public.tag_aliases FOR SELECT USING ((is_active = true));


--
-- Name: tag_brands Public can view active tag brands; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active tag brands" ON public.tag_brands FOR SELECT USING ((is_active = true));


--
-- Name: tag_models Public can view active tag models; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active tag models" ON public.tag_models FOR SELECT USING ((is_active = true));


--
-- Name: tag_sizes Public can view active tag sizes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view active tag sizes" ON public.tag_sizes FOR SELECT USING ((is_active = true));


--
-- Name: product_images Public can view images of active products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view images of active products" ON public.product_images FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_images.product_id) AND (p.is_active = true)))));


--
-- Name: product_variants Public can view variants of active products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view variants of active products" ON public.product_variants FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND (p.is_active = true)))));


--
-- Name: tenants Service role can manage tenants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage tenants" ON public.tenants TO service_role USING (true) WITH CHECK (true);


--
-- Name: checkout_api_logs Service role only: checkout api logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role only: checkout api logs" ON public.checkout_api_logs USING ((auth.role() = 'service_role'::text));


--
-- Name: tax_rate_cache Service role only: tax rate cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role only: tax rate cache" ON public.tax_rate_cache AS RESTRICTIVE TO authenticated USING (false);


--
-- Name: user_billing_addresses Staff can view all billing addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view all billing addresses" ON public.user_billing_addresses FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'staff'::text]))))));


--
-- Name: order_billing Staff can view all order billing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view all order billing" ON public.order_billing FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'staff'::text]))))));


--
-- Name: products Tenant admins can delete products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can delete products" ON public.products FOR DELETE USING (public.is_admin_for_tenant(tenant_id));


--
-- Name: products Tenant admins can insert products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can insert products" ON public.products FOR INSERT WITH CHECK (public.is_admin_for_tenant(tenant_id));


--
-- Name: product_images Tenant admins can manage images via product; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can manage images via product" ON public.product_images USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_images.product_id) AND public.is_admin_for_tenant(p.tenant_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_images.product_id) AND public.is_admin_for_tenant(p.tenant_id)))));


--
-- Name: product_variants Tenant admins can manage variants via product; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can manage variants via product" ON public.product_variants USING ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND public.is_admin_for_tenant(p.tenant_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.products p
  WHERE ((p.id = product_variants.product_id) AND public.is_admin_for_tenant(p.tenant_id)))));


--
-- Name: products Tenant admins can update products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can update products" ON public.products FOR UPDATE USING (public.is_admin_for_tenant(tenant_id)) WITH CHECK (public.is_admin_for_tenant(tenant_id));


--
-- Name: email_audit_log Tenant admins can view email audit log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant admins can view email audit log" ON public.email_audit_log FOR SELECT TO authenticated USING (public.is_admin_for_tenant(tenant_id));


--
-- Name: transaction_audit_log Tenant staff can view audit log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant staff can view audit log" ON public.transaction_audit_log FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: chargeback_evidence Tenant staff can view chargeback evidence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant staff can view chargeback evidence" ON public.chargeback_evidence FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: shipping_tracking_events Tenant staff can view shipping tracking events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant staff can view shipping tracking events" ON public.shipping_tracking_events FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: user_billing_addresses Users can delete their own billing addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own billing addresses" ON public.user_billing_addresses FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: shipping_profiles Users can insert own shipping profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own shipping profile" ON public.shipping_profiles FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_billing_addresses Users can insert their own billing addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own billing addresses" ON public.user_billing_addresses FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_addresses Users can manage own addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage own addresses" ON public.user_addresses USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: shipping_profiles Users can update own shipping profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own shipping profile" ON public.shipping_profiles FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_billing_addresses Users can update their own billing addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own billing addresses" ON public.user_billing_addresses FOR UPDATE USING ((auth.uid() = user_id));


--
-- Name: order_items Users can view own order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own order items" ON public.order_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_items.order_id) AND (orders.user_id = auth.uid())))));


--
-- Name: order_shipping Users can view own order shipping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own order shipping" ON public.order_shipping FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_shipping.order_id) AND (orders.user_id = auth.uid())))));


--
-- Name: orders Users can view own orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: shipping_profiles Users can view own shipping profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own shipping profile" ON public.shipping_profiles FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_billing_addresses Users can view their own billing addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own billing addresses" ON public.user_billing_addresses FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: order_billing Users can view their own order billing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own order billing" ON public.order_billing FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_billing.order_id) AND (orders.user_id = auth.uid())))));


--
-- Name: tenants Users can view their own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own tenant" ON public.tenants FOR SELECT TO authenticated USING ((id IN ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: admin_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_audit_log admin_full_auditlog; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_auditlog ON public.admin_audit_log TO authenticated USING (public.is_admin());


--
-- Name: order_events admin_full_order_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_order_events ON public.order_events TO authenticated USING ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text]))) WITH CHECK ((( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'super_admin'::text, 'dev'::text])));


--
-- Name: order_items admin_full_order_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_order_items ON public.order_items TO authenticated USING (public.is_admin());


--
-- Name: order_shipping admin_full_order_shipping; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_order_shipping ON public.order_shipping TO authenticated USING (public.is_admin());


--
-- Name: orders admin_full_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_orders ON public.orders TO authenticated USING (public.is_admin());


--
-- Name: products admin_full_products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_products ON public.products TO authenticated USING (public.is_admin());


--
-- Name: shipping_defaults admin_full_shipping_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_shipping_defaults ON public.shipping_defaults TO authenticated USING (public.is_admin());


--
-- Name: admin_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_notification_outbox admins_read_tenant_checkout_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_read_tenant_checkout_notifications ON public.checkout_notification_outbox FOR SELECT TO authenticated USING (public.is_admin_for_tenant(tenant_id));


--
-- Name: square_disputes admins_read_tenant_square_disputes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_read_tenant_square_disputes ON public.square_disputes FOR SELECT TO authenticated USING (public.is_admin_for_tenant(tenant_id));


--
-- Name: square_refunds admins_read_tenant_square_refunds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_read_tenant_square_refunds ON public.square_refunds FOR SELECT TO authenticated USING (public.is_admin_for_tenant(tenant_id));


--
-- Name: chargeback_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chargeback_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_api_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkout_api_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: checkout_notification_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkout_notification_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: orders customer_rw_own_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_rw_own_orders ON public.orders TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: email_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: email_subscribers email_subscribers_insert_anyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_subscribers_insert_anyone ON public.email_subscribers FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: email_subscription_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_subscription_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: featured_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.featured_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: nexus_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexus_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: order_access_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_access_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: order_billing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_billing ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_shipping; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_shipping ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: product_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: profiles profiles_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: sellers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_carriers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_carriers ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_origins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_origins ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_tracking_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_tracking_events ENABLE ROW LEVEL SECURITY;

--
-- Name: square_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.square_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: square_refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.square_refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: square_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.square_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: state_sales_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.state_sales_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_brands ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_models; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_models ENABLE ROW LEVEL SECURITY;

--
-- Name: tag_sizes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tag_sizes ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_rate_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_rate_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_checkout_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_checkout_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_store_access_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_store_access_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_tax_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_tax_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: user_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: user_billing_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_billing_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: order_events users_select_own_order_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own_order_events ON public.order_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = order_events.order_id) AND (orders.user_id = auth.uid())))));


--
-- PostgreSQL database dump complete
--

\unrestrict SoleAnalyticsLocalSchemaOnly
