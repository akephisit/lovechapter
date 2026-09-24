# LoveChapter — Deployment

## Status and topology

Choose one backend path for each installation: **Cloudflare API Worker** or
**Bun/VPS**. Never run both APIs or both job processors against the same
deployment. Both paths use the same Elysia API, Neon schema and frontend
same-origin proxy. No infrastructure is provisioned or claimed by this
repository; credentials, Resend verification and live deployments are external
gates. Neither a VPS nor a custom domain is required for the Worker path.

```text
Browser -> Cloudflare frontend Worker -> same-origin /api proxy
        -> selected HTTPS backend origin

Worker choice: Elysia API Worker -> Hyperdrive -> Neon PostgreSQL
               scheduled email/cleanup handlers -> Hyperdrive -> Neon/Resend

VPS choice:    Caddy -> Elysia/Bun API -> bounded pg pool -> Neon PostgreSQL
               systemd Bun jobs -> bounded pg pool -> Neon/Resend
```

The VPS host floor is 2 vCPU and 2 GiB RAM. A smaller class requires fresh
scrypt, pool, and concurrent-request measurements. Measure Worker CPU, memory,
and scrypt latency on the selected Cloudflare plan before enabling local auth.

## Runtime environment contract

For VPS deployments, store API and job variables in root-owned files under
`/etc/lovechapter` with mode `0600`. For Workers use secret bindings and a
Hyperdrive binding. Never commit real values.

| Process    | Required environment                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS API    | `DATABASE_URL`, `DATABASE_POOL_MAX=6`, `AUTH_MODE=local`, `PUBLIC_WEB_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, `RATE_LIMIT_HMAC_KEY`, `AUTH_TOKEN_ACTIVE_KEY_VERSION`, `AUTH_TOKEN_HMAC_KEYS`, `API_HOST=127.0.0.1`, `API_PORT=3001`       |
| VPS Jobs   | `DATABASE_URL`, `DATABASE_POOL_MAX=2`, `PUBLIC_WEB_ORIGIN`, `AUTH_TOKEN_ACTIVE_KEY_VERSION`, `AUTH_TOKEN_HMAC_KEYS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                                                                            |
| API Worker | `HYPERDRIVE` binding, `NODE_ENV=production`, `AUTH_MODE=local`, `PUBLIC_WEB_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, `RATE_LIMIT_HMAC_KEY`, `AUTH_TOKEN_ACTIVE_KEY_VERSION`, `AUTH_TOKEN_HMAC_KEYS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Web        | `API_UPSTREAM_ORIGIN`, `WEB_PROXY_SHARED_SECRET`                                                                                                                                                                                      |

`API_HOST` and `API_PORT` are the implementation's names for the plan's generic
host/port settings. The checked-in systemd unit pins both so only the API gets a
loopback listener. Production rejects `AUTH_MODE=development`.

Generate the proxy credential, rate-limit key, and each action-token key
independently as canonical 32-byte base64url values. `AUTH_TOKEN_HMAC_KEYS` is a
JSON object whose keys are positive integer versions, for example
`{"1":"<32-byte-base64url>"}`. API and jobs must receive the same retained key
set and active version.

## Cloudflare API Worker choice

1. Create Neon and apply existing Drizzle migrations from a trusted machine/CI
   using a separate direct migration credential. The GitHub Actions release
   workflow below runs pending migrations automatically before every production
   deploy; a manual first migration is an alternative during setup:

   ```bash
   DATABASE_URL='postgres://MIGRATION_ROLE:SECRET@HOST/DB?sslmode=require' \
     npm run db:migrate --workspace @lovechapter/database
   ```

2. Create a Hyperdrive configuration for Neon using its direct/unpooled TLS
   connection string **with query caching disabled** (use `--caching-disabled`
   when creating it via Wrangler). Authentication, membership, and invitation
   changes require fresh reads; Hyperdrive's default query cache does not
   invalidate after writes. Verify caching is disabled on the actual
   configuration before deploying. Give the application database role only
   the needed privileges. Replace `REPLACE_WITH_HYPERDRIVE_ID` in
   `apps/api/wrangler.jsonc` with the actual configuration ID; never commit a
   database password. Configure `HYPERDRIVE` with the same binding name.
3. Set `PUBLIC_WEB_ORIGIN` to the frontend Worker's generated HTTPS origin.
   Add `WEB_PROXY_SHARED_SECRET`, `RATE_LIMIT_HMAC_KEY`,
   `AUTH_TOKEN_ACTIVE_KEY_VERSION`, `AUTH_TOKEN_HMAC_KEYS`, `RESEND_API_KEY`, and
   `RESEND_FROM_EMAIL` as API Worker secrets before deploying. Set secrets in
   the dashboard on an existing Worker or upload them with the first deployment
   using Wrangler's `--secrets-file`; `wrangler secret put` deploys a new Worker
   version immediately. The proxy secret must match on the web and API Workers;
   action-token signing keys are API-only on this path. Keep `AUTH_MODE=disabled`
   until Neon, Resend, proxy, mail delivery and scrypt on the target Worker
   pass staging checks; then set `AUTH_MODE=local` in the API Worker config.
