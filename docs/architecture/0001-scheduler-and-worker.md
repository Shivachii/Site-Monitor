# ADR 0001: A standalone worker performs HTTP/HTTPS checks

- Status: accepted, superseding the earlier Supabase Cron proposal
- Date: 2026-10-14
- Decision owners: Shivachi Studio

## Context

Shivachi Monitor needs one-minute availability checks that continue while nobody is visiting the public dashboard. Checks must be claimed atomically, tolerate multiple worker replicas, reject internal network targets, and persist results before work is considered complete.

The initial portfolio contains five public websites. This workload does not need a large queueing platform, but it should not depend on dashboard traffic or a hosted cron invocation.

## Decision

Run a small, always-on Node.js worker as a separate process or container. The worker polls PostgreSQL through service-role-only Supabase RPC functions, atomically leases due monitors with `FOR UPDATE SKIP LOCKED`, and performs bounded-concurrency HTTP/HTTPS `GET` requests.

No ICMP `ping` is used. Availability is based on the configured HTTP response status after following at most five redirects. The worker records the HTTP status, response time, redirect count, and any request error, then advances the monitor's failure/recovery counters and next-check time in the same database transaction.

The dashboard and worker are deployed independently:

- the Next.js dashboard reads a minimal public projection of monitor state;
- the worker runs continuously with `npm run worker` or `worker/Dockerfile`;
- PostgreSQL leases allow another worker replica to recover jobs after a crashed worker's lease expires;
- worker heartbeats provide an operational signal without requiring an HTTP server in the worker.

## Security boundary

The Supabase secret/service-role key is available only to the worker. The dashboard uses a publishable key with a narrowly scoped status function. Worker RPC functions are revoked from `public`, `anon`, and `authenticated`, and granted only to `service_role`.

Each request resolves every DNS answer and rejects the target if any answer is private, loopback, link-local, reserved, or otherwise unsafe. The connection is pinned to a validated address while retaining the original hostname for the HTTP `Host` header and TLS SNI. Redirect destinations repeat the same validation before connecting.

The worker never accepts a target URL from a public request. It checks only monitor records claimed from the database.

## Operating limits

Defaults are deliberately small:

- batch size: 25 monitors;
- concurrency: 5 requests;
- polling interval: 5 seconds;
- request timeout: 10 seconds per monitor, including redirects;
- lease duration: 45 seconds;
- heartbeat interval: 30 seconds.

The worker also processes the durable notification outbox with bounded concurrency and prunes expired raw check results once per day. Incidents and incident events are retained.

Environment variables can tune these within guarded bounds. Revisit the architecture if the workload regularly exceeds 100 due monitors per minute, requires checks from multiple regions, or needs stronger network-level egress isolation.

## Deployment consequence

The worker needs an always-on container or process host such as Fly.io, Railway, Render, a small VPS, or an equivalent service. The platform must support outbound HTTP/HTTPS and must restart the process when it exits. No inbound port is required.
