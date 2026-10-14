-- Standalone worker functions and the initial public monitor set.
-- These functions are callable only with the server-side service role.

create or replace function public.claim_due_monitors(
  p_worker_id text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 45
)
returns table (
  id uuid,
  name text,
  url text,
  timeout_ms integer,
  expected_status_codes integer[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null
    or char_length(p_worker_id) not between 1 and 120 then
    raise exception 'Worker ID must contain between 1 and 120 characters.';
  end if;

  if p_batch_size is null or p_batch_size not between 1 and 100 then
    raise exception 'Batch size must be between 1 and 100.';
  end if;

  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then
    raise exception 'Lease duration must be between 15 and 300 seconds.';
  end if;

  return query
  with candidates as (
    select monitor.id
    from public.monitors as monitor
    where monitor.enabled = true
      and monitor.deleted_at is null
      and monitor.next_check_at <= now()
      and (
        monitor.lease_expires_at is null
        or monitor.lease_expires_at <= now()
      )
    order by monitor.next_check_at, monitor.id
    for update skip locked
    limit p_batch_size
  ), claimed as (
    update public.monitors as monitor
    set lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from candidates
    where monitor.id = candidates.id
    returning monitor.id, monitor.name, monitor.url, monitor.timeout_ms,
      monitor.expected_status_codes
  )
  select claimed.id, claimed.name, claimed.url, claimed.timeout_ms,
    claimed.expected_status_codes
  from claimed;
end;
$$;

create or replace function public.record_monitor_check(
  p_worker_id text,
  p_monitor_id uuid,
  p_checked_at timestamptz,
  p_completed_at timestamptz,
  p_outcome public.check_outcome,
  p_http_status_code integer default null,
  p_response_time_ms integer default null,
  p_error_type text default null,
  p_error_message text default null,
  p_redirect_count integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  monitor public.monitors%rowtype;
  next_failures integer;
  next_successes integer;
  next_status public.monitor_status;
begin
  select *
  into monitor
  from public.monitors
  where id = p_monitor_id
  for update;

  if not found then
    raise exception 'Monitor does not exist.';
  end if;

  if monitor.lease_owner is distinct from p_worker_id
    or monitor.lease_expires_at is null
    or monitor.lease_expires_at <= now() then
    raise exception 'Monitor lease is not owned by this worker.';
  end if;

  if p_completed_at < p_checked_at then
    raise exception 'Completion time cannot precede check time.';
  end if;

  if p_outcome = 'success' then
    next_failures := 0;
    next_successes := monitor.consecutive_successes + 1;

    if monitor.current_status = 'down'
      and next_successes < monitor.recovery_threshold then
      next_status := 'degraded';
    elsif monitor.latency_threshold_ms is not null
      and p_response_time_ms > monitor.latency_threshold_ms then
      next_status := 'degraded';
    else
      next_status := 'operational';
    end if;
  else
    next_failures := monitor.consecutive_failures + 1;
    next_successes := 0;

    if next_failures >= monitor.failure_threshold then
      next_status := 'down';
    else
      next_status := 'degraded';
    end if;
  end if;

  insert into public.check_results (
    monitor_id,
    checked_at,
    completed_at,
    outcome,
    http_status_code,
    response_time_ms,
    error_type,
    error_message,
    redirect_count,
    worker_id
  ) values (
    p_monitor_id,
    p_checked_at,
    p_completed_at,
    p_outcome,
    p_http_status_code,
    p_response_time_ms,
    p_error_type,
    p_error_message,
    p_redirect_count,
    p_worker_id
  );

  update public.monitors
  set current_status = next_status,
      consecutive_failures = next_failures,
      consecutive_successes = next_successes,
      last_checked_at = p_completed_at,
      last_success_at = case
        when p_outcome = 'success' then p_completed_at
        else last_success_at
      end,
      next_check_at = p_completed_at + make_interval(secs => interval_seconds),
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where id = p_monitor_id;
end;
$$;

create or replace function public.record_worker_heartbeat(
  p_worker_id text,
  p_version text,
  p_started_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null
    or char_length(p_worker_id) not between 1 and 120 then
    raise exception 'Worker ID must contain between 1 and 120 characters.';
  end if;

  if p_version is null
    or char_length(p_version) not between 1 and 80 then
    raise exception 'Worker version must contain between 1 and 80 characters.';
  end if;

  if jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Worker metadata must be a JSON object.';
  end if;

  insert into public.worker_heartbeats (
    worker_id,
    started_at,
    heartbeat_at,
    version,
    metadata
  ) values (
    p_worker_id,
    p_started_at,
    now(),
    p_version,
    p_metadata
  )
  on conflict (worker_id) do update
  set started_at = excluded.started_at,
      heartbeat_at = excluded.heartbeat_at,
      version = excluded.version,
      metadata = excluded.metadata;
end;
$$;

revoke all on function public.claim_due_monitors(text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_monitor_check(
  text, uuid, timestamptz, timestamptz, public.check_outcome,
  integer, integer, text, text, integer
) from public, anon, authenticated;
revoke all on function public.record_worker_heartbeat(text, text, timestamptz, jsonb)
  from public, anon, authenticated;

grant execute on function public.claim_due_monitors(text, integer, integer) to service_role;
grant execute on function public.record_monitor_check(
  text, uuid, timestamptz, timestamptz, public.check_outcome,
  integer, integer, text, text, integer
) to service_role;
grant execute on function public.record_worker_heartbeat(text, text, timestamptz, jsonb)
  to service_role;

insert into public.organizations (name, slug)
values ('Shivachi Studio', 'shivachi-studio')
on conflict (slug) do update set name = excluded.name;

insert into public.monitors (
  organization_id,
  name,
  url,
  interval_seconds,
  timeout_ms,
  expected_status_codes,
  failure_threshold,
  recovery_threshold
)
select
  organization.id,
  site.name,
  site.url,
  60,
  10000,
  array[200],
  3,
  1
from public.organizations as organization
cross join (
  values
    ('Urbane Swim', 'https://www.urbaneswim.ke/'),
    ('BIK Advocates', 'https://www.bikadvocates.com/'),
    ('Medhat Gyn-Onc Clinic', 'https://medhatgyoncclinic.vercel.app/'),
    ('Ahlul Bayt Assembly', 'https://www.ahlulbaytassembly.org/'),
    ('Bilal Sacco Limited', 'https://bilalsaccolimited.com/')
) as site(name, url)
where organization.slug = 'shivachi-studio'
  and not exists (
    select 1
    from public.monitors as existing
    where existing.organization_id = organization.id
      and existing.url = site.url
      and existing.deleted_at is null
  );

comment on function public.claim_due_monitors(text, integer, integer) is
  'Atomically leases due HTTP monitors to a standalone service-role worker.';
comment on function public.record_monitor_check(
  text, uuid, timestamptz, timestamptz, public.check_outcome,
  integer, integer, text, text, integer
) is 'Records an HTTP check and advances the monitor status and schedule.';