4. Verify locally without deploying using
   `npm run build:worker --workspace @lovechapter/api`. Deploy with
   `npm run deploy:worker --workspace @lovechapter/api` after bindings are real.
   Set the frontend Worker's `API_UPSTREAM_ORIGIN` to the deployed API Worker's
   `https://...workers.dev` origin and `WEB_PROXY_SHARED_SECRET` to the same
   credential, then deploy the frontend. The frontend Worker config enables
   `global_fetch_strictly_public` so server-side `fetch` can reach the API
   Worker on the same account. Confirm the target is the API Worker and not
   the frontend's own URL. Do not enable a second backend.
5. The API Worker's `* * * * *` UTC cron processes up to 10 outbox jobs per
   tick; `*/15 * * * *` runs one bounded 500-row retention pass for auth and
   guest imports. Monitor backlog and retry behavior. Test generated URL
   liveness, authenticated proxy, registration/email verification, session,
   CSV streaming, and both cron handlers with a disposable staging database.

For local Worker development, Wrangler also requires a local PostgreSQL URL:
set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to a disposable
database URL. This is separate from the deployed Hyperdrive ID. The Worker
liveness handler does not open that database.

The API Worker creates a lazy `pg.Client` for each fetch or scheduled
invocation and closes it after the response stream or scheduled task finishes.
No process-wide Worker connection is shared. The existing frontend proxy has
a 1 MiB body cap and rejects unapproved headers; the public API Worker rejects
business requests without the private proxy credential. Cloudflare invocation
logs/traces remain disabled because invitation paths contain bearer tokens.

### Automatic migration and deployment from GitHub

`.github/workflows/ci.yml` verifies pull requests without touching production.
After a push to `main`, its production job waits for both verification jobs,
applies pending Drizzle migrations once, deploys the API Worker, deploys the web
Worker, then checks API liveness and readiness through the web proxy. A failing
check or migration prevents later deployment steps. Main-branch runs are not
canceled mid-migration. This job uses the `production` GitHub environment.

Configure these GitHub environment values **before merging** the release
workflow to `main`:

| Kind     | Name                          | Value                                                                                                |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Secret   | `NEON_MIGRATION_DATABASE_URL` | Direct/unpooled TLS Neon URL for a dedicated migration role; never the Hyperdrive runtime credential |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`       | Target Cloudflare account ID                                                                         |
| Secret   | `CLOUDFLARE_API_TOKEN`        | Cloudflare API token scoped to deploy Workers in that account                                        |
| Variable | `API_WORKER_ORIGIN`           | Actual API Worker HTTPS origin without a trailing slash                                              |
| Variable | `WEB_WORKER_ORIGIN`           | Actual web Worker HTTPS origin without a trailing slash                                              |

Provision Hyperdrive with caching disabled and replace its placeholder binding
ID in `apps/api/wrangler.jsonc` before the first automated release. Configure
the API and web runtime secrets in their respective Cloudflare Worker settings;
GitHub build secrets are not automatically Worker runtime secrets. The web
Worker's `API_UPSTREAM_ORIGIN` must equal `API_WORKER_ORIGIN`; the API Worker's
`PUBLIC_WEB_ORIGIN` must equal `WEB_WORKER_ORIGIN`. Keep their
`WEB_PROXY_SHARED_SECRET` values identical. Check the two readiness URLs on
the generated `workers.dev` origins before relying on the automated release.

Do not enable independent Cloudflare Git-triggered production deployments for
these same Workers. Otherwise they may deploy before GitHub Actions finishes the
database migration. Review every schema change for compatibility with the
previously deployed Worker: if migration succeeds but deployment fails, the
database remains migrated, and recovery needs a compatible deployment or a
reviewed forward migration rather than an assumed SQL rollback.

## Bun/VPS choice

## Host preparation

1. Provision a supported Linux host and create an unprivileged system account:

   ```bash
   sudo useradd --system --home /opt/lovechapter --shell /usr/sbin/nologin lovechapter
   sudo install -d -o lovechapter -g lovechapter /opt/lovechapter/releases
   sudo install -d -m 0750 -o root -g lovechapter /etc/lovechapter
   ```

2. Install Node.js 24 and npm 11 for dependency installation/builds. Install
   Bun 1.4.2 from Bun's official versioned release and place the verified binary
   at `/usr/local/bin/bun`. Abort unless `/usr/local/bin/bun --version` prints
   exactly `1.4.2`.
3. Install Caddy from its signed upstream package repository.
4. Expose only required administration plus TCP 80/443 for certificate issuance
   and HTTPS. Never expose TCP 3001 publicly.
5. Create `/etc/lovechapter/api.env` and `jobs.env` from the documented
   contracts, owned by root with mode `0600`.

## Build, migrate, and release

Build in a new immutable release directory rather than in `current`:

```bash
cd /opt/lovechapter/releases/RELEASE_ID
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build --workspace @lovechapter/api
npm run smoke:bun --workspace @lovechapter/api
npm run benchmark:auth --workspace @lovechapter/api
npm run build --workspace @lovechapter/jobs
```

Run migrations once with a separate least-privilege migration credential:

```bash
DATABASE_URL='postgres://MIGRATION_ROLE:SECRET@HOST/DB?sslmode=require' \
  npm run db:migrate --workspace @lovechapter/database
