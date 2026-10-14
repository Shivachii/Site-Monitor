-- Production hardening: stale public status, transactional incidents,
-- notification delivery claims, and check-result retention.

drop function public.get_public_site_statuses();

create function public.get_public_site_statuses()
returns table (
  id uuid,
  name text,
  url text,
  is_active boolean,
  is_stale boolean,
  last_checked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    monitor.id,
    monitor.name,
    monitor.url,
    monitor.enabled
      and monitor.current_status in ('operational', 'degraded')
      and monitor.last_checked_at >= now() - interval '3 minutes' as is_active,
    monitor.last_checked_at is null
      or monitor.last_checked_at < now() - interval '3 minutes' as is_stale,
    monitor.last_checked_at
  from public.monitors as monitor
  where monitor.deleted_at is null
  order by monitor.name;
$$;

revoke all on function public.get_public_site_statuses()
  from public;
grant execute on function public.get_public_site_statuses()
  to anon, authenticated;

comment on function public.get_public_site_statuses() is
  'Minimal read-only status projection; checks older than three minutes are stale.';

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
  active_incident public.incidents%rowtype;
  incident_id uuid;
  failure_reason text;
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

  if next_status = 'down' then
    select *
    into active_incident
    from public.incidents
    where monitor_id = p_monitor_id
      and status in ('open', 'acknowledged')
    for update;

    if not found then
      failure_reason := left(
        coalesce(
          p_error_message,
          case
            when p_http_status_code is not null
              then format('Unexpected HTTP status %s.', p_http_status_code)
            else 'HTTP check failed.'
          end
        ),
        500
      );

      insert into public.incidents (
        organization_id,
        monitor_id,
        status,
        started_at,
        detected_at,
        failure_reason
      ) values (
        monitor.organization_id,
        p_monitor_id,
        'open',
        p_checked_at,
        p_completed_at,
        failure_reason
      )
      returning id into incident_id;

      insert into public.incident_events (
        incident_id,
        event_type,
        metadata
      ) values (
        incident_id,
        'opened',
        jsonb_build_object(
          'worker_id', p_worker_id,
          'http_status_code', p_http_status_code,
          'response_time_ms', p_response_time_ms
        )
      );

      insert into public.notification_deliveries (
        organization_id,
        incident_id,
        channel_id,
        event_type,
        deduplication_key
      )
      select
        monitor.organization_id,
        incident_id,
        channel.id,
        'outage',
        format('incident:%s:outage:%s', incident_id, channel.id)
      from public.notification_channels as channel
      where channel.organization_id = monitor.organization_id
        and channel.enabled = true
        and coalesce((channel.event_preferences ->> 'outage')::boolean, false)
      on conflict (deduplication_key) do nothing;
    end if;
  elsif next_status = 'operational' then
    select *
    into active_incident
    from public.incidents
    where monitor_id = p_monitor_id
      and status in ('open', 'acknowledged')
    for update;

    if found then
      incident_id := active_incident.id;

      update public.incidents
      set status = 'resolved',
          resolved_at = p_completed_at,
          duration_seconds = greatest(
            0,
            floor(extract(epoch from (p_completed_at - active_incident.started_at)))::bigint
          ),
          updated_at = now()
      where id = incident_id;

      insert into public.incident_events (
        incident_id,
        event_type,
        metadata
      ) values (
        incident_id,
        'resolved',
        jsonb_build_object(
          'worker_id', p_worker_id,
          'http_status_code', p_http_status_code,
          'response_time_ms', p_response_time_ms
        )
      );

      insert into public.notification_deliveries (
        organization_id,
        incident_id,
        channel_id,
        event_type,
        deduplication_key
      )
      select
        monitor.organization_id,
        incident_id,
        channel.id,
        'recovery',
        format('incident:%s:recovery:%s', incident_id, channel.id)
      from public.notification_channels as channel
      where channel.organization_id = monitor.organization_id
        and channel.enabled = true
        and coalesce((channel.event_preferences ->> 'recovery')::boolean, false)
      on conflict (deduplication_key) do nothing;
    end if;
  end if;
end;
$$;

revoke all on function public.record_monitor_check(
  text, uuid, timestamptz, timestamptz, public.check_outcome,
  integer, integer, text, text, integer
) from public, anon, authenticated;
grant execute on function public.record_monitor_check(
  text, uuid, timestamptz, timestamptz, public.check_outcome,
  integer, integer, text, text, integer
) to service_role;

create or replace function public.claim_notification_deliveries(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 60
)
returns table (
  id uuid,
  channel_type public.notification_channel_type,
  destination text,
  event_type public.notification_event_type,
  monitor_name text,
  failure_reason text,
  started_at timestamptz,
  resolved_at timestamptz
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
    select delivery.id
    from public.notification_deliveries as delivery
    where delivery.status in ('pending', 'failed')
      and delivery.next_attempt_at <= now()
      and delivery.attempt_count < 20
      and (
        delivery.lease_expires_at is null
        or delivery.lease_expires_at <= now()
      )
    order by delivery.next_attempt_at, delivery.id
    for update skip locked
    limit p_batch_size
  ), claimed as (
    update public.notification_deliveries as delivery
    set status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        last_attempt_at = now(),
        lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    channel.channel_type,
    channel.destination,
    claimed.event_type,
    monitor.name,
    incident.failure_reason,
    incident.started_at,
    incident.resolved_at
  from claimed
  join public.notification_channels as channel
    on channel.id = claimed.channel_id
  left join public.incidents as incident
    on incident.id = claimed.incident_id
  left join public.monitors as monitor
    on monitor.id = incident.monitor_id;
end;
$$;

create or replace function public.record_notification_delivery(
  p_worker_id text,
  p_delivery_id uuid,
  p_success boolean,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.notification_deliveries%rowtype;
  retry_seconds integer;
begin
  select *
  into delivery
  from public.notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'Notification delivery does not exist.';
  end if;

  if delivery.lease_owner is distinct from p_worker_id
    or delivery.lease_expires_at is null
    or delivery.lease_expires_at <= now() then
    raise exception 'Notification lease is not owned by this worker.';
  end if;

  if p_success then
    update public.notification_deliveries
    set status = 'sent',
        sent_at = now(),
        last_error = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_delivery_id;
  else
    retry_seconds := least(3600, (30 * power(2, delivery.attempt_count - 1))::integer);

    update public.notification_deliveries
    set status = 'failed',
        next_attempt_at = now() + make_interval(secs => retry_seconds),
        last_error = left(coalesce(p_error_message, 'Unknown delivery error.'), 500),
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_delivery_id;
  end if;
end;
$$;

create or replace function public.prune_check_results(
  p_retention_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_retention_days is null or p_retention_days not between 7 and 365 then
    raise exception 'Retention must be between 7 and 365 days.';
  end if;

  delete from public.check_results
  where checked_at < now() - make_interval(days => p_retention_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.claim_notification_deliveries(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.record_notification_delivery(text, uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.prune_check_results(integer)
  from public, anon, authenticated;

grant execute on function public.claim_notification_deliveries(text, integer, integer)
  to service_role;
grant execute on function public.record_notification_delivery(text, uuid, boolean, text)
  to service_role;
grant execute on function public.prune_check_results(integer)
  to service_role;

comment on function public.claim_notification_deliveries(text, integer, integer) is
  'Atomically leases queued outage and recovery notifications to a worker.';
comment on function public.record_notification_delivery(text, uuid, boolean, text) is
  'Marks a leased notification as sent or schedules an exponential-backoff retry.';
comment on function public.prune_check_results(integer) is
  'Deletes raw check results older than the configured retention period.';
