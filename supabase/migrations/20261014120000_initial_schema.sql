-- Shivachi Monitor foundation schema.
-- Application users access tenant data through RLS. Background workers use the
-- server-only service role and must still include organization filters.

create extension if not exists pgcrypto with schema extensions;

create type public.organization_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.monitor_status as enum ('unknown', 'operational', 'degraded', 'down');
create type public.check_outcome as enum ('success', 'failure');
create type public.incident_status as enum ('open', 'acknowledged', 'resolved');
create type public.notification_channel_type as enum ('email', 'telegram');
create type public.notification_event_type as enum ('outage', 'recovery', 'test');
create type public.notification_delivery_status as enum ('pending', 'processing', 'sent', 'failed');
create type public.scheduler_run_status as enum ('started', 'completed', 'failed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members (user_id, organization_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id),
  foreign key (client_id, organization_id)
    references public.clients(id, organization_id) on delete restrict
);

create index clients_organization_id_idx on public.clients (organization_id, name);
create index projects_organization_id_idx on public.projects (organization_id, name);
create index projects_client_id_idx on public.projects (client_id) where client_id is not null;

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  project_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  url text not null check (char_length(url) between 1 and 2048),
  enabled boolean not null default true,
  interval_seconds integer not null default 60 check (interval_seconds between 60 and 86400),
  timeout_ms integer not null default 10000 check (timeout_ms between 1000 and 30000),
  expected_status_codes integer[] not null default array[200]
    check (
      cardinality(expected_status_codes) between 1 and 100
      and 100 <= all (expected_status_codes)
      and 599 >= all (expected_status_codes)
    ),
  failure_threshold smallint not null default 3 check (failure_threshold between 1 and 20),
  recovery_threshold smallint not null default 1 check (recovery_threshold between 1 and 20),
  latency_threshold_ms integer check (latency_threshold_ms between 1 and 120000),
  current_status public.monitor_status not null default 'unknown',
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  consecutive_successes integer not null default 0 check (consecutive_successes >= 0),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  next_check_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, organization_id),
  foreign key (client_id, organization_id)
    references public.clients(id, organization_id) on delete restrict,
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  check ((lease_owner is null) = (lease_expires_at is null))
);

create index monitors_due_idx
  on public.monitors (next_check_at, id)
  where enabled = true and deleted_at is null;
create index monitors_organization_id_idx
  on public.monitors (organization_id, created_at desc)
  where deleted_at is null;
create index monitors_lease_expiry_idx
  on public.monitors (lease_expires_at)
  where lease_expires_at is not null;

create table public.check_results (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete restrict,
  checked_at timestamptz not null,
  completed_at timestamptz not null,
  outcome public.check_outcome not null,
  http_status_code integer check (http_status_code between 100 and 599),
  response_time_ms integer check (response_time_ms >= 0),
  error_type text check (error_type is null or char_length(error_type) <= 80),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  redirect_count smallint not null default 0 check (redirect_count between 0 and 5),
  worker_id text not null check (char_length(worker_id) between 1 and 120),
  created_at timestamptz not null default now(),
  check (completed_at >= checked_at),
  check (
    (outcome = 'success' and error_type is null)
    or outcome = 'failure'
  )
);

create index check_results_monitor_checked_idx
  on public.check_results (monitor_id, checked_at desc);
create index check_results_retention_idx on public.check_results (checked_at);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  monitor_id uuid not null references public.monitors(id) on delete restrict,
  status public.incident_status not null default 'open',
  started_at timestamptz not null,
  detected_at timestamptz not null,
  resolved_at timestamptz,
  duration_seconds bigint check (duration_seconds is null or duration_seconds >= 0),
  failure_reason text not null check (char_length(failure_reason) between 1 and 500),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (monitor_id, organization_id)
    references public.monitors(id, organization_id) on delete restrict,
  check (detected_at >= started_at),
  check (
    (status = 'open' and acknowledged_at is null and resolved_at is null and duration_seconds is null)
    or (status = 'acknowledged' and acknowledged_at is not null and acknowledged_by is not null and resolved_at is null and duration_seconds is null)
    or (status = 'resolved' and resolved_at is not null and duration_seconds is not null)
  )
);

create unique index incidents_one_active_per_monitor_idx
  on public.incidents (monitor_id)
  where status in ('open', 'acknowledged');
create index incidents_organization_status_idx
  on public.incidents (organization_id, status, detected_at desc);
