# LoveChapter — Deployment

## Status and topology

Choose one backend path for each installation: **Cloudflare API Worker** or
**Bun/VPS**. Never run both APIs or both job processors against the same
deployment. Both paths use the same Elysia API, Neon schema and frontend
same-origin proxy. The first production installation selects the Worker
backend (ADR-026); the Bun/VPS option remains available for a different
installation. No infrastructure is provisioned or claimed by this repository
itself: a separate Worker staging installation exists, with local Git-ignored
credentials and PR #2 acceptance recorded in `docs/PROGRESS.md`. Production
resources, a production maintenance gate, and production promotion are not
in place. The staging maintenance gate passed its Worker drill; see
`docs/PROGRESS.md`. This does not enable a production cutover.
Neither a VPS nor a custom domain is required for the Worker path.

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
| Web        | `API_UPSTREAM_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, `RELEASE_PROBE_SECRET`                                                                                                                                                              |

`API_HOST` and `API_PORT` are the implementation's names for the plan's generic
host/port settings. The checked-in systemd unit pins both so only the API gets a
loopback listener. Production rejects `AUTH_MODE=development`.

Generate the proxy credential, rate-limit key, and each action-token key
independently as canonical 32-byte base64url values. `AUTH_TOKEN_HMAC_KEYS` is a
JSON object whose keys are positive integer versions, for example
`{"1":"<32-byte-base64url>"}`. API and jobs must receive the same retained key
set and active version.

## Cloudflare API Worker choice

### First staging bootstrap (no Worker exists yet)

The initial staging installation uses the Worker backend. Both Wrangler
configs now define `env.staging`, which creates separate
`lovechapter-web-staging` and `lovechapter-api-staging` Workers on the first
staging deploy. Do not create placeholder Workers manually or run the default
`deploy` commands to discover URLs. Wrangler can warn about an undefined
environment yet continue with top-level bindings, so use the explicit staging
commands and require the staging dry-run to show the staging Hyperdrive ID.

The initial staging bootstrap uses `AUTH_MODE=disabled` and
`triggers.crons=[]`.
This mode rejects identity on protected routes, but the `/v1/auth/*` HTTP
routes remain callable and may write rate-limit state or enqueue mail. It is
not a full maintenance gate; keep the staging URL private until testing is
ready. Even with protected-route identity disabled, HTTP requests still validate
`PUBLIC_WEB_ORIGIN`, the proxy credential, rate-limit key, and action-token
keys. Scheduled handlers validate the Resend settings independently. A web
bootstrap deployment made only to learn its real URL has an unavailable
`/api` route until the API and proxy settings are complete; do not invite
testers during this interval.

1. Provision a separate Neon staging branch/database and a disposable test
   database. Apply migrations with a direct migration credential outside
   Workers; the PostgreSQL integration suite truncates tables, so it must
   never target the live staging application database.
2. In Cloudflare, create a **staging-only**, cache-disabled Hyperdrive
   configuration using a direct/unpooled Neon application credential. Verify
   caching is disabled. Replace only
   `REPLACE_WITH_STAGING_HYPERDRIVE_ID` under `env.staging` in
   `apps/api/wrangler.jsonc` with its ID. Leave the top-level binding and
   production choice untouched. Never put the Neon URL or password in
   Wrangler, Git, or chat.
3. Log in to Cloudflare on the trusted deployment machine, then inspect both
   staging targets without deploying:

   ```bash
   npx wrangler login
   npm run build:worker:staging --workspace @lovechapter/api
   npm run deploy:staging --workspace @lovechapter/web -- --dry-run
   ```

   Abort if Wrangler reports that `staging` is undefined, uses the top-level
   Hyperdrive ID, or shows a placeholder ID. The API staging deploy command
   checks these conditions again before publishing.

4. Run `npm run deploy:staging --workspace @lovechapter/web` once to create
   the web Worker and copy its **actual** `https://...workers.dev` origin from
   the output. Keep this bootstrap URL private until the proxy works.
5. On that trusted machine, put the following values in
   `apps/api/.env.staging` (Git ignores `.env.*`) and set its permissions to
   `0600` with `chmod 600 apps/api/.env.staging`. This is a temporary local
   Wrangler secrets file, **not** a file to commit or paste in chat:

   ```dotenv
   PUBLIC_WEB_ORIGIN=https://ACTUAL_WEB_STAGING_ORIGIN.workers.dev
   WEB_PROXY_SHARED_SECRET=INDEPENDENT_32_BYTE_BASE64URL_VALUE
   RATE_LIMIT_HMAC_KEY=ANOTHER_32_BYTE_BASE64URL_VALUE
   AUTH_TOKEN_ACTIVE_KEY_VERSION=1
   AUTH_TOKEN_HMAC_KEYS='{"1":"THIRD_32_BYTE_BASE64URL_VALUE"}'
   RESEND_API_KEY=YOUR_STAGING_SENDING_KEY
   RESEND_FROM_EMAIL=VERIFIED_STAGING_SENDER
   ```

   Generate the three cryptographic values independently. A test sender on
   `resend.dev` can send only to the email address associated with that
   Resend account; a verified owned domain is required before testing
   delivery to other recipients. The API Worker needs this complete set on
   first functional deployment, even while `AUTH_MODE=disabled`.

6. From the repository root, deploy the API Worker **with** the secrets file:

   ```bash
   npm run deploy:worker:staging --workspace @lovechapter/api -- --secrets-file .env.staging
   ```

   This creates `lovechapter-api-staging` and uploads the secrets in the same
   deployment. Confirm the actual API origin from Wrangler output.

7. In Cloudflare Workers & Pages, open **only** `lovechapter-web-staging` →
   Settings → Variables and Secrets. Add `API_UPSTREAM_ORIGIN` containing the
   exact API HTTPS origin (a plaintext variable or secret) and
   `WEB_PROXY_SHARED_SECRET` as a secret matching the API value. For a
   gate-aware web revision, add `RELEASE_PROBE_SECRET` as a separate canonical
   32-byte base64url secret, never equal to the proxy credential. It grants
   only GET/HEAD maintenance-page presentation bypass for private release
   probes; it never authorizes an API operation. Deploy those settings, then
   redeploy the web Worker with the staging command. The secrets may
   also be uploaded together as secrets using `wrangler secret bulk --env
staging`; the web config's `keep_vars` preserves them on code redeploy.
   Confirm `/api` reaches the API Worker, never itself or the Bun/VPS backend.
8. After Neon, proxy, Resend delivery, and Worker scrypt checks pass on a
   plan with sufficient sustained CPU budget, deploy staging with
   `AUTH_MODE=local` while keeping `triggers.crons=[]`. Verify registration,
   sign-in, and the auth email outbox first. The production-policy scrypt path
   measured more than 128 ms of CPU on the staging Worker, far beyond the
   Workers Free 10 ms request allowance. Short successful probes are not
   evidence that Free is viable. Do not weaken password hashing to fit that
   allowance.
9. After inspecting the queued auth mail and confirming the Resend sender and
   recipient, enable the two staging cron triggers in a separate reviewed
   change. Cron changes can take time to propagate; verify actual scheduled
   work, email delivery, and the absence of a second job processor.

The staging bootstrap is not a production release. The repository has no
Cloudflare/Neon/Resend credentials and no automated staging deployment job.
Do not configure production secrets, migration, or promotion based on a
successful bootstrap alone.

Before using pre-cutover `wrangler versions upload`, disable public Version
URLs for **both** Workers. `preview_urls: false` is checked into both Wrangler
configs, but the release preflight also reads Cloudflare's current
`previews_enabled` setting and fails if it is still enabled. A version upload
must not expose a new API revision through a public Version URL while the
ordinary site remains open. The existing staging Workers have not yet been
verified or changed to this setting as part of the automatic-release work.

### Later selected-Worker installation (not the staging bootstrap)

The steps below apply only after selecting the Worker backend for that
installation. The top-level Wrangler binding and default deploy commands are
not staging targets. Do not use them for the first staging installation or for
production before the acceptance and cutover gates below are implemented.

1. Create Neon and apply existing Drizzle migrations from a trusted machine/CI
   using a separate direct migration credential. On an existing installation,
   follow the cutover gate below **before** an incompatible migration. No
   GitHub workflow currently runs a migration or deploys production
   automatically:

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

### Release coordination and staging gate

CI verifies both supported backend builds but does not deploy either backend.
An installation must explicitly select exactly one backend runtime, `worker` or
`bun-vps`, and configure one frontend `API_UPSTREAM_ORIGIN` for it. Do not run
the other API/job processor against that installation's database. The first
Worker staging installation has local, Git-ignored credentials and live
acceptance evidence recorded in `docs/PROGRESS.md`. ADR-025 defines the
approved split evidence for email retry. PR #2's final CI and post-merge CI
passed; it was merged to `main` as `6305488`. The next gate is implementation
and staging acceptance of the maintenance/cutover subsystem, not a rerun of
the merged PR's CI.

`.github/workflows/release.yml` is a serial, non-canceling push-to-`main`
coordinator. It repeats CI and disposable PostgreSQL integration on the exact
merged SHA. Its staging and production jobs are both **disabled by default**:
`STAGING_RELEASE_ENABLED` and `PRODUCTION_RELEASE_ENABLED` must each be set to
`true` only after their independent bootstrap/acceptance checklists pass.
The workflow keeps up to 100 pending releases in one queue; a queued SHA is
rechecked against the live `main` ref before preparation and after build, so
a superseded run cannot close the site. Release impact is calculated from an
accepted baseline to the checked-out SHA, not the immediately previous push.
The release CLI currently rejects even an enabled job until the live adapter
and evidence handoff are installed and validated. Never enable either flag
merely because the workflow file exists. The existing PR CI remains separate
and receives no release secrets. GitHub staging and production environments
must restrict deployment to protected `main`; the CLI also requires a
protected push-to-`main` context and exact commit SHA. No Cloudflare Git
autodeploy may bypass the coordinator.

Production credentials, protected environment, and enforced acceptance gate
are not in place, so automatic production deployment remains disabled. In
particular, merging must not silently deploy production before the approved
release controls and separate resources exist.

For a release, classify changed paths with `scripts/release-impact.mjs` using
full base and head commit SHAs:

```bash
node scripts/release-impact.mjs worker FULL_BASE_SHA FULL_HEAD_SHA
```

Use `bun-vps` instead of `worker` only for a Bun/VPS installation; the planner
rejects unset or combined selections.

Web-only changes deploy only the web Worker; API/jobs/auth/database-code-only
changes deploy only the selected backend. Migration, shared contracts/domain,
or unfamiliar source changes plan both components. **Every application
deployment**, including a web-only or API-only one, closes and drains the
whole-site maintenance gate. Builds and preflight checks finish before
closure; selective deployment happens while closed. Docs-only changes skip
maintenance and deployment. The planner cannot prove whether a migration is
breaking or whether a cutover gate exists; that review is mandatory before
execution. CI should still verify both supported runtimes. Do not add legacy
database structures or dual-version API behavior just to make every change
compatible with a rolling release.
The planner fails closed if `packages/database/src/schema.ts` changes without
an added or modified SQL migration under `packages/database/drizzle/`. A
deleted SQL migration does not satisfy this guard. Even a valid changed SQL
file still requires human review of the generated migration and cutover plan.

A **breaking** schema or API change requires a coordinated cutover, not the
ordinary sequential deploy. Before migration, an enforced maintenance/routing
gate must stop new writes and drain in-flight requests. Pause and verify all
scheduled/background workers for the selected backend; for Workers this
includes Cron Triggers, not just HTTP traffic. Verify a recoverable Neon
backup/PITR point, then transform and validate existing data, deploy the
selected backend and web from the same tested revision, smoke-test the new
system, and only then reopen traffic and jobs. Never run an old Worker or Bun
process against the new incompatible schema. The gate-aware code and staging
operator command passed an active staging closure/drain/reopen drill on
`5718cdc`, including a disposable-branch PITR rehearsal. A breaking
**production** migration remains blocked because the production gate,
resources, permissions, and promotion workflow do not exist. The Worker design is in
`docs/superpowers/specs/2026-09-26-worker-maintenance-cutover-design.md`.
This deliberately permits a maintenance window; it does not promise zero
downtime.

### Staging Worker maintenance cutover (gate-aware revisions only)

The `release:gate` command understands `RELEASE_ENVIRONMENT=staging` and
`production`, but production use remains disabled by the release workflow
until the protected-source and first-publication bootstrap gates pass.
Run it on a trusted operator machine with Bun 1.4.2 and a separate
`RELEASE_DATABASE_URL` direct, non-pooled TLS credential. Load the credential
from a restricted secret store or mode-`0600` local file; do not paste it into
Git, chat, command arguments, or logs. The command rejects pooled-looking
hosts and does not fall back to the application `DATABASE_URL`. Verify the
Neon project, branch, database, and role independently before any command.
The CLI requires environment-scoped `RELEASE_NEON_PROJECT_ID`,
`RELEASE_NEON_BRANCH_ID`, `RELEASE_DATABASE_NAME`, `RELEASE_DATABASE_ROLE`,
`RELEASE_APP_DATABASE_ROLE`,
`RELEASE_CLOUDFLARE_ACCOUNT_ID`, `RELEASE_HYPERDRIVE_ID`,
`RELEASE_NEON_API_KEY`, and `RELEASE_CLOUDFLARE_API_TOKEN`; production reopen
also requires the exact accepted `RELEASE_STAGING_SHA`. It fetches Neon
branch-endpoint and Hyperdrive configuration metadata and rejects any mismatch,
including enabled Hyperdrive query caching, before connecting to PostgreSQL.
`RELEASE_DATABASE_ROLE` must match the direct release URL user and have the
operator privileges needed to change `ops.release_control`.
`RELEASE_APP_DATABASE_ROLE` must match the Hyperdrive origin user, be distinct
from the release role, and retain only the application grants below. The two
roles deliberately share the verified branch endpoint and database, not the
same PostgreSQL privileges.
For automatic migration, also provide environment-scoped
`RELEASE_MIGRATION_DATABASE_URL` and `RELEASE_MIGRATION_DATABASE_ROLE`. The
migration URL must be direct/non-pooled TLS, must identify the selected Neon
branch/database, and must not use the Hyperdrive app role. The migration
command checks the exact drained gate closure, the deployed Drizzle ledger
against checked-in history, and the pending SQL paths against the reviewed
release plan before applying anything. It checks the latest schema hash and
the still-closed gate afterward. A drift or incomplete validation fails the
release in maintenance; do not automatically reopen or retry a partly
understood migration.

The read tokens and direct URLs belong in restricted environment secrets, never
in arguments or output. `RELEASE_ENVIRONMENT` alone does not prove identity.
The CLI accepts only one `sslmode=require` or `sslmode=verify-full` query
parameter plus an optional single literal `channel_binding=require` from a
Neon URL; node-postgres 8.23 does not itself enforce that latter URL option.
It rejects
duplicate or other PostgreSQL URL query options because the driver can use
them to override the authority host, role, database, or TLS behavior after a
superficial URL check.
Reopen evidence must record each Worker's actual version ID, source SHA, and
changed/unchanged status, migration outcome, post-closure private smoke,
accepted staging SHA for production, and the explicit inbox-delivery waiver.
The gate stores both Worker versions atomically with reopen. Migration
`0011_release_versions` and this new evidence contract are not yet applied on
live staging or production. There is no automatic production release yet.

The disabled GitHub release workflow reads target IDs, database/role names,
Hyperdrive ID, and Worker `workers.dev` origins from each environment's
`RELEASE_*` variables. Store direct gate/migration URLs, Neon/Cloudflare API
tokens, `WEB_PROXY_SHARED_SECRET`, and `RELEASE_PROBE_SECRET` as environment
secrets, never repository variables. Staging additionally needs environment
secrets for its verified test account email/password, separate unverified
verification email, and isolated test-branch database URL; set the foreign
tenant wedding ID and test branch ID as staging environment variables. The
workflow receives `GITHUB_TOKEN` and the same-SHA PostgreSQL job result from
GitHub automatically. Keep both release-enabled flags false until the guarded
CLI, protected `main`, scoped secrets, and live staging rehearsal are complete.

The web Worker needs `API_UPSTREAM_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, and
`RELEASE_PROBE_SECRET`; the API Worker does not use the probe secret and instead
needs its ingress, auth-token, rate-limit, public-web-origin, and Resend
settings. Verify secret **names** per Worker without exposing values.

The staging test URL must target a separate Neon branch with the current
schema; the CLI verifies its branch endpoint before creating HTTP fixtures,
and the query-plan transaction rolls its synthetic rows back. A missing or
stale test branch fails acceptance rather than becoming a skipped check.

The API Worker/Hyperdrive application role needs `USAGE` on `ops`, `SELECT`
on `ops.release_control`, `EXECUTE` on `ops.admit_release_lease(text)`, and
`SELECT (id)` plus `DELETE` on `ops.release_leases`. The admission function
locks the control row and inserts a lease atomically as its owner. PostgreSQL
requires an `UPDATE` privilege for direct `SELECT ... FOR SHARE`, so the
Worker must call this function instead of locking the row directly. Its
`SECURITY DEFINER` search path is restricted and `PUBLIC` execution is
revoked in the migration. Do not grant the app role control-row `UPDATE`,
`INSERT`, or `DELETE`; only the direct operator changes gate mode. On a new
installation, do not grant direct lease `INSERT` either. Review actual grants
before bootstrapping the gate-aware Worker. The SQL below is a role-specific
example, not a command to run with the placeholder unchanged:

```sql
GRANT USAGE ON SCHEMA drizzle TO STAGING_APP_ROLE;
GRANT SELECT (id, hash) ON drizzle.__drizzle_migrations TO STAGING_APP_ROLE;
GRANT USAGE ON SCHEMA ops TO STAGING_APP_ROLE;
GRANT SELECT ON ops.release_control TO STAGING_APP_ROLE;
GRANT EXECUTE ON FUNCTION ops.admit_release_lease(text) TO STAGING_APP_ROLE;
GRANT SELECT (id) ON ops.release_leases TO STAGING_APP_ROLE;
GRANT DELETE ON ops.release_leases TO STAGING_APP_ROLE;
REVOKE INSERT, UPDATE, DELETE ON ops.release_control FROM STAGING_APP_ROLE;
REVOKE INSERT ON ops.release_leases FROM STAGING_APP_ROLE;
```

Protected readiness compares the latest recorded Drizzle migration hash to
the hash compiled from the newest checked-in migration. Its CI test requires
updating that compiled value whenever a migration changes. Grant only the
`id`/`hash` ledger columns above; a missing ledger, mismatched migration, or
unreadable ledger makes readiness return 503 while maintenance stays closed.
The operator must check the exact target API/schema pairing before reopening.

For an existing gate-aware deployment, apply the additive function migration,
grant `EXECUTE`, lease `SELECT (id)`, and the narrowed migration-ledger read,
deploy the function-calling API to
100% of traffic, and only then revoke direct lease `INSERT`. Do not revoke it
while an older API version may still be serving. Verify the app role cannot
update the control row or directly insert a lease, and can admit/release via
the function. The web Worker does not need database grants.

For a breaking staging revision, use this sequence. Do not apply an
incompatible migration to active staging until the nonbreaking `ops` migration
is seeded and 100% of both serving Workers are gate-aware. Use one reviewed,
immutable 40-character commit SHA throughout:

1. Build API and web artifacts from that SHA and run CI, disposable-database
   migration/query tests, and the auth/email, RSVP, CSV, and cron acceptance
   checks. Record the currently deployed SHA and the target SHA.
2. Confirm an active-staging Neon recoverable point and rehearse restore on a
   disposable branch, validating retained data. Never rehearse a destructive
   restore on active staging.
3. Close and then drain using the commands below. `drain` waits for zero
   HTTP/email/cleanup leases; a timeout, interrupted command, or
   stuck lease leaves maintenance closed. Investigate the owning operation;
   there is no time-based lease-clear command.
4. Apply the reviewed migration using the separate direct migration role,
   not Hyperdrive or the application role. Validate the resulting business
   schema and retained data while the gate stays closed.
5. Deploy the new API and web Worker versions from that same SHA to all
   staging traffic, without a gradual split with ungated or old-schema code.
   Record both Cloudflare version IDs. Confirm protected readiness and the
   exact API/schema combination, then perform private GET/HEAD web smoke with
   the independent `RELEASE_PROBE_SECRET`. Confirm business API ingress and
   cron remain blocked while closed. The probe does not authorize mutations.
6. Write an operator-controlled JSON evidence file with the exact fields
   below only after the migration and private smoke actually pass. Then run
   the `open` command below. The CLI
   verifies the matching SHA, populated version IDs, true checks, an
   `acceptedAt` later than the current gate closure, and zero active leases;
   PostgreSQL atomically refuses reopening if a lease appears or the gate
   has been closed again since the evidence was checked. Evidence from an
   earlier closure of the same SHA is invalid.
   Confirm public pages, API mutations, and queued email processing resume.

```json
{
  "environment": "staging",
  "commitSha": "FULL_40_CHARACTER_LOWERCASE_SHA",
  "stagingSha": null,
  "web": {
    "versionId": "RECORDED_WEB_VERSION_ID",
    "sourceSha": "FULL_40_CHARACTER_LOWERCASE_SHA",
    "changed": true
  },
  "api": {
    "versionId": "RECORDED_API_VERSION_ID",
    "sourceSha": "FULL_40_CHARACTER_LOWERCASE_SHA",
    "changed": true
  },
  "migration": "not_required",
  "privateSmokePassed": true,
  "inboxDelivery": "waived",
  "acceptedAt": "2026-09-26T00:00:00.000Z"
}
```

The timestamp above is an example only: the real `acceptedAt` must be the
actual post-closure time. For a selective release, retain the unchanged
Worker's previously recorded version and source SHA and set its `changed` to
`false`. For production, `environment` is `production` and `stagingSha` must
equal the exact accepted commit SHA.

After loading the trusted staging environment securely, run the commands
from the repository root; substitute one real full SHA and evidence path:

```bash
npm run release:gate --workspace @lovechapter/database -- status
npm run release:gate --workspace @lovechapter/database -- close --sha FULL_TARGET_SHA
npm run release:gate --workspace @lovechapter/database -- drain --sha FULL_TARGET_SHA
npm run release:gate --workspace @lovechapter/database -- open --sha FULL_TARGET_SHA --evidence /restricted/path/acceptance.json
```

`status` prints mode, target SHA, active lease count, and recorded Worker
versions. `close`,
`drain`, and `open` never output a database URL, token, or invitation. A failed
post-migration smoke stays closed. An old Worker binary alone is not a
rollback for a changed schema: choose a reviewed forward fix or a verified
database restore, validate data and the matching Worker pair, repeat smoke,
and only then reopen. Do not delete a lease solely because it is old. The
evidence file records operator checks; the CLI does not claim inbox receipt
or fabricate staging acceptance.

The first staging installation selects the Worker backend. Provision a
disposable Neon branch, a cache-disabled Hyperdrive binding, Cloudflare API
and web Workers with distinct generated `workers.dev` origins, matching proxy
secrets, and a verified Resend sender. Set `AUTH_MODE=local` only after the
secrets, email transport, scrypt budget, and ingress are verified. Never put
secrets in a commit or chat. Staging and production require separate database,
Hyperdrive, Worker, and secret resources. A future Bun/VPS production release
needs its own Bun/VPS staging acceptance; a passing Worker staging run does not
validate a different runtime.

### Automated staging HTTP fixture

The release coordinator will call `runStagingHttpAcceptance` through the
staging web Worker's `workers.dev` origin. Before enabling it, create one
**staging-only**, email-verified local account and complete onboarding. Store
its email and password as restricted GitHub **staging environment secrets**;
do not put them in workflow arguments, logs, commits, or this document. Do not
reuse a production account. Reserve `delivered@resend.dev` for the separate
unverified verification-request fixture, and verify that it has no existing
staging account. The coordinator also needs a direct staging database
credential scoped for the test fixture, and the ID of an existing staging
wedding owned by a different test account. Neither may point to production.

Each run checks verification and password-reset HTTP acceptance and the
corresponding database outbox records; it signs into the verified account,
checks session and sign-out revocation, proves cross-wedding guest access is
denied, submits and reads back an account-free RSVP, and imports/exports one
Unicode CSV row. It creates a disposable wedding under the verified account
and deletes only its recorded ID and the separate unverified account after
the checks. A failed or incomplete cleanup fails acceptance; an operator
must inspect exact fixture IDs before any manual cleanup. Auth rate limits
still apply, so repeated releases within one window may be rejected rather
than bypassing the limit. The report marks `inboxDelivery: "waived"`:
neither real inbox receipt nor deployed verification/reset link redemption is
certified by this automated check.

For a future release requiring full Worker staging acceptance, record on its
exact commit before the final CI and merge decision:

1. Auth and email: registration, received verification mail, verification,
   sign-in/session, reset mail and session revocation through the web proxy.
2. Guest RSVP: new invitation link, public view, submit/update, invalid and
   replaced token rejection, with no guest account.
3. CSV: bounded UTF-8 upload, mapping/preview/commit, export stream and
   content, rejection/rollback cases.
4. Cron: real Worker scheduled verification/reset email sends and expired
   auth/import cleanup; confirm only the selected backend processes jobs.
   Separately run the disposable PostgreSQL integration test with a controlled
   provider 429 followed by success, proving durable retry timing, lease
   release, stable idempotency, and no duplicate send. ADR-025 explicitly
   replaces a live induced provider failure with these two evidence sources;
   never report that a live 429 was observed.
5. SQL: repeat the disposable PostgreSQL integration/concurrency suite; run
   safe representative `EXPLAIN (ANALYZE, BUFFERS)` for the important SELECTs
   listed in `docs/QUERY_REVIEW.md`, capturing row counts, index choices, and
   round trips. Do not run destructive analysis in production.

After all five pass, rerun CI for the tested commit. Only then consider merge.
Production promotion should run automatically **after** an enforced acceptance
gate for that exact commit; it must not rely on liveness-only smoke tests. The
gate and deployment automation cannot be enabled safely until the chosen
production backend, environment protections, credentials, and staging evidence
exist. Do not enable independent Cloudflare Git-triggered deployment for these
Workers, as it could bypass migration and acceptance ordering. A failed code
deploy does not undo an applied migration; keep the installation closed while
performing a reviewed forward fix or database restore.

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

For a breaking release, first put the frontend behind a tested maintenance
gate, drain in-flight requests, stop both Bun services, confirm they are
inactive, and verify a recoverable Neon backup. Do not use these commands on a
live installation until that gate and a staging recovery drill exist.
Nonbreaking releases may use the ordinary selective path. Run migrations once
with a separate least-privilege migration credential:

```bash
DATABASE_URL='postgres://MIGRATION_ROLE:SECRET@HOST/DB?sslmode=require' \
  npm run db:migrate --workspace @lovechapter/database
```

Validate the transformed data before switching code. Then atomically replace
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
API must be healthy before jobs resume; reopen the frontend only after
critical end-to-end checks pass. Run staged cookie, proxy, email,
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
- Retain the prior immutable release, but do not treat its binary as a complete
  rollback after a breaking migration. Keep traffic and jobs stopped until the
  prior database state is restored and validated, or a reviewed forward fix is
  applied. Switch code and database as one recovery decision, then verify auth
  and other critical flows before reopening.
- Do not reverse a migration blindly or assume restoring code reverses SQL.
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
7. Exercise firewall, backup restore, coordinated cutover/recovery, graceful
   restart, job recovery, pool exhaustion, proxy/cookie, and token-redaction
   procedures in staging. Prove that the maintenance gate blocks writes and
   the selected backend's jobs are paused before a breaking migration.
