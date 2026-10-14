-- Public dashboard projection. Visitors can read only these status fields;
-- the underlying monitor and result tables remain protected by RLS.

create or replace function public.get_public_site_statuses()
returns table (
  id uuid,
  name text,
  url text,
  is_active boolean,
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
      and monitor.current_status in ('operational', 'degraded') as is_active,
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
  'Minimal read-only site status projection for the public dashboard.';