create index incidents_monitor_detected_idx
  on public.incidents (monitor_id, detected_at desc);

create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'acknowledged', 'resolved', 'note')),
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index incident_events_incident_created_idx
  on public.incident_events (incident_id, created_at asc);

create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_type public.notification_channel_type not null,
  destination text not null check (char_length(destination) between 1 and 320),
  enabled boolean not null default true,
  event_preferences jsonb not null default '{"outage": true, "recovery": true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (
    jsonb_typeof(event_preferences) = 'object'
    and event_preferences ? 'outage'
    and event_preferences ? 'recovery'
    and jsonb_typeof(event_preferences -> 'outage') = 'boolean'
    and jsonb_typeof(event_preferences -> 'recovery') = 'boolean'
  )
);

create index notification_channels_organization_idx
  on public.notification_channels (organization_id, enabled);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid,
  channel_id uuid not null,
  event_type public.notification_event_type not null,
  deduplication_key text not null unique check (char_length(deduplication_key) between 16 and 200),
  status public.notification_delivery_status not null default 'pending',
  attempt_count smallint not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (incident_id, organization_id)
    references public.incidents(id, organization_id) on delete set null (incident_id),
  foreign key (channel_id, organization_id)
    references public.notification_channels(id, organization_id) on delete restrict,
  check ((lease_owner is null) = (lease_expires_at is null)),
  check ((status = 'sent' and sent_at is not null) or (status <> 'sent' and sent_at is null))
);

create index notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at, id)
  where status in ('pending', 'failed');
create index notification_deliveries_org_status_idx
  on public.notification_deliveries (organization_id, status, created_at desc);

