# LoveChapter — Deployment

## Selected installation and release policy

The first public installation selects the Cloudflare API Worker backend. Its
frontend Worker is the only browser-facing entry point: browser API requests
use the frontend's same-origin proxy. The API Worker uses invocation-scoped
`pg.Client` connections through cache-disabled Hyperdrive and bounded
scheduled handlers. A different installation may select Bun/VPS instead; do
not run both backend choices against one installation.

There is no staging promotion or reviewer gate. An owner-controlled,
fast-forward push to protected `main` runs `.github/workflows/release.yml`:

```text
exact main SHA -> CI + disposable PostgreSQL tests
               -> compare with last successful production deployment
               -> build and upload inactive selected Worker versions
               -> whole-site maintenance + lease drain
               -> pending migration (verified recovery point first if breaking)
               -> promote selected Worker version(s) -> private smoke
               -> atomic gate reopen -> public check -> GitHub deployment record
```

Web-only changes deploy only `lovechapter-web`; API/job-only changes deploy
only `lovechapter-api`. Shared or uncertain changes deploy both. A breaking
schema/API change also deploys both. Every application deployment closes the
whole site, even when only one Worker changes. Documentation-only changes
run CI but do not close or deploy. The workflow is serial, and
`PRODUCTION_RELEASE_ENABLED` was enabled after first publication and cleanup
CI. Setting it to `false` pauses production cutovers while leaving CI active.
After a post-closure failure, leave maintenance on; use a reviewed forward fix
or a verified database restore, not an old Worker against a new schema.

The existing staging Workers and Neon branches are not release prerequisites.
Their configuration remains only to avoid changing that live installation
incidentally; no staging acceptance job runs. Do not delete those external
resources through this runbook.

## One-time first production publication — completed 2026-09-27

This is a historical operator record, not a procedure to rerun. The
temporary workflow has been retired after a successful two-Worker
publication at `0d4140888ed45ecbe91b8d706341e2470b50ad22` (GitHub run
`36323408754`). The current release gate and deployment record now establish
the baseline for `.github/workflows/release.yml`. The numbered steps below
document the original first-installation checks for incident review only.

Normal selective releases require an open PostgreSQL gate and a matching
successful GitHub production deployment record. Neither exists for the first
publication. Do this initial, both-Worker publication once, with the automatic
flag off. A pre-`0011` database is valid input; do not assume the Neon
`production` branch is empty or copy staging data into it.

Stop before touching production if any target identity, credential, data
retention check, or recovery method is unknown:

1. Read the actual Neon project, `production` branch ID, endpoint host,
   migration ledger, retained-row counts, and snapshot/PITR eligibility.
   Confirm it is the intended branch and no other API or job runner writes to
   it. For a breaking pending migration on a pre-`0011` branch, confirm no
   public API/jobs or active leases exist and create/read back a recoverable
   point before SQL. If a versioned gate already exists, close and drain it
   before that point. If the branch/plan cannot provide one, stop.
2. Confirm protected `main`, owner-only write access, and GitHub
   `production` environment without required reviewers. Confirm there is
   no separate Cloudflare Git deploy that can bypass this workflow.
3. Provision production-only, cache-disabled Hyperdrive to that Neon branch.
   Replace the placeholder ID in the root API Wrangler config. Provision
   `lovechapter-api` and `lovechapter-web` with Preview URLs disabled.
   Configure generated `*.workers.dev` origins. The owner has registered
   `lovechapter.net` and verified Resend Sending, but its web route and TLS are
   a separate later check.
   Configure the bindings/secrets below in Cloudflare and the release values
   in GitHub's production environment. Check names, never print values.
4. At the candidate SHA, run the same checks as CI before any production
   gate or migration:

   ```bash
   npm ci
   npm run ci
   npm run build:worker --workspace @lovechapter/api
   npm run build --workspace @lovechapter/web
   ```

   Run the PostgreSQL integration on a **separate disposable local database**,
   never against Neon production. Inspect the reviewed migration SQL and
   retained-data transformation. The first two-Worker migration test covers
   `0010` to current schema with an all-null version baseline.

5. Confirm no public production Worker serves traffic or jobs, no active
   leases remain, and the verified recovery point exists if required. Apply
   pending checked-in migrations with a direct, separately authorized
   migration URL:

   ```bash
   DATABASE_URL='<direct production migration URL>' npm run db:migrate --workspace @lovechapter/database
   ```

   Validate the ledger, new schema, and retained-row counts on the exact
   `production` branch. If production was already serving traffic, this
   initial procedure is **not** applicable: stop and design a closed cutover.

6. With the release-target environment variables loaded from a trusted
   secret store, close and drain the gate at the exact full commit SHA:

   ```bash
   npm run release:gate --workspace @lovechapter/database -- status
   npm run release:gate --workspace @lovechapter/database -- close --sha <40-hex-SHA>
   npm run release:gate --workspace @lovechapter/database -- drain --sha <40-hex-SHA>
   npm run release:gate --workspace @lovechapter/database -- status
   ```

   Require `maintenance`, the exact SHA, and zero active leases. Keep the
   closure timestamp from the final status. Do not start production cron
   outside the closed gate.

7. Upload both prechecked Worker versions while Preview URLs are disabled,
   then promote both exact uploaded version IDs while the gate remains
   closed. The first deployment is explicitly both Workers; later releases
   can be selective. The web upload uses Vinext's generated
   `dist/server/wrangler.json` so the version includes its static assets.
   Use `wrangler versions deploy <version-id>@100%` for each Worker; do not
   rerun a general `wrangler deploy` that also mutates route settings. Read
   back both active Cloudflare version IDs and confirm Preview URLs remain
   off. Never infer IDs from build output alone.

