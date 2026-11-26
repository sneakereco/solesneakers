begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table public.specialty_claim_status_audit (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.specialty_claims(id) on delete cascade,
  previous_status text not null check (previous_status in ('new','contacted','fulfilled')),
  new_status text not null check (new_status in ('new','contacted','fulfilled')),
  revision bigint not null check (revision > 1),
  actor_id uuid not null references auth.users(id),
  changed_at timestamptz not null default clock_timestamp(),
  unique(claim_id,revision)
);
alter table public.specialty_claim_status_audit enable row level security;
revoke all on public.specialty_claim_status_audit from public,anon,authenticated,service_role;
grant select on public.specialty_claim_status_audit to service_role;
create index specialty_claim_status_filter_idx on public.specialty_claims(campaign_id,follow_up_status,accepted_at desc,id);

create function public.update_specialty_claim_status(
  p_claim_id uuid,p_status text,p_expected_revision bigint,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '2s' set statement_timeout = '5s' as $$
declare v_claim public.specialty_claims%rowtype; v_previous text;
begin
  if p_actor_id is null then raise exception 'specialty_admin_required'; end if;
  if p_status is null or p_status not in ('new','contacted','fulfilled') then raise exception 'specialty_invalid_status'; end if;
  select * into v_claim from public.specialty_claims where id=p_claim_id for update;
  if not found then raise exception 'specialty_claim_missing'; end if;
  if p_expected_revision is null or v_claim.revision <> p_expected_revision then raise exception 'specialty_revision_conflict'; end if;
  if v_claim.follow_up_status <> p_status then
    v_previous := v_claim.follow_up_status;
    update public.specialty_claims set follow_up_status=p_status,revision=revision+1,
      updated_by=p_actor_id,updated_at=clock_timestamp()
      where id=p_claim_id returning * into v_claim;
    insert into public.specialty_claim_status_audit(claim_id,previous_status,new_status,revision,actor_id,changed_at)
      values(p_claim_id,v_previous,p_status,v_claim.revision,p_actor_id,v_claim.updated_at);
  end if;
  return to_jsonb(v_claim)-'address_key'-'instagram_key'-'campaign_id'-'variant_id';
end;
$$;
revoke all on function public.update_specialty_claim_status(uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.update_specialty_claim_status(uuid,text,bigint,uuid) to service_role;
commit;
