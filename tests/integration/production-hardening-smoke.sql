-- Run after all migrations. Verifies incidents, queued notifications,
-- notification delivery, retention, and stale public status.

\set ON_ERROR_STOP on

begin;

update public.monitors
set next_check_at = now() + interval '1 day',
    lease_owner = null,
    lease_expires_at = null;

update public.monitors
set next_check_at = now() - interval '1 minute',
    failure_threshold = 1,
    recovery_threshold = 1,
    current_status = 'operational',
    consecutive_failures = 0,
    consecutive_successes = 1
where name = 'Urbane Swim'
returning id as monitor_id, organization_id as organization_id \gset

select set_config('worker_test.monitor_id', :'monitor_id', true);

insert into public.notification_channels (
  organization_id,
  channel_type,
  destination
) values (
  :'organization_id'::uuid,
  'email',
  'ops@example.com'
);

set local role service_role;

select id
from public.claim_due_monitors('hardening-smoke-worker', 1, 45)
where id = :'monitor_id'::uuid;

select public.record_monitor_check(
  'hardening-smoke-worker',
  :'monitor_id'::uuid,
  now() - interval '1 second',
  now(),
  'failure',
  503,
  400,
  'unexpected_status',
  'Expected 200; received 503.',
  0
);

reset role;

do $$
begin
  if not exists (
    select 1 from public.monitors
    where id = current_setting('worker_test.monitor_id', true)::uuid
      and current_status = 'down'
  ) then
    raise exception 'Failure threshold did not mark the monitor down';
  end if;
end;
$$;

set local role anon;

do $$
begin
  if not exists (
    select 1 from public.get_public_site_statuses()
    where id = current_setting('worker_test.monitor_id', true)::uuid
      and status = 'down'
      and is_active = false
      and is_stale = false
      and incident_started_at is not null
      and failure_category = 'http'
      and http_status_code = 503
  ) then
    raise exception 'Confirmed outage was not included in the public projection';
  end if;
end;
$$;

reset role;

update public.monitors
set next_check_at = now() - interval '1 minute'
where id = :'monitor_id'::uuid;

set local role service_role;

select id
from public.claim_due_monitors('hardening-smoke-worker', 1, 45)
where id = :'monitor_id'::uuid;

select public.record_monitor_check(
  'hardening-smoke-worker',
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

do $$
declare
  delivery record;
  delivery_count integer := 0;
begin
  for delivery in
    select *
    from public.claim_notification_deliveries('hardening-smoke-worker', 10, 60)
  loop
    perform public.record_notification_delivery(
      'hardening-smoke-worker',
      delivery.id,
      true,
      null
    );
    delivery_count := delivery_count + 1;
  end loop;

  if delivery_count <> 2 then
    raise exception 'Expected two notification deliveries, received %', delivery_count;
  end if;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1 from public.incidents
    where monitor_id = current_setting('worker_test.monitor_id', true)::uuid
      and status = 'resolved'
      and resolved_at is not null
      and duration_seconds is not null
  ) then
    raise exception 'Incident was not resolved after recovery';
  end if;

  if (
    select count(*) from public.incident_events
    where incident_id = (
      select id from public.incidents
      where monitor_id = current_setting('worker_test.monitor_id', true)::uuid
      limit 1
    )
  ) <> 2 then
    raise exception 'Expected opened and resolved incident events';
  end if;

  if (
    select count(*) from public.notification_deliveries
    where status = 'sent'
  ) <> 2 then
    raise exception 'Expected sent outage and recovery notifications';
  end if;
end;
$$;

insert into public.check_results (
  monitor_id,
  checked_at,
  completed_at,
  outcome,
  http_status_code,
  response_time_ms,
  worker_id
) values (
  :'monitor_id'::uuid,
  now() - interval '31 days',
  now() - interval '31 days' + interval '1 second',
  'success',
  200,
  100,
  'retention-smoke-worker'
);

set local role service_role;

do $$
declare
  deleted_count integer;
begin
  deleted_count := public.prune_check_results(30);
  if deleted_count <> 1 then
    raise exception 'Expected one expired result to be pruned, received %', deleted_count;
  end if;
end;
$$;

reset role;

update public.monitors
set last_checked_at = now() - interval '10 minutes'
where id = :'monitor_id'::uuid;

set local role anon;

do $$
begin
  if not exists (
    select 1 from public.get_public_site_statuses()
    where id = current_setting('worker_test.monitor_id', true)::uuid
      and is_stale = true
      and is_active = false
  ) then
    raise exception 'Stale monitor was not reported as delayed';
  end if;
end;
$$;

rollback;
