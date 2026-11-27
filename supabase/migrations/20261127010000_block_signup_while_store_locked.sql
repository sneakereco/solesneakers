-- Enforce the lock at Auth's insert boundary as well as the website endpoint.
-- Existing user updates and staff sign-in do not insert auth.users rows.
create or replace function public.guard_registration_while_store_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_locked boolean;
begin
  select coalesce(settings.site_lock_enabled, false)
    and (settings.site_unlock_at is null or settings.site_unlock_at > statement_timestamp())
  into v_locked
  from public.tenants as tenant
  left join public.tenant_store_access_settings as settings on settings.tenant_id = tenant.id
  order by tenant.created_at, tenant.id
  limit 1;

  if coalesce(v_locked, false) then
    raise exception using
      errcode = 'P0001',
      message = 'Customer registration is unavailable while the storefront is locked.';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_registration_while_store_locked()
  from public, anon, authenticated;
grant execute on function public.guard_registration_while_store_locked()
  to supabase_auth_admin;

create trigger guard_registration_while_store_locked
  before insert on auth.users
  for each row execute function public.guard_registration_while_store_locked();
