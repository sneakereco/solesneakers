begin;
-- The disposable test routine has no business behavior and is never fired.
create function analytics_reporting.fixture_noop() returns trigger
language plpgsql security definer set search_path='' as $$ begin return new; end $$;
revoke all on function analytics_reporting.fixture_noop() from public;
set local role sole_analytics_staging_reader;
create temporary table fixture_disposable(id integer);
do $check$
begin
  begin
    create trigger fixture_denied before insert on fixture_disposable
      for each row execute function analytics_reporting.fixture_noop();
    raise exception 'Unexpected trigger binding';
  exception when insufficient_privilege then null; end;
end $check$;
rollback;
