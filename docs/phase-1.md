# Phase 1 verification record

> Historical note: this records the original Phase 1 boundary. The application
> now exposes a public status dashboard and uses a standalone HTTP/HTTPS worker;
> see the README and ADR 0001 for the current design.

## Scope

Phase 1 establishes the application and data-security foundation:

- Next.js App Router, strict TypeScript, Tailwind CSS, ESLint, Prettier, and Vitest.
- Invitation-only sign-in UI and protected dashboard boundary using Supabase Auth.
- Initial PostgreSQL schema, constraints, indexes, RLS policies, append-only result access, and server-only worker tables.
- Owner/admin/member/viewer permission model.
- Monitor input validation and the DNS-aware half of the SSRF defense.
- Scheduler architecture decision and initial operating assumptions.

## Verification commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Executed on 2026-10-14:

- Prettier check: passed.
- ESLint with zero warnings: passed.
- strict TypeScript check: passed.
- Vitest: 35 tests passed across 3 files.
- Next.js production build: passed; `/`, `/login`, and the dynamic protected `/dashboard` route compiled.
- PostgreSQL 17 migration execution: passed.
- direct-access RLS smoke test: passed for workspace reads, cross-workspace monitor writes, and viewer mutation denial.
- local HTTP/UI smoke test: `/` and `/login` returned 200; unauthenticated `/dashboard` returned a 307 redirect to `/login`.
- production dependency audit: 0 known advisories.

Database migration verification requires Docker and the Supabase CLI:

```bash
npx supabase start
npx supabase db reset
```

The database reset must succeed before merging this phase. The included smoke test verifies cross-organization reads and writes plus viewer restrictions; Phase 2 will extend database integration coverage to worker claims and incident transactions.

The migration and current RLS smoke test can also be exercised against PostgreSQL after supplying minimal `auth.uid()`/`auth.role()` stubs:

```bash
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261014120000_initial_schema.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261014130000_standalone_worker.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261014140000_public_status_rpc.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261014150000_production_hardening.sql
psql -v ON_ERROR_STOP=1 -f tests/integration/rls-smoke.sql
psql -v ON_ERROR_STOP=1 -f tests/integration/worker-smoke.sql
psql -v ON_ERROR_STOP=1 -f tests/integration/public-status-smoke.sql
psql -v ON_ERROR_STOP=1 -f tests/integration/production-hardening-smoke.sql
```

## Implemented vs. intentionally incomplete

Implemented:

- real Supabase session handling and route protection;
- production-oriented tables, keys, constraints, indexes, and RLS;
- URL scheme, credential, hostname, IP-range, and DNS-answer validation;
- deterministic unit tests for role rules, monitor defaults, and SSRF rejections.

Not mocked, but not connected yet:

- the dashboard shows explicit unavailable markers instead of invented statistics;
- sign-in requires a configured Supabase project and an invited user.

Deferred to later phases at the Phase 1 boundary:

- atomic monitor claim and monitoring worker (now implemented as a standalone Node worker);
- HTTP checking, DNS pinning, redirects, result persistence, and incident state transitions (now implemented);
- Resend and Telegram adapters and notification outbox processor (now implemented; channels still require configuration);
- complete dashboard routes and analytics;
- Playwright flows and production deployment remain outstanding; retention and CI are now implemented.

## Manual setup required

- Create development, test, and production Supabase projects.
- Disable open registration and configure approved team invitations.
- Apply the migration and create the initial organization/owner through an administrator-controlled process.
- Set the placeholder variables from `.env.example` in the appropriate secret manager; never use production credentials in tests.
- No Site or Vercel deployment was created because the project protocol requires review at the Phase 1 boundary and the monitoring product is not complete yet.
