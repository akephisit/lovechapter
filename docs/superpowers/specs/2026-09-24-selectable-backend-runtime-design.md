# Selectable backend runtime design

## Decision

An installation selects one backend runtime: Bun 1.4.2 on a VPS, or a
Cloudflare API Worker. It does not run both API deployments or both job
processors at once. The frontend remains a separate Cloudflare Worker with a
same-origin `/api` proxy targeting the selected backend origin. Keep the Elysia
2 routes, domain services, PostgreSQL schema, authentication and authorization,
and Resend email outbox shared. No domain or VPS is needed for a generated
`workers.dev` deployment.

## VPS path

Preserve the current Bun HTTP service, Bun jobs loop, direct bounded pg pools,
systemd and Caddy setup. A single pair of services owns the API and job queue.

## Worker path

Expose Elysia's compiled Web Standard fetch handler from a dedicated API Worker
entrypoint, using the existing ingress credential, origin and cookie rules.
Use Hyperdrive's connection string for a single lazy `pg.Client` in each fetch
or scheduled invocation. Close it after the response body finishes or is
canceled (and in `finally` for scheduled work); CSV exports query lazily during
streaming. Never share a connection or pool across invocations. Keep
`/health/live` independent of PostgreSQL. Retain
the 1 MiB request cap at the frontend proxy.

The same API Worker has a UTC cron trigger each minute to claim one bounded
outbox batch and an additional trigger every 15 minutes for bounded email and
guest-import retention cleanup. A lease and provider idempotency key make
overlap and retries safe. No infinite polling or detached work runs in a
Worker. The deployment requires Hyperdrive, Neon, verified Resend sender and
runtime secrets for production local authentication. Migrations use a separate
direct PostgreSQL URL in a trusted CLI or CI environment, not a Worker binding.
Disable Hyperdrive query caching for all app reads so membership revocation,
account verification and RSVP writes are immediately visible. When local
authentication is enabled, validate Resend configuration on API fetch as well
as cron startup so registration cannot enqueue undeliverable email.

## Risks and checks

- The pinned Elysia beta and Node crypto/scrypt compatibility must pass an
  actual Wrangler bundle and local Worker smoke; production CPU capacity and
  scrypt latency still require a deployed benchmark.
- Config must fail closed for missing secrets or Hyperdrive; no connection
  attempt is needed for a liveness request.
- Every database invocation must close its client on success and failure.
- Only the frontend proxy has the ingress credential. Direct requests to the
  generated API URL cannot access business routes without it.
- Never copy VPS `DATABASE_URL` or use a process-wide pool inside the Worker.
- One cron tick handles a bounded batch; a backlog drains over subsequent
  ticks. Cron propagation and latency must be measured before launch.
