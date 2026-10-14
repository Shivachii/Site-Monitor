-- Add public-safe incident context without exposing raw worker errors, private
-- notification destinations, or the underlying incident and check tables.

drop function public.get_public_site_statuses();

create function public.get_public_site_statuses()
returns table (
  id uuid,
  name text,
  url text,
  is_active boolean,
  is_stale boolean,
  status text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  incident_started_at timestamptz,
  failure_category text,
  http_status_code integer
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
      and monitor.current_status = 'operational'
      and monitor.last_checked_at >= now() - interval '3 minutes' as is_active,
    monitor.last_checked_at is null
      or monitor.last_checked_at < now() - interval '3 minutes' as is_stale,
    case
      when monitor.current_status = 'degraded'
        and incident.started_at is not null then 'recovering'
      else monitor.current_status::text
    end as status,
    monitor.last_checked_at,
    monitor.last_success_at,
    incident.started_at as incident_started_at,
    case
      when incident.started_at is not null
        and latest_check.outcome = 'success' then null
      when monitor.current_status = 'degraded'
        and latest_check.outcome = 'success' then 'slow'
      when latest_check.outcome is distinct from 'failure' then null
      when latest_check.error_type = 'unexpected_status' then 'http'
      when latest_check.error_message ilike '%timed out%' then 'timeout'
      when upper(coalesce(latest_check.error_type, '')) in (
        'ENOTFOUND',
        'EAI_AGAIN',
        'EAI_FAIL',
        'EAI_NODATA',
        'EAI_NONAME'
      ) then 'dns'
      when upper(coalesce(latest_check.error_type, '')) in (
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      ) then 'tls'
      else 'connection'
    end as failure_category,
    case
      when latest_check.outcome = 'failure' then latest_check.http_status_code
      else null
    end as http_status_code
  from public.monitors as monitor
  left join lateral (
    select active_incident.started_at
    from public.incidents as active_incident
    where active_incident.monitor_id = monitor.id
      and active_incident.status in ('open', 'acknowledged')
    order by active_incident.detected_at desc
    limit 1
  ) as incident on true
  left join lateral (
    select
      result.outcome,
      result.http_status_code,
      result.error_type,
      result.error_message
    from public.check_results as result
    where result.monitor_id = monitor.id
    order by result.checked_at desc
    limit 1
  ) as latest_check on true
  where monitor.deleted_at is null
  order by monitor.name;
$$;

revoke all on function public.get_public_site_statuses()
  from public;
grant execute on function public.get_public_site_statuses()
  to anon, authenticated;

comment on function public.get_public_site_statuses() is
  'Public-safe status and active-incident context; raw errors remain private.';
