-- Run after all migrations. Verifies that anonymous visitors receive only the
-- public site-status projection.

\set ON_ERROR_STOP on

begin;

set local role anon;

do $$
declare
  status_count integer;
  projection_columns integer;
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

  select count(*)
  into projection_columns
  from public.get_public_site_statuses()
  where status in ('unknown', 'operational', 'degraded', 'recovering', 'down')
    and failure_category is null
    and http_status_code is null;

  if projection_columns <> 5 then
    raise exception 'Public status projection contains unexpected initial values';
  end if;
end;
$$;

rollback;
