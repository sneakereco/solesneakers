begin;

create table public.checkout_operational_controls (
  singleton boolean primary key default true check (singleton),
  pause_new_checkouts boolean not null default false,
  pause_payment_dispatch boolean not null default false
);
insert into public.checkout_operational_controls default values;
alter table public.checkout_operational_controls enable row level security;
revoke all on public.checkout_operational_controls from public, anon, authenticated, service_role;
grant select, update (pause_new_checkouts, pause_payment_dispatch) on public.checkout_operational_controls to service_role;

-- Only a new guarded INSERT allocates inventory. Existing-key reuse and observation
-- never reach this trigger. The switch writer serializes against the allocation commit.
create function checkout_attempt_private.check_new_allocation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.checkout_operational_controls
                 where singleton and not pause_new_checkouts for share) then
    raise exception 'checkout_allocation_paused';
  end if;
  return new;
end;
$$;
create trigger guard_new_checkout_allocation before insert on public.orders
for each row when (new.checkout_attempt_guarded) execute function checkout_attempt_private.check_new_allocation();

create index checkout_dispatched_order_time on public.checkout_payment_attempts(order_id, dispatched_at desc) where dispatched_at is not null;
create index checkout_attempt_owner on public.checkout_payment_attempts(owner_key,id);
create index checkout_decline_history on public.checkout_payment_attempt_history(attempt_id, recorded_at desc)
where state='declined' and verified_facts->>'kind' in ('square_payment','square_decline');

-- Positive delays are computed from actual claim times and confirmed facts. A late
-- verified FAILED starts its hour when recorded. Terminal capture/history replay
-- cannot increase the count, and canceled/unused methods never count as declines.
create function public.checkout_financial_admission(p_order_id uuid,p_shopper_binding text,p_kind text)
returns integer language plpgsql security definer set search_path='' as $$
declare
  o public.orders;
  checked_at timestamptz:=clock_timestamp();
  order_until timestamptz;
  shopper_until timestamptz;
begin
  select * into strict o from public.orders where id=p_order_id;
  if p_kind is null or p_kind not in ('gateway_attempt','decline') or
     p_shopper_binding is distinct from checkout_attempt_private.owner_key(o,p_shopper_binding)
     then raise exception 'invalid_admission_binding'; end if;
  if p_kind='gateway_attempt' then
    select dispatched_at + interval '30 minutes' into order_until
    from public.checkout_payment_attempts where order_id=o.id and dispatched_at>checked_at-interval '30 minutes'
    order by dispatched_at desc offset 2 limit 1;
  end if;
  select first_decline + interval '1 hour' into shopper_until from (
    select min(h.recorded_at) first_decline
    from public.checkout_payment_attempts a join public.checkout_payment_attempt_history h on h.attempt_id=a.id
    where a.owner_key=p_shopper_binding and h.state='declined'
      and h.verified_facts->>'kind' in ('square_payment','square_decline')
      and h.recorded_at>checked_at-interval '1 hour'
    group by a.id
  ) confirmed order by first_decline desc offset (case when p_kind='decline' then 5 else 4 end) limit 1;
  return greatest(0,ceil(extract(epoch from greatest(order_until,shopper_until)-checked_at))::integer);
end;
$$;
revoke all on function public.checkout_financial_admission(uuid,text,text) from public, anon, authenticated;
grant execute on function public.checkout_financial_admission(uuid,text,text) to service_role;

