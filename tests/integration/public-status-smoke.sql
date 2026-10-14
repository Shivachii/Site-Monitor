-- Run after all migrations. Verifies that anonymous visitors receive only the
-- public site-status projection.

\set ON_ERROR_STOP on

begin;

set local role anon;

do $$
declare
  status_count integer;
begin
  if has_table_privilege(current_user, 'public.monitors', 'select') then
    raise exception 'Anonymous role unexpectedly has direct monitor-table access';
  end if;

  select count(*)
  into status_count
  from public.get_public_site_statuses();

  if status_count <> 5 then
    raise exception 'Expected five public site statuses, received %', status_count;
  end if;
end;
$$;

rollback;
