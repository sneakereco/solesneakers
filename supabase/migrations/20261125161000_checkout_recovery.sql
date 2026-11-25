begin;

-- Reuse the existing event identity, hash and processing timestamp for legacy
-- deduplication. Only receipts created by the new RPC carry this marker.
alter table public.square_webhook_events
  add column recovery_receipt boolean not null default false;

create index square_webhook_events_unprocessed_receipt_idx
  on public.square_webhook_events (received_at, square_event_id)
  where recovery_receipt and processed_at is null;

create table public.checkout_recovery_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reconcile_payment', 'expire_reservation', 'square_event')),
  unique_key text not null check (char_length(unique_key) between 1 and 256),
  order_id uuid references public.orders(id),
  event_id text unique references public.square_webhook_events(square_event_id),
  status text not null default 'pending' check (status in ('pending', 'done', 'review')),
  next_attempt_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  reason text check (reason ~ '^[a-z][a-z0-9_]{0,79}$'),
  check (
    (kind = 'square_event' and event_id is not null and order_id is null)
    or (kind <> 'square_event' and order_id is not null and event_id is null)
  ),
  check ((lease_token is null) = (lease_expires_at is null)),
  check (status = 'pending' or lease_token is null)
);

-- Review is an outstanding obligation. A sweeper must not reset it as pending.
create unique index checkout_recovery_jobs_active_key
  on public.checkout_recovery_jobs (unique_key)
  where status in ('pending', 'review');

create index checkout_recovery_jobs_due_idx
  on public.checkout_recovery_jobs (next_attempt_at, id)
  where status = 'pending';

create index checkout_recovery_jobs_lease_expiry_idx
  on public.checkout_recovery_jobs (lease_expires_at, id)
  where status = 'pending' and lease_expires_at is not null;

create table public.checkout_dependency_leases (
  dependency text not null check (dependency in ('square', 'shippo', 'smtp')),
  slot smallint not null check (slot between 1 and 4),
  lease_token uuid unique,
  lease_expires_at timestamptz,
  primary key (dependency, slot),
  check ((lease_token is null) = (lease_expires_at is null))
);

create index checkout_dependency_leases_expiry_idx
  on public.checkout_dependency_leases (lease_expires_at)
  where lease_expires_at is not null;

insert into public.checkout_dependency_leases (dependency, slot)
select dependency, slot
from unnest(array['square', 'shippo', 'smtp']) as dependencies(dependency)
cross join generate_series(1, 4) as slots(slot);

alter table public.checkout_recovery_jobs enable row level security;
alter table public.checkout_dependency_leases enable row level security;

revoke all on table public.checkout_recovery_jobs, public.checkout_dependency_leases,
  public.square_webhook_events from public, anon, authenticated;
revoke all on table public.checkout_recovery_jobs, public.checkout_dependency_leases
  from service_role;
grant select, insert, update on table public.checkout_recovery_jobs to service_role;
grant select, update on table public.checkout_dependency_leases to service_role;

create function public.enqueue_checkout_recovery(
  p_kind text,
  p_unique_key text,
  p_due_at timestamptz,
  p_reason text default null,
  p_order_id uuid default null,
  p_event_id text default null
) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('reconcile_payment', 'expire_reservation', 'square_event')
    or p_unique_key is null or btrim(p_unique_key) = '' or char_length(p_unique_key) > 256
    or p_due_at is null or not isfinite(p_due_at)
    or (p_reason is not null and p_reason !~ '^[a-z][a-z0-9_]{0,79}$')
    or (p_kind = 'square_event' and (
      p_order_id is not null or p_event_id is null or p_event_id !~ '^[A-Za-z0-9._:=+-]{1,128}$'
    ))
    or (p_kind <> 'square_event' and (p_order_id is null or p_event_id is not null)) then
    raise exception 'Invalid checkout recovery work' using errcode = '22023';
  end if;

  if p_kind = 'square_event' and exists (
    select 1 from public.square_webhook_events
    where square_event_id = p_event_id and processed_at is not null
  ) then
    return;
  end if;

  insert into public.checkout_recovery_jobs (kind, unique_key, order_id, event_id, next_attempt_at, reason)
  values (p_kind, p_unique_key, p_order_id, p_event_id, p_due_at, p_reason)
  on conflict do nothing;
end;
$$;

create function public.claim_checkout_recovery(
  p_limit integer, p_lease_seconds integer, p_now timestamptz
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  claim_time timestamptz := clock_timestamp();
  jobs jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 or
    p_lease_seconds is null or p_lease_seconds not between 1 and 120 or
    p_now is null or not isfinite(p_now) then
    raise exception 'Invalid checkout recovery claim' using errcode = '22023';
  end if;

  -- The database clock bounds due eligibility and exclusively controls lease age.
  with candidates as (
    select id from public.checkout_recovery_jobs
    where status = 'pending' and next_attempt_at <= least(p_now, claim_time)
      and (lease_expires_at is null or lease_expires_at <= claim_time)
    order by next_attempt_at, id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.checkout_recovery_jobs as job
    set lease_token = gen_random_uuid(),
        lease_expires_at = claim_time + make_interval(secs => p_lease_seconds),
        attempts = job.attempts + 1
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'orderId', order_id, 'eventId', event_id,
    'leaseToken', lease_token, 'attempts', attempts
  ) order by next_attempt_at, id), '[]'::jsonb)
  into jobs from claimed;
  return jobs;
end;
$$;