create or replace function public.begin_checkout_payment_dispatch(p_attempt_id uuid,p_owner_binding text,p_request_digest text,p_source_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  a public.checkout_payment_attempts;
begin
  select orders.* into o from public.orders orders where orders.id=(
    select order_id from public.checkout_payment_attempts where id=p_attempt_id) for update;
  perform checkout_attempt_private.owner_key(o,p_owner_binding);
  select * into strict a from public.checkout_payment_attempts where id=p_attempt_id and order_id=o.id for update;
  if a.state <> 'ready' then return jsonb_build_object('kind','observe','attempt',checkout_attempt_private.dto(a)); end if;
  if p_request_digest is null or p_source_digest is null or
     p_request_digest !~ '^[0-9a-f]{64}$' or p_source_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_dispatch_digest'; end if;
  if not exists (select 1 from public.checkout_operational_controls
                 where singleton and not pause_payment_dispatch for share) then
    raise exception 'checkout_dispatch_paused';
  end if;
  if public.checkout_financial_admission(o.id,a.owner_key,'gateway_attempt') > 0 then
    raise exception 'checkout_gateway_limited';
  end if;
  perform checkout_attempt_private.require_payable(o,a);
  update public.checkout_payment_attempts set state='dispatch_started',reason='dispatch_claimed',
    dispatched_at=clock_timestamp(),updated_at=clock_timestamp(),request_digest=p_request_digest,source_digest=p_source_digest
    where id=a.id returning * into a;
  insert into public.checkout_payment_attempt_history(attempt_id,state,reason) values(a.id,a.state,a.reason);
  perform public.enqueue_checkout_recovery('reconcile_payment','payment_attempt:' || a.id,clock_timestamp(),'dispatch_claimed',o.id);
  return jsonb_build_object('kind','dispatch','attempt',checkout_attempt_private.dto(a));
end;
$$;

create table public.checkout_worker_heartbeats (
  worker text primary key check (worker in ('recovery','mail')),
  completed_at timestamptz not null
);
alter table public.checkout_worker_heartbeats enable row level security;
revoke all on public.checkout_worker_heartbeats from public, anon, authenticated, service_role;
grant select, insert, update on public.checkout_worker_heartbeats to service_role;

create function public.record_checkout_worker_heartbeat(p_worker text) returns void
language sql security invoker set search_path = '' as $$
  insert into public.checkout_worker_heartbeats(worker,completed_at) values(p_worker,clock_timestamp())
  on conflict(worker) do update set completed_at=greatest(excluded.completed_at,checkout_worker_heartbeats.completed_at);
$$;

-- finish_checkout_mail retains its boolean API. Its row lock lasts until this
-- transaction ends, so a stale token cannot read a later sender's disposition.
create function public.finish_checkout_mail_disposition(
  p_id uuid,p_token uuid,p_outcome text,p_reply integer default null,p_phase text default null
) returns text language plpgsql security invoker set search_path = '' as $$
begin
  if not public.finish_checkout_mail(p_id,p_token,p_outcome,p_reply,p_phase) then return null; end if;
  return (select status from public.checkout_notification_outbox where id=p_id);
end;
$$;

-- One MVCC snapshot; no provider requests, queue claims, or raw query text.
create function public.read_checkout_health() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with observed as (select statement_timestamp() as t), reviews as (
    select order_id, next_attempt_at as since from public.checkout_recovery_jobs where status='review'
    union all select order_id, updated_at from public.checkout_notification_outbox where status='review'
    union all select id, created_at from public.orders where checkout_financial_review is not null
  ), first_unknown as (
    select order_id, coalesce(dispatched_at,created_at) since from public.checkout_payment_attempts
    where state in ('dispatch_started','unknown') order by since,id limit 1
  ), first_pending as (
    select order_id, coalesce(dispatched_at,created_at) since from public.checkout_payment_attempts
    where state='pending' order by since,id limit 1
  ), first_hold as (
    select order_id,expires_at from public.inventory_reservations,observed
    where status='active' and expires_at<=t order by expires_at,id limit 1
  ), first_bound_due as (
    select order_id,next_attempt_at from public.checkout_recovery_jobs,observed
    where status='pending' and next_attempt_at<=t and order_id is not null order by next_attempt_at,id limit 1
  ), first_mail as (
    select order_id,created_at from public.checkout_notification_outbox where status<>'sent' order by created_at,id limit 1
  ), first_expired_bound as (
    select order_id from (
      select order_id,lease_expires_at,id from public.checkout_recovery_jobs,observed
      where order_id is not null and lease_expires_at<=t
      union all select order_id,lease_expires_at,id from public.checkout_notification_outbox,observed where lease_expires_at<=t
    ) expired order by lease_expires_at,id limit 1
  ), jobs as (
    select count(*) as depth,min(next_attempt_at) filter(where status='pending' and next_attempt_at<=t) as due,
      count(*) filter(where lease_expires_at<=t) as expired
    from public.checkout_recovery_jobs, observed where status in ('pending','review')
  ), mail as (
    select count(*) as depth,count(*) filter(where lease_expires_at<=t) as expired
    from public.checkout_notification_outbox, observed where status<>'sent'
  ), slots as (
    select count(*) filter(where dependency='square' and lease_expires_at>t) as square,
      count(*) filter(where dependency='shippo' and lease_expires_at>t) as shippo,
      count(*) filter(where dependency='smtp' and lease_expires_at>t) as smtp,
      count(*) filter(where lease_expires_at<=t) as expired from public.checkout_dependency_leases,observed
  )
  select jsonb_build_object(
    'observedAt',t,'recoveryLastSeenAt',(select completed_at from public.checkout_worker_heartbeats where worker='recovery'),
    'mailLastSeenAt',(select completed_at from public.checkout_worker_heartbeats where worker='mail'),
    'oldestPendingMs',greatest(0,floor(1000*extract(epoch from t-(select since from first_pending)))),
    'oldestUnknownMs',greatest(0,floor(1000*extract(epoch from t-(select since from first_unknown)))),
    'oldestDueMs',greatest(0,floor(1000*extract(epoch from t-jobs.due))),
    'expiredHoldLagMs',greatest(0,floor(1000*extract(epoch from t-(select expires_at from first_hold)))),
    'oldestNotificationMs',greatest(0,floor(1000*extract(epoch from t-(select created_at from first_mail)))),
    'webhookLagMs',greatest(0,floor(1000*extract(epoch from t-(select min(received_at) from public.square_webhook_events where processed_at is null)))),
    'oldestOrderBoundDueMs',greatest(0,floor(1000*extract(epoch from t-(select next_attempt_at from first_bound_due)))),
    'alertOrderIds',jsonb_strip_nulls(jsonb_build_object(
      'old_unknown',(select order_id from first_unknown),'old_pending',(select order_id from first_pending),
      'overdue_hold',(select order_id from first_hold),'overdue_recovery',(select order_id from first_bound_due),
      'overdue_mail',(select order_id from first_mail),'expired_lease',(select order_id from first_expired_bound)
    )),
    'queueDepth',jobs.depth,'notificationDepth',mail.depth,'reviewCount',(select count(*) from reviews),
    'reviewOrderId',(select order_id from reviews where order_id is not null order by since,order_id limit 1),
    'squareLeases',slots.square,'shippoLeases',slots.shippo,'smtpLeases',slots.smtp,
    'expiredLeases',slots.expired+jobs.expired+mail.expired,
    'activeConnections',(select sum(numbackends) from pg_catalog.pg_stat_database),
    'maxConnections',current_setting('max_connections')::int,
    'waitingLocks',(select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid where not l.granted and a.datname=current_database()),
    'pauseNewCheckouts',c.pause_new_checkouts,'pausePaymentDispatch',c.pause_payment_dispatch)
  from observed,jobs,mail,slots,public.checkout_operational_controls c where c.singleton;
$$;

revoke all on function public.record_checkout_worker_heartbeat(text), public.read_checkout_health(),
  public.finish_checkout_mail_disposition(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.record_checkout_worker_heartbeat(text), public.read_checkout_health(),
  public.finish_checkout_mail_disposition(uuid,uuid,text,integer,text) to service_role;
commit;