create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 120),
  started_at timestamptz not null,
  heartbeat_at timestamptz not null,
  version text not null check (char_length(version) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table public.scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null unique check (char_length(execution_id) between 1 and 160),
  status public.scheduler_run_status not null default 'started',
  claimed_count integer not null default 0 check (claimed_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  check (completed_at is null or completed_at >= started_at)
);

create index scheduler_runs_started_idx on public.scheduler_runs (started_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  resource_type text not null check (char_length(resource_type) between 1 and 80),
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients
for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger monitors_set_updated_at before update on public.monitors
for each row execute function public.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents
for each row execute function public.set_updated_at();
create trigger notification_channels_set_updated_at before update on public.notification_channels
for each row execute function public.set_updated_at();
create trigger notification_deliveries_set_updated_at before update on public.notification_deliveries
for each row execute function public.set_updated_at();

create or replace function public.protect_last_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_organization_id uuid := old.organization_id;
begin
  if not exists (
    select 1 from public.organizations where id = affected_organization_id
  ) then
    return null;
  end if;

  if old.role = 'owner'
    and (tg_op = 'DELETE' or new.role <> 'owner')
    and not exists (
      select 1
      from public.organization_members
      where organization_id = affected_organization_id
        and role = 'owner'
    ) then
    raise exception 'An organization must retain at least one owner.';
  end if;

  return null;
end;
$$;

create constraint trigger organization_members_require_owner
after update of role or delete on public.organization_members
deferrable initially deferred
for each row execute function public.protect_last_organization_owner();

create or replace function public.restrict_user_incident_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if old.status <> 'open'
      or new.status <> 'acknowledged'
      or new.acknowledged_by is distinct from auth.uid()
      or new.acknowledged_at is null
      or new.resolved_at is distinct from old.resolved_at
      or new.duration_seconds is distinct from old.duration_seconds
      or new.failure_reason is distinct from old.failure_reason
      or new.monitor_id is distinct from old.monitor_id
      or new.organization_id is distinct from old.organization_id then
      raise exception 'Authenticated users may only acknowledge open incidents.';
    end if;
  end if;
  return new;
end;
$$;

create trigger incidents_restrict_user_updates
before update on public.incidents
for each row execute function public.restrict_user_incident_updates();

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function public.org_role(target_organization_id uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.organization_members membership
  where membership.organization_id = target_organization_id
    and membership.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.has_org_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.org_role(target_organization_id) = any(allowed_roles), false);
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.org_role(uuid) from public;
revoke all on function public.has_org_role(uuid, public.organization_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.organization_role[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.monitors enable row level security;
alter table public.check_results enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
alter table public.notification_channels enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.scheduler_runs enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select_members on public.organizations
for select to authenticated using (public.is_org_member(id));
create policy organizations_update_owners on public.organizations
for update to authenticated
using (public.has_org_role(id, array['owner']::public.organization_role[]))
with check (public.has_org_role(id, array['owner']::public.organization_role[]));

create policy organization_members_select_members on public.organization_members
for select to authenticated using (public.is_org_member(organization_id));
create policy organization_members_insert_owners on public.organization_members
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner']::public.organization_role[]));
create policy organization_members_update_owners on public.organization_members
for update to authenticated
using (public.has_org_role(organization_id, array['owner']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['owner']::public.organization_role[]));
create policy organization_members_delete_owners on public.organization_members
for delete to authenticated
using (public.has_org_role(organization_id, array['owner']::public.organization_role[]));

create policy clients_select_members on public.clients
for select to authenticated using (public.is_org_member(organization_id));
create policy clients_insert_admins on public.clients
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy clients_update_admins on public.clients
for update to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy clients_delete_admins on public.clients
for delete to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create policy projects_select_members on public.projects
for select to authenticated using (public.is_org_member(organization_id));
create policy projects_insert_admins on public.projects
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy projects_update_admins on public.projects
for update to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy projects_delete_admins on public.projects
for delete to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create policy monitors_select_members on public.monitors
for select to authenticated using (public.is_org_member(organization_id));
create policy monitors_insert_admins on public.monitors
for insert to authenticated
with check (
  public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[])
  and created_by = auth.uid()
);
create policy monitors_update_admins on public.monitors
for update to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create policy check_results_select_members on public.check_results
for select to authenticated using (
  exists (
    select 1 from public.monitors monitor
    where monitor.id = check_results.monitor_id
      and public.is_org_member(monitor.organization_id)
  )
);

create policy incidents_select_members on public.incidents
for select to authenticated using (public.is_org_member(organization_id));
create policy incidents_update_acknowledgers on public.incidents
for update to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['owner', 'admin', 'member']::public.organization_role[]));

create policy incident_events_select_members on public.incident_events
for select to authenticated using (
  exists (
    select 1 from public.incidents incident
    where incident.id = incident_events.incident_id
      and public.is_org_member(incident.organization_id)
  )
);

create policy notification_channels_select_members on public.notification_channels
for select to authenticated using (public.is_org_member(organization_id));
create policy notification_channels_insert_admins on public.notification_channels
for insert to authenticated
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy notification_channels_update_admins on public.notification_channels
for update to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy notification_channels_delete_admins on public.notification_channels
for delete to authenticated
using (public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create policy notification_deliveries_select_members on public.notification_deliveries
for select to authenticated using (public.is_org_member(organization_id));

create policy audit_logs_select_admins on public.audit_logs
for select to authenticated using (
  public.has_org_role(organization_id, array['owner', 'admin']::public.organization_role[])
);

revoke all on all tables in schema public from anon;
revoke all on public.check_results, public.incident_events, public.notification_deliveries,
  public.worker_heartbeats, public.scheduler_runs, public.audit_logs from authenticated;

grant select on public.organizations, public.organization_members, public.clients, public.projects,
  public.monitors, public.check_results, public.incidents, public.incident_events,
  public.notification_channels, public.notification_deliveries, public.audit_logs to authenticated;
grant update (name, slug) on public.organizations to authenticated;
grant insert, delete on public.organization_members to authenticated;
grant update (role) on public.organization_members to authenticated;
grant insert, update, delete on public.clients, public.projects,
  public.notification_channels to authenticated;
grant insert (
  organization_id, client_id, project_id, name, url, enabled, interval_seconds,
  timeout_ms, expected_status_codes, failure_threshold, recovery_threshold,
  latency_threshold_ms, created_by
) on public.monitors to authenticated;
grant update (
  client_id, project_id, name, url, enabled, interval_seconds, timeout_ms,
  expected_status_codes, failure_threshold, recovery_threshold,
  latency_threshold_ms, deleted_at
) on public.monitors to authenticated;
grant update (status, acknowledged_by, acknowledged_at) on public.incidents to authenticated;

comment on table public.check_results is
  'Append-only observations. Authenticated users have SELECT only; workers write with the service role.';
comment on column public.monitors.deleted_at is
  'Soft deletion retains check and incident history. Hard deletion is intentionally restricted by foreign keys.';
comment on table public.notification_deliveries is
  'Transactional notification outbox. Provider credentials are stored only in environment secret management.';