8. Run `runPrivateReleaseSmoke` from `scripts/release-smoke.mjs` against
   the generated web/API origins using the actual closed-gate status, Worker
   IDs, and distinct proxy/probe secrets. Require `passed: true` and an
   `acceptedAt` later than the closure. Build production release evidence
   with `buildReleaseEvidence` from
   `scripts/release-evidence-builder.mjs`: both components `changed: true`,
   both `sourceSha` equal the candidate, `environment: production`,
   `inboxDelivery: waived`, and the actual migration outcome. Supply that
   JSON file to:

   ```bash
   npm run release:gate --workspace @lovechapter/database -- open --sha <40-hex-SHA> --evidence <verified-evidence.json>
   ```

   The CLI verifies the closed timestamp, target, versions, and evidence
   before an atomic reopen. If it fails, keep maintenance closed.

9. Run `runPublicReleaseCheck` against the opened pair. Only after it
   passes, call `recordDeployment` from `scripts/deployment-ledger.mjs`
   using `createGitHubDeploymentClient` to create the first successful
   `lovechapter-worker-release` GitHub production deployment with both
   actual version IDs. Verify that `readProductionBaseline` matches the open
   PostgreSQL gate. If this final record fails, do not enable automation.
10. Observe public page, same-origin API readiness, denied direct API
    ingress, and scheduled job behavior. The automatic release flag is set
    only after removal of the temporary workflow passes CI. A later owner
    push should prove one normal selective release. Real inbox receipt was
    waived for this first publication, not claimed to have passed.

This first-publication sequence requires operator review of real provider
metadata; the repository cannot declare it complete merely because local CI
passes. Do not put production URLs, passwords, tokens, or evidence containing
secrets in Git or chat.

## Production environment names

GitHub `production` variables: `PRODUCTION_RELEASE_ENABLED`,
`RELEASE_NEON_PROJECT_ID`, `RELEASE_NEON_BRANCH_ID`,
`RELEASE_DATABASE_NAME`, `RELEASE_DATABASE_ROLE`,
`RELEASE_APP_DATABASE_ROLE`, `RELEASE_MIGRATION_DATABASE_ROLE`,
`RELEASE_CLOUDFLARE_ACCOUNT_ID`, `RELEASE_HYPERDRIVE_ID`,
`RELEASE_WEB_ORIGIN`, and `RELEASE_API_ORIGIN`.

GitHub `production` secrets: `RELEASE_DATABASE_URL`,
`RELEASE_MIGRATION_DATABASE_URL`, `RELEASE_NEON_API_KEY`,
`RELEASE_CLOUDFLARE_API_TOKEN`, `WEB_PROXY_SHARED_SECRET`, and
`RELEASE_PROBE_SECRET`. The two release URLs must be direct Neon connections
to the verified branch with their declared roles; the migration role may
apply reviewed schema changes. The Neon API key and Cloudflare token must be
scoped to the necessary project/account. Never reuse the proxy and probe
secrets.

API Worker: cache-disabled `HYPERDRIVE` binding, `NODE_ENV=production`,
`AUTH_MODE`, `PUBLIC_WEB_ORIGIN`, `WEB_PROXY_SHARED_SECRET`,
`RATE_LIMIT_HMAC_KEY`, `AUTH_TOKEN_ACTIVE_KEY_VERSION`,
`AUTH_TOKEN_HMAC_KEYS`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`.
Web Worker: `API_UPSTREAM_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, and
`RELEASE_PROBE_SECRET`. The origins must match the generated production
Worker URLs exactly. Generate unrelated 32-byte base64url values for each
secret purpose. `AUTH_TOKEN_HMAC_KEYS` is a JSON map of numeric key versions.
The first production publication kept `AUTH_MODE=disabled`. The checked-in
production Worker config now selects `local` after the production verification
email was sent by the scheduled Worker and its account was verified, the
required binding names were confirmed, and the measured production-policy
scrypt CPU cost was compared with the owner-confirmed Workers Paid/Standard
budget. Do not deploy `local` if those prerequisites regress; `development` is
forbidden in production. An automated release still marks real-inbox delivery
as waived because inbox receipt is not part of its repeatable CI gate.

## Bun/VPS option for a different installation

Install Bun 1.4.2, Node.js 24/npm, Caddy, and a supported Linux host with at
least 2 vCPU/2 GiB RAM pending measured scrypt and pool tests. Run one
always-on Bun API process and a separate bounded Bun job process using direct
Neon `pg.Pool` connections. Keep root-owned mode-`0600` API/job environment
files under `/etc/lovechapter`; never expose API port 3001 publicly. The
checked-in `deploy/systemd/` units and `deploy/Caddyfile.example` are
examples, not an active production installation. Build both Bun artifacts,
test both runtime paths, close and drain the same whole-site gate, stop jobs
for a breaking migration, validate a recoverable data point, migrate, switch
the immutable release, verify API/jobs, then reopen. A VPS installation needs
its own reviewed operational cutover and is not deployed by the Worker
workflow.

## Recovery and observability

For a breaking release, a verified Neon recovery point is created only after
drain and before SQL. A failed or ambiguous snapshot operation blocks SQL and
leaves maintenance on. Do not blindly restart an older Worker against a new
schema or treat code rollback as database rollback. Keep old releases and
recovery identifiers, review a forward fix or restore as a coupled code/data
decision, and verify critical flows before reopening.

Invitation URLs and action tokens are bearer credentials. Do not log full
paths, cookies, raw email addresses, proxy/probe headers, connection strings,
or provider response bodies. Revisit monitoring, production email delivery,
and retention before launch.
