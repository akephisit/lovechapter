# LoveChapter — Deployment

## Status and topology

The deployable API/job artifacts, configuration parsers, example systemd
services, Caddy example, and local validation commands exist. No infrastructure
is provisioned or claimed by this repository. Domain ownership, DNS/TLS, VPS,
Neon staging/production credentials, Resend verification, and the frontend
Worker deployment remain external gates.

```text
Browser -> Cloudflare frontend Worker -> same-origin /api proxy
        -> verified HTTPS API hostname -> Caddy -> 127.0.0.1:3001
        -> Elysia/Bun API -> bounded pg pool -> Neon PostgreSQL

systemd -> Bun jobs -> bounded pg pool -> auth email outbox -> Resend
```

The host floor is 2 vCPU and 2 GiB RAM. A smaller class requires fresh scrypt,
pool, and concurrent-request measurements.

## Runtime environment contract

Store API and job variables in root-owned files under `/etc/lovechapter` with
mode `0600`. Store Worker secrets in the hosting platform's secret store. Never
commit real values.

| Process | Required environment                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API     | `DATABASE_URL`, `DATABASE_POOL_MAX=6`, `AUTH_MODE=local`, `PUBLIC_WEB_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, `RATE_LIMIT_HMAC_KEY`, `AUTH_TOKEN_ACTIVE_KEY_VERSION`, `AUTH_TOKEN_HMAC_KEYS`, `API_HOST=127.0.0.1`, `API_PORT=3001` |
| Jobs    | `DATABASE_URL`, `DATABASE_POOL_MAX=2`, `PUBLIC_WEB_ORIGIN`, `AUTH_TOKEN_ACTIVE_KEY_VERSION`, `AUTH_TOKEN_HMAC_KEYS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                                                                      |
| Web     | `API_UPSTREAM_ORIGIN`, `WEB_PROXY_SHARED_SECRET`                                                                                                                                                                                |

`API_HOST` and `API_PORT` are the implementation's names for the plan's generic
host/port settings. The checked-in systemd unit pins both so only the API gets a
loopback listener. Production rejects `AUTH_MODE=development`.

Generate the proxy credential, rate-limit key, and each action-token key
independently as canonical 32-byte base64url values. `AUTH_TOKEN_HMAC_KEYS` is a
JSON object whose keys are positive integer versions, for example
`{"1":"<32-byte-base64url>"}`. API and jobs must receive the same retained key
set and active version.

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
3. Run the disposable PostgreSQL concurrency suite and representative live
   query plans.
4. Verify the Resend sender/domain and end-to-end verification/reset email.
5. Pass the scrypt budget on the selected VPS.
6. Validate Worker dry-run/deploy output and prove no secrets enter client
   bundles.
7. Exercise firewall, backup restore, rollback, graceful restart, job recovery,
   pool exhaustion, proxy/cookie, and token-redaction procedures in staging.