```

Review migration compatibility before switching code. Then atomically replace
the release symlink from `/opt/lovechapter`:

```bash
ln -s releases/RELEASE_ID current.next
mv -Tf current.next current
```

Install the checked-in units and proxy example, substitute only a verified API
hostname through Caddy's `API_ORIGIN_HOST` environment, then reload and restart:

```bash
sudo install -m 0644 deploy/systemd/lovechapter-api.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/lovechapter-jobs.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable lovechapter-api lovechapter-jobs
sudo systemctl restart lovechapter-api
curl --fail --silent https://VERIFIED_API_HOST/health/live
sudo systemctl restart lovechapter-jobs
```

The units run as `lovechapter`, restart only on failure, harden filesystem and
kernel access, and allow 35 seconds for the application's 30-second drain. The
API must be healthy before jobs resume. Run staged cookie, proxy, email,
graceful-restart, lease-recovery, and pool-exhaustion tests before production.

## Caddy and logging

`deploy/Caddyfile.example` terminates publicly trusted TLS and proxies only to
`127.0.0.1:3001`. Caddy access logging is intentionally absent, and the Bun
applications do not enable raw request logging. Invitation tokens are bearer
credentials in URL paths.

Request logging may be enabled only after an automated redaction layer proves
it removes invitation paths, cookies, full email addresses, proxy credentials,
raw client addresses, and verification/reset action tokens. Structured event
names and sanitized error codes are allowed.

## Password benchmark

Run `npm run benchmark:auth --workspace @lovechapter/api` on the selected VPS.
It performs one warm-up plus 20 production-policy scrypt hashes with no more
than two concurrent hashes, reports p50/p95/max and RSS, and exits non-zero when
p95 exceeds 750 ms. The local result is evidence about the development runner
only; the selected VPS must pass separately.

## Secret rotation

- Proxy credential: deploy the new value to the API and web secret stores in a
  coordinated maintenance window; verify ingress before removing the old
  deployment.
- Rate-limit HMAC key: rotate only with an accepted reset of current buckets.
- Action-token keys: add a new version to both API and jobs, deploy old+new,
  change `AUTH_TOKEN_ACTIVE_KEY_VERSION`, wait for queued jobs and the maximum
  token lifetime to drain, then remove the old version.
- Database/Resend credentials: create the replacement, deploy and verify it,
  then revoke the old credential.

Never reuse one secret for multiple purposes. Production email stays blocked
until Resend verifies the sender/domain.

## Backup, rollback, and recovery

- Enable and verify Neon backups/PITR according to the selected plan; perform a
  restore drill before launch and on a defined schedule.
- Retain the prior immutable release. For an application rollback, stop jobs,
  atomically repoint `current`, restart API, verify liveness/readiness and the
  auth flow, then restart jobs.
- Do not reverse a migration blindly. Each release must document whether the
  previous application remains compatible; otherwise use a reviewed forward
  fix or restore into an isolated database before recovery.
- Confirm leased email jobs recover after process termination and Resend
  idempotency prevents duplicate sends.

## Remaining production gates

1. Confirm domain ownership, DNS, public TLS, and exact web/API origins.
2. Select the VPS and Neon regions and supply staging credentials.
3. Repeat the concurrency suite against a confirmed disposable staging database
   and inspect representative live query plans.
4. Verify the Resend sender/domain and end-to-end verification/reset email.
5. Pass the scrypt budget on the selected VPS.
6. Validate Worker dry-run/deploy output and prove no secrets enter client
   bundles.
7. Exercise firewall, backup restore, rollback, graceful restart, job recovery,
   pool exhaustion, proxy/cookie, and token-redaction procedures in staging.
