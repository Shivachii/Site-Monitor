-- Run after both migrations. The whole test rolls back.
-- Verifies service-role-only claiming and the atomic result/status transition.

\set ON_ERROR_STOP on

begin;

update public.monitors
set next_check_at = now() + interval '1 day',
    lease_owner = null,
    lease_expires_at = null;

update public.monitors
set next_check_at = now() - interval '1 minute'
where name = 'Urbane Swim'
returning id as monitor_id \gset

select set_config('worker_test.monitor_id', :'monitor_id', true);

set local role service_role;

do $$
declare
  claimed_count integer;
begin
  select count(*)
  into claimed_count
  from public.claim_due_monitors('worker-smoke-test', 1, 45)
  where id = current_setting('worker_test.monitor_id')::uuid;

  if claimed_count <> 1 then
    raise exception 'Worker did not claim the expected monitor';
  end if;
end;
$$;

select public.record_monitor_check(
  'worker-smoke-test',
  :'monitor_id'::uuid,
  now() - interval '1 second',
  now(),
  'success',
  200,
  125,
  null,
  null,
  0
);

reset role;

do $$
begin
  if not exists (
    select 1
    from public.monitors
    where id = current_setting('worker_test.monitor_id')::uuid
      and current_status = 'operational'
      and consecutive_successes = 1
      and consecutive_failures = 0
      and last_checked_at is not null
      and lease_owner is null
      and lease_expires_at is null
  ) then
    raise exception 'Successful worker result did not update monitor state';
  end if;

  if not exists (
    select 1
    from public.check_results
    where monitor_id = current_setting('worker_test.monitor_id')::uuid
      and outcome = 'success'
      and http_status_code = 200
      and response_time_ms = 125
      and worker_id = 'worker-smoke-test'
  ) then
    raise exception 'Worker result was not recorded';
  end if;
end;
$$;

rollback;
