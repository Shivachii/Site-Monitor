# Shivachi Monitor

Public HTTP/HTTPS uptime status for Shivachi Studio and managed client websites.

The public dashboard lists every current monitor with Active, Inactive, or Monitoring delayed indicators. It reads a limited, read-only database projection with the Supabase publishable key. A separate lightweight worker performs HTTP/HTTPS checks, manages incidents and notifications, and writes the latest status; see [the worker ADR](docs/architecture/0001-scheduler-and-worker.md).

## Requirements

- Node.js 20.9 or later
- npm 10 or later
- A Supabase project, or Docker plus the Supabase CLI for local database work

## Local setup

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env.local` and replace only the local Supabase values.
3. Start Supabase locally with `npx supabase start`.
4. Apply the schema with `npx supabase db reset`.
5. Start the dashboard with `npm run dev`.
6. In another terminal, start the monitor with `npm run worker`.
7. Open `http://localhost:3000`. The dashboard does not require a login.

Do not paste production secrets into chat, commit them, expose the service-role key through `NEXT_PUBLIC_*`, or use production credentials in automated tests.

## Public dashboard setup

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the dashboard deployment environment. Anonymous visitors can execute only the `get_public_site_statuses` function, which returns `id`, name, URL, active state, and last-check time. The underlying monitor and result tables remain protected by RLS. If configuration or the database is unavailable, the public page shows a safe unavailable state.

Applying the migrations adds these initial monitors:

- Urbane Swim — `https://www.urbaneswim.ke/`
- BIK Advocates — `https://www.bikadvocates.com/`
- Medhat Gyn-Onc Clinic — `https://medhatgyoncclinic.vercel.app/`
- Ahlul Bayt Assembly — `https://www.ahlulbaytassembly.org/`
- Bilal Sacco Limited — `https://bilalsaccolimited.com/`

## Monitoring worker

The worker is an independent long-running Node process. It uses HTTP/HTTPS `GET` requests—not ICMP ping—and safely follows up to five redirects. DNS results are validated against private and reserved address ranges, then each connection is pinned to a validated address to reduce SSRF and DNS-rebinding risk.

Run it directly with `npm run worker`, which loads `.env.local`, or build `worker/Dockerfile` as a separate deployment. Configure `SUPABASE_URL`, the server-only `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), and the optional `MONITOR_*` tuning variables shown in `.env.example`. The secret key must never be exposed through a `NEXT_PUBLIC_*` variable or the dashboard deployment.

The worker also:

- opens and resolves incidents using the configured failure and recovery thresholds;
- queues deduplicated outage and recovery notifications;
- retries failed notification deliveries with exponential backoff;
- records heartbeats for container health checks;
- deletes raw check results after 30 days by default.

Email delivery uses Resend (`RESEND_API_KEY` and `RESEND_FROM_EMAIL`). Telegram delivery uses `TELEGRAM_BOT_TOKEN`; the channel destination is the Telegram chat ID. Notification channels are configured in the database rather than exposed through the public dashboard.

For a self-hosted worker with automatic restarts:

```bash
docker compose -f compose.worker.yaml up -d --build
```

## Commands

```bash
npm run dev
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run worker
npm run worker:health
```

The production dependency set currently passes `npm audit --omit=dev` with no advisories. The development tree includes an upstream glob-matching advisory through `eslint-config-next`; npm currently offers only an incompatible framework downgrade. Treat repository-controlled lint patterns as trusted input and reassess when a compatible patched release is available.

## Repository map

- `app/` — App Router pages for the public dashboard
- `components/` — reusable UI
- `lib/monitoring/` — server-only public status projection
- `lib/auth/` — Supabase sessions and role permissions
- `lib/security/` — URL and SSRF defenses
- `lib/validation/` — Zod request schemas
- `worker/` — standalone HTTP/HTTPS monitoring process and container
- `.github/workflows/ci.yml` — formatting, lint, type, test, and build checks
- `supabase/migrations/` — versioned PostgreSQL schema and RLS
- `tests/unit/` — deterministic domain/security tests
- `docs/` — phase records and architecture decisions

## Data retention and deletion

Monitor deletion is modeled as soft deletion so incidents remain auditable. Raw check results are pruned daily after 30 days by default. Deleting an entire organization cascades its tenant-owned data; this is an owner-only administrative operation and is not exposed publicly.

## Security notes

- RLS is enabled on every exposed tenant table.
- Authenticated users receive no write access to check results, audit logs, worker heartbeats, scheduler runs, or notification deliveries.
- Provider and worker secrets are server-only.
- URL parsing alone is not considered SSRF protection. The worker must use the validated DNS addresses for a pinned connection and revalidate every redirect.
- Application permission checks supplement RLS; neither replaces the other.