create function public.finish_checkout_recovery(
  p_id uuid,
  p_lease_token uuid,
  p_result text,
  p_next_attempt_at timestamptz default null,
  p_reason text default null
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  held_until timestamptz;
  finish_time timestamptz;
begin
  select lease_expires_at into held_until
  from public.checkout_recovery_jobs
  where id = p_id and status = 'pending' and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp()
  for update;

  finish_time := clock_timestamp();
  if not found or held_until <= finish_time then return false; end if;

  if p_result is null or p_result not in ('done', 'retry', 'review') or
    (p_reason is not null and p_reason !~ '^[a-z][a-z0-9_]{0,79}$') or
    (p_result = 'retry' and (
      p_next_attempt_at is null or not isfinite(p_next_attempt_at) or p_next_attempt_at <= finish_time
    )) then
    raise exception 'Invalid checkout recovery completion' using errcode = '22023';
  end if;

  update public.checkout_recovery_jobs
  set status = case when p_result = 'retry' then 'pending' else p_result end,
      next_attempt_at = case when p_result = 'retry' then p_next_attempt_at else next_attempt_at end,
      reason = p_reason,
      lease_token = null,
      lease_expires_at = null
  where id = p_id and status = 'pending' and lease_token = p_lease_token;
  return found;
end;
$$;

create function public.acquire_checkout_dependency_lease(
  p_dependency text, p_limit integer, p_lease_seconds integer
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  claim_time timestamptz := clock_timestamp();
  claimed_token uuid;
begin
  if p_dependency is null or p_dependency not in ('square', 'shippo', 'smtp') or
    p_limit is null or p_limit not between 1 and 4 or
    p_lease_seconds is null or p_lease_seconds not between 1 and 120 then
    raise exception 'Invalid checkout dependency lease' using errcode = '22023';
  end if;

  -- Each dependency has four permanent slots. Row locks protect ownership under
  -- overlapping invocations without a count-then-insert race.
  with available as (
    select dependency, slot from public.checkout_dependency_leases
    where dependency = p_dependency and slot <= p_limit
      and (lease_expires_at is null or lease_expires_at <= claim_time)
    order by slot
    limit 1
    for update skip locked
  )
  update public.checkout_dependency_leases as lease
  set lease_token = gen_random_uuid(),
      lease_expires_at = claim_time + make_interval(secs => p_lease_seconds)
  from available
  where lease.dependency = available.dependency and lease.slot = available.slot
  returning lease.lease_token into claimed_token;
  return claimed_token;
end;
$$;

create function public.release_checkout_dependency_lease(p_token uuid)
returns void language sql security invoker set search_path = ''
as $$
  update public.checkout_dependency_leases
  set lease_token = null, lease_expires_at = null
  where lease_token = p_token;
$$;

create function public.receive_checkout_square_event(
  p_event_id text, p_kind text, p_payload_hash text, p_payload jsonb
) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9._:=+-]{1,128}$'
    or p_kind is null or p_kind not in (
      'payment.created', 'payment.updated', 'refund.created', 'refund.updated',
      'dispute.created', 'dispute.state.updated'
    )
    or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 2048 then
    raise exception 'Invalid Square receipt payload' using errcode = '22023';
  end if;

  if not (p_payload ?& array['merchantId', 'locationId', 'createdAt', 'paymentId'])
    or (p_kind like 'refund.%') <> (p_payload ? 'refundId')
    or (p_kind like 'dispute.%') <> (p_payload ? 'disputeId')
    or exists (
      select 1 from jsonb_each(p_payload) as field(key, value)
      where jsonb_typeof(field.value) <> 'string'
        or field.key not in ('merchantId', 'locationId', 'createdAt', 'paymentId', 'squareOrderId', 'refundId', 'disputeId')
        or (field.key <> 'createdAt' and (field.value #>> '{}') !~ '^[A-Za-z0-9._:=+-]{1,128}$')
    )
    or p_payload->>'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,9})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or not pg_input_is_valid(p_payload->>'createdAt', 'timestamp with time zone') then
    raise exception 'Invalid Square receipt payload' using errcode = '22023';
  end if;

  insert into public.square_webhook_events (
    square_event_id, event_type, merchant_id, location_id, square_created_at,
    payload_sha256, event_data, recovery_receipt
  ) values (
    p_event_id, p_kind, p_payload->>'merchantId', p_payload->>'locationId',
    (p_payload->>'createdAt')::timestamptz, p_payload_hash, p_payload, true
  )
  on conflict (square_event_id) do nothing;
  if not found then return 'duplicate'; end if;

  perform public.enqueue_checkout_recovery(
    'square_event', 'square_event:' || p_event_id, clock_timestamp(), p_event_id => p_event_id
  );
  if not exists (select 1 from public.checkout_recovery_jobs where event_id = p_event_id) then
    raise exception 'Square receipt recovery key conflicts' using errcode = '23505';
  end if;
  return 'stored';
end;
$$;

revoke all on function
  public.enqueue_checkout_recovery(text, text, timestamptz, text, uuid, text),
  public.claim_checkout_recovery(integer, integer, timestamptz),
  public.finish_checkout_recovery(uuid, uuid, text, timestamptz, text),
  public.acquire_checkout_dependency_lease(text, integer, integer),
  public.release_checkout_dependency_lease(uuid),
  public.receive_checkout_square_event(text, text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.enqueue_checkout_recovery(text, text, timestamptz, text, uuid, text),
  public.claim_checkout_recovery(integer, integer, timestamptz),
  public.finish_checkout_recovery(uuid, uuid, text, timestamptz, text),
  public.acquire_checkout_dependency_lease(text, integer, integer),
  public.release_checkout_dependency_lease(uuid),
  public.receive_checkout_square_event(text, text, text, jsonb)
to service_role;

commit;
