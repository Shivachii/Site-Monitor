-- Run after the initial migration. The whole test rolls back.
-- It simulates direct PostgREST access by assuming the authenticated role and
-- setting the same request JWT claims Supabase exposes to auth.uid().

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

insert into public.organizations (id, name, slug) values
  ('10000000-0000-4000-8000-000000000001', 'Studio A', 'studio-a'),
  ('10000000-0000-4000-8000-000000000002', 'Studio B', 'studio-b');

insert into public.organization_members (organization_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'admin'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'viewer');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'RLS exposed an organization outside the user workspace';
  end if;
end;
$$;

insert into public.monitors (
  organization_id,
  name,
  url,
  created_by
) values (
  '10000000-0000-4000-8000-000000000001',
  'Allowed monitor',
  'https://example.com',
  '00000000-0000-4000-8000-000000000001'
);

do $$
begin
  begin
    insert into public.monitors (
      organization_id,
      name,
      url,
      created_by
    ) values (
      '10000000-0000-4000-8000-000000000002',
      'Cross-tenant monitor',
      'https://example.net',
      '00000000-0000-4000-8000-000000000001'
    );
    raise exception 'Cross-organization monitor insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);

do $$
declare
  affected_rows integer;
begin
  update public.monitors
  set enabled = false
  where name = 'Allowed monitor';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'Viewer monitor update unexpectedly succeeded';
  end if;
end;
$$;

rollback;
