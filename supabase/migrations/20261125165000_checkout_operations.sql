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

commit;
