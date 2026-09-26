# LoveChapter — Progress

## Current phase

The backend can be packaged either for Bun/VPS or for a Cloudflare API Worker;
choose one backend runtime per installation. The repository includes API/job artifacts,
the same-origin web proxy, account UI, provider-free tests, example systemd and
Caddy assets, an operational handoff, and a GitHub Actions production release
plan. GitHub Actions currently verifies but does not deploy; the former
unconditional Worker production job was removed during the PR #2 review.

This is not a production deployment. A Neon staging branch, disposable
staging-test branch, staging Hyperdrive configuration, and separate web/API
Workers now exist. The web Worker serves pages and its same-origin `/api`
proxy reaches the API Worker; liveness and database readiness pass. Local
identity and both cron schedules are enabled on Worker staging. Auth/email,
RSVP, CSV, cleanup, and representative query-plan checks have run, but a live
retryable email-provider failure was not induced by design. ADR-025 accepts
real scheduled sends plus disposable PostgreSQL retry evidence. The owner
confirmed receipt of both verification and reset email on the test inbox;
the staging code acceptance is recorded below, while remote PR CI remains
pending. There is no VPS, custom domain, or Neon production database
provisioned or claimed.

## Implemented

- Main-branch verification and PostgreSQL integration gates, with no automatic
  production migration or deployment until staging acceptance and runtime
  selection can be enforced
- Cloudflare API Worker fetch/scheduled entry reusing Elysia routes and the
  same-origin web proxy, with Hyperdrive invocation-scoped lazy pg clients;
  bounded email and retention cron handlers; response-stream-aware cleanup
- Worker Wrangler config and deploy dry-run command alongside the unchanged
  Bun/VPS and systemd installation choice
- Bun 1.4.2 API runtime with bounded request/body/time limits, graceful drain,
  readiness, and fail-closed validated configuration
- Separate bounded Bun auth-email job process with leases, retries,
  idempotency, terminal failures, and retention cleanup
- First-party verified-email/password accounts using production-policy scrypt
  with a global concurrency cap of two
- Versioned HMAC action tokens, hashed session secrets, secure production
  cookies, all-session password-reset revocation, and bounded database rate
  limits
- Five auth/outbox tables plus generated migration, constraints, and
  access-pattern indexes
- Bounded direct PostgreSQL pools: API maximum 6, jobs maximum 2
- Next.js/vinext same-origin server proxy with strict path/header policy, body
  cap, cookie forwarding, server-only upstream credentials, HTTPS-only remote
  origins, and `no-store` API responses
- Account/session provider, sign-up/sign-in/verification/reset UI, Unicode-safe
  password handling, and immediate fragment scrubbing
- Wedding, guest, private invitation, account-free RSVP, and couple-visible
  response flow
- Wedding-defined guest affiliations with create, rename, color, reorder,
  assignment/reassignment for new or existing guests, a 100-item bound, and
  transactional delete-to-unassigned behavior; no affiliation is hardcoded or
  seeded
- Guest management with optional contact/envelope/address fields, archive and
  bounded bulk operations; filtered CSV export and creation-only CSV import
  with mapping, duplicate confirmation, idempotent commit, and 24-hour cleanup
- Browser envelope printing with optional address, wedding-scoped saved
  templates, DL/C5/C6/custom sizes, and self-hosted Thai/Latin fonts
- Conservative service worker with no fetch interception or data caching
- Provider-free in-process vertical-slice proof and browser isolation
  regressions
- Scrypt benchmark command with p50/p95/max/RSS output and a 750 ms p95 gate
- Hardened example systemd services, Caddy TLS proxy config, secret rotation,
  rollback, backup, firewall, and atomic-release guidance

## Local validation

Task 10 validation on 2026-09-22 passed:

- format and lint;
- TypeScript checks for every workspace;
- 44 test files / 217 tests;
- Drizzle migration snapshot check;
- Bun API/jobs builds;
- native Next production build;
- vinext compatibility check at 94%, zero issues and one documented partial
  `reactStrictMode` item;
- vinext production build;
- active-source legacy-provider/deprecated-config scan with zero matches.

Task 11 added benchmark unit coverage and produced this local-runner result:

```json
{
  "benchmark": "scrypt",
  "p50Ms": 316.84606699999995,
  "p95Ms": 380.91432699999996,
  "maxMs": 402.899176,
  "samples": 20,
  "maxConcurrent": 2,
  "rssMiB": 49.2
}
```

Task 11's complete local validation also passed formatting, lint, every
workspace typecheck, 46 test files / 220 tests, Drizzle snapshot validation,
API build and Bun smoke, the benchmark budget, jobs build, native Next build,
vinext compatibility/build, Cloudflare deployment dry-run, and
`git diff --check`. `systemd-analyze verify` accepted both unit structures and
reported only that the deployment-path `/usr/local/bin/bun` is intentionally
absent on this development runner.

Task 12's whole-branch review found and fixed session refresh write
amplification, durable-email shutdown dequeueing, persisted idempotency-key
use, and plaintext remote-origin acceptance. Focused regression coverage and
the final release gate passed on 2026-09-22: formatting, lint, every workspace
typecheck, 46 test files / 229 tests, Drizzle snapshot validation, API/jobs and
vinext builds, Bun runtime smoke, native Next build, vinext compatibility at
94% with zero issues, and Cloudflare deployment dry-run. The final benchmark
reported p50 `279.59 ms`, p95 `362.25 ms`, maximum `378.92 ms`, concurrency 2,
and RSS `48.7 MiB`, within the 750 ms p95 budget.

The guest-affiliation slice adds a wedding-scoped table and composite tenant
foreign key, API/domain/repository operations, couple-workspace controls, stale
request guards, and confirmation before deletion. Focused API, database, domain,
and web tests pass. A disposable-PostgreSQL suite covers tenant isolation,
delete-to-unassigned, the concurrent 100-item limit, and assignment/delete
races; it remains a staging gate until `TEST_DATABASE_URL` is supplied. The
complete provider-free release gate result is recorded when this branch
finishes verification.

The final provider-free guest-affiliation release gate passed on 2026-09-23:
formatting, lint, every workspace typecheck, 46 test files / 247 tests, Drizzle
snapshot validation, API/jobs and vinext builds, Bun runtime smoke, native Next
build, vinext compatibility at 94% with zero issues, and Cloudflare deployment
dry-run. `git diff --check` also passed. The disposable PostgreSQL suite was not
executed because this runner has no `TEST_DATABASE_URL`; it remains an explicit
staging gate rather than a claimed result.

The guest-management slice adds optional contact, envelope, note, and postal
address fields; wedding-scoped filtered/keyset lists and authorized details;
recoverable archive/restore with invitation revocation; atomic bounded bulk
affiliation/archive; and a couple-facing search/filter/edit workspace. Address
is never required to add a guest. On 2026-09-23 formatting, lint, workspace
typechecks, and 47 test files / 280 tests passed. `npm run ci` progressed through
those checks but stopped at the API build because `bun` is not installed in
this runner (`sh: bun: not found`); no Bun build, smoke, native Next build,
vinext check, or deployment dry-run result is claimed for this slice. The
disposable PostgreSQL integration suite and representative `EXPLAIN` plans
remain staging gates because `TEST_DATABASE_URL` is unset.

The CSV export slice now streams the current authorized guest filter in 500-row
keyset pages, with the agreed 15-column BOM/CRLF CSV header, RFC 4180 quoting,
spreadsheet-formula neutralization, and no invitation credentials. The API and
same-origin proxy expose a no-store download, and the guest workspace has an
“Export filtered CSV” control. On 2026-09-23, the focused export regression
passed 118 tests; repository-wide format, lint, all workspace typechecks, and
48 test files / 296 tests passed. A target-spreadsheet manual fixture check,
disposable PostgreSQL parity run, Bun builds and smoke, and deployment dry-run
have not been run in this environment; Bun remains unavailable here.

The CSV import slice parses `text/csv` with `csv-parse@7.0.2` and keeps the
existing 1 MiB body limit. It bounds input to 5,000 rows, 40 columns, and
4,096 Unicode characters per cell. The upload discards raw bytes after
parsing; normalized staging expires after 24 hours and is cleaned 500 batches
at a time on the 15-minute jobs cadence. Mapping, validation, duplicate
warnings, exclusions, and explicit “create anyway” decisions precede a
creation-only, atomic, version-checked, idempotent commit. Address is optional.
The wizard renders guest values as text and refreshes the guest list after
success. SQL concurrency tests are checked in but cannot run without an
explicitly disposable `TEST_DATABASE_URL` and confirmation flag.
Single and bulk archive require confirmation; invitation creation and archive
lock the same guest row so restored guests cannot regain old invitation links.

Envelope printing selects 1–500 active guests and preserves their order. It
uses `envelopeName` or falls back to `name`; name-only mode never requires an
address. Address mode visibly warns on missing addresses. Wedding-scoped
templates are capped at 50, with integer dimensions of 90–330 × 55–480 mm,
safe margins, whitelisted alignment/font choices, and no custom HTML/CSS.
DL (220 × 110 mm), C5 (229 × 162 mm), and C6 (162 × 114 mm) are built in.
The print view uses one page per guest and locally bundled Noto Sans/Serif Thai
variable fonts; printing waits for `document.fonts.ready`. Real-printer
orientation, 100% scaling, and non-printable margins require one physical
test envelope before a larger run. The disposable PostgreSQL integration
suite and representative query plans remain staging gates; no live DB or
printer is available in this runner.

The 2026-09-23 provider-free regression after both slices passed formatting,
lint, every workspace typecheck, 59 test files / 383 tests, Drizzle migration
snapshot check, and `git diff --check`. Native Next and vinext production
builds passed; vinext reported 94% compatibility with zero issues. The full
`npm run ci` ran through all tests and stopped at the API build because this
runner lacks `bun` (`sh: bun: not found`). GitHub Actions run
`35818138124` passed the complete CI gate, including Bun API/jobs builds and
smoke. The Cloudflare deployment dry-run completed without publishing.

A CSV generated by the real export encoder was opened by LibreOfficeDev Calc
26.8.0.0.alpha0 in headless mode and saved as an `.xlsx` fixture. The resulting
workbook has the intended 15 headers and four data rows; Thai, Latin, emoji,
commas, quotes, multiline notes, and blank optional address cells survived the
import. Five formula-like inputs were stored as text, with zero formula cells.
This checks LibreOffice Calc import only; Microsoft Excel and other spreadsheet
applications have not been inspected. Disposable PostgreSQL integration and
representative query plans, and a physical test envelope remain unverified.

The benchmark numbers describe only the current development runner. No
`TEST_DATABASE_URL` or confirmation flag was configured, so the live PostgreSQL
concurrency suite and representative query plans remain explicit staging gates.

GitHub Actions CI run `35835254412` passed the full repository Verify gate
(59 files / 384 tests, formatting, lint, typechecks, Drizzle check, Bun smoke
and builds, Next/vinext builds, vinext compatibility, and deploy dry-run) and
the new PostgreSQL integration job (4 files / 22 tests). The PostgreSQL job
uses an isolated PostgreSQL 16 service with an explicit disposable URL and
confirmation flag. The live run exposed and led to fixes for first-migration
foreign-key ordering, SQL mutation target columns, UUID array parameters, and
guest pagination timestamp normalization. CI now verifies guest ownership and
concurrency, import transactions, and envelope template/data isolation against
PostgreSQL. Representative Neon staging query plans, VPS behavior, and one
physical test envelope remain external acceptance checks.

Guest workspace regression checks on 2026-09-23 caught four UI behaviors:
exporting immediately after changing a search used the previous search;
adding a guest to a filtered list showed a nonmatching result; reusing the
guest workspace for another wedding retained an open guest detail; and a
delayed detail response could reopen that previous wedding's detail. Export now reads the current input,
filtered creation reloads the current result set, and wedding changes remount
the guest workspace, clearing import, selection, detail, and envelope state.
The focused tests failed for each case before the fixes and then passed.
Locally, formatting, lint, all workspace typechecks, 59 files / 388 tests, and
`git diff --check` passed. No physical printer check was performed.

The invitation/RSVP extension adds an authenticated replacement action for a
lost invitation link. Under the guest row lock, PostgreSQL revokes previous
links and inserts the new hash in one transaction; the raw token is returned
once, never stored. RSVP submission locks its invitation row so replacement
and an in-flight submission are ordered. The replacement is available for an active guest in the
couple workspace after a confirmation warning, and the couple can copy the new
link. Prior links stop working while the guest's existing RSVP remains. If an
invitation becomes invalid during RSVP submission, the guest sees the
unavailable state; editing a saved answer removes the saved confirmation until
the next successful submission. Automated local tests cover the domain, API,
web client, and components. The disposable PostgreSQL integration test for
replacement is checked in for CI execution. Invitation delivery
remains manual; automatic email requires verified sender configuration.

The first planning slice adds a wedding-scoped preparation checklist. Members
can create, edit, complete/reopen, filter, paginate, and delete their own tasks,
with optional category, private note, and date-only deadline. The overview
counts the full wedding's tasks and shows eight nearest unfinished deadlines.
No task or category is prescribed. A new migration supplies the composite
wedding key and list/deadline indexes. API and UI use existing membership and
same-origin authentication. PostgreSQL integration covers tenant isolation,
page cursors, progress, and date-only values. GitHub Actions run
`35881797651` passed 62 files / 411 tests and PostgreSQL 5 files / 24
tests, plus the Bun, Next/vinext, and deployment dry-run checks. The day-of run
sheet was added in the subsequent wedding operations slice.

The wedding operations follow-up adds wedding-scoped budget configuration,
custom categories, expenses and payments, vendor contacts and quotes, a
private run sheet, and tables with whole-party guest assignments. Amounts use
integer currency minor units, optional costs link categories/vendors, and
paid amounts cannot exceed planned amounts. Tables reserve the guest's
allowed party size; concurrent assignment locks the guest and table, and
changes to an already seated party size are rejected until unassigned.
Members can add, edit, list, and delete these records in the couple workspace.
Provider-free tests, migration validation, and disposable PostgreSQL
concurrency checks are part of this branch. GitHub Actions run
`35888731352` passed the complete Verify gate (66 files / 429 tests, Bun,
Next/vinext, and deployment dry-run checks) and the PostgreSQL integration
gate (6 files / 29 tests), including the guest-size/seat-assignment race.

On 2026-09-23 local formatting, lint, workspace typechecks, 66 test files /
429 tests, Drizzle migration snapshot check, native Next production build,
and `git diff --check` passed. The PostgreSQL concurrency suite and Bun/vinext
build gate run on the pull request CI service because this workstation has no
PostgreSQL server or Bun runtime.

The 2026-09-24 selectable-runtime change includes Worker handlers, a
Hyperdrive-aware invocation connection with streaming-response lifetime,
scheduled outbox/cleanup, and an API Worker Wrangler dry-run. Focused Worker
and database lifecycle tests passed locally. The full local run passed
formatting, lint, all workspace typechecks, 70 files / 444 tests, Drizzle
snapshot check, native Next and vinext builds, vinext compatibility, web
deployment dry-run, and the API Worker bundle dry-run. This runner could bundle the
Worker but could not start the local Wrangler dev server because the sandbox
reports `uv_interface_addresses returned Unknown system error 1`; a deployed
Worker smoke test and real Neon/Hyperdrive remain external staging gates.
The Worker choice requires a cache-disabled Hyperdrive configuration and a
deployed same-account frontend-to-API proxy check; local auth validates the
email sender's configuration before accepting requests.
The following documentation pass makes backend parity mandatory for future
features in `AGENTS.md` and aligns `README.md`, `CODEX_START_PROMPT.md`, the
product context, and database guidance with the two selectable runtimes. CI run
`35979999551` passed both Verify and PostgreSQL integration for the runtime
implementation; these documentation changes were checked separately.

## External gates

- choice of production backend runtime (one of Worker or VPS), live Worker
  Hyperdrive configuration and target-plan CPU/scrypt/email/CSV staging checks
- exact generated frontend/API origins; custom-domain ownership, DNS, and TLS
  are needed only if a custom domain is selected
- if VPS is selected: provider/region/sizing, trusted HTTPS API hostname, and
  the Bun benchmark on that host
- Neon region, disposable staging credentials for a repeat concurrency run,
  and representative query plans
- Resend sender/domain verification and end-to-end delivery/reputation controls
- staged proxy/cookie, graceful-restart, lease-recovery, pool-exhaustion,
  firewall, rollback, backup-restore, and token-redaction exercises
- internationalized-email policy, MFA, email-address change/reverification,
  and support/admin authentication decisions

See `docs/DEPLOYMENT.md` and `docs/OPEN_QUESTIONS.md`. Update this document after
each significant implementation or deployment session.

## PR #2 release review (2026-09-26)

The owner selected the Cloudflare Worker backend for the first staging
installation; Neon, Resend, and Cloudflare staging resources are not yet
provisioned. Production runtime selection and live acceptance remain open.
The previous CI job would have migrated production and deployed both Workers
on every `main` push, regardless of whether an installation selected Bun/VPS.
That unsafe automatic deploy was removed. CI continues to verify both runtime
builds and the PostgreSQL integration suite; it does not currently deploy.

`scripts/release-impact.mjs` now classifies web-only, backend-only, shared,
migration, documentation, and unfamiliar changes for a future selective
release. Its unit tests passed. The intended order and staging acceptance
checks are in `docs/DEPLOYMENT.md`. A production release workflow should be
enabled only after runtime selection, protected environments, credentials,
real staging evidence, and an acceptance gate for the exact revision exist.
Local tests passed (70 files / 455 tests), as did lint and workspace
typechecks. No real staging deployment, auth/email, RSVP, CSV, cron, live query
plan, remote CI rerun, or production promotion is claimed for this review.

The owner subsequently rejected old/new release compatibility as a standing
requirement. `AGENTS.md`, the product context, ADR-024, database guidelines,
and deployment runbook now require one canonical schema/contract per release.
Breaking changes need a tested write/job gate, drained work, verified backup,
data transformation and validation, coordinated code/schema cutover, and
recovery before reopening. The gate and drill are not implemented or verified;
this documentation change does not authorize a breaking production migration.

The first Worker staging bootstrap is now prepared in the PR worktree:
`env.staging` names separate API/web Workers, the staging API has a separate
Hyperdrive placeholder, `AUTH_MODE=disabled`, and no cron triggers until
explicit activation. Explicit staging build/deploy scripts and a fail-closed
API deploy preflight reject an undefined staging environment, an unresolved
Hyperdrive ID, or reuse of the default binding. The deployment guide now
orders the first web URL discovery, API deploy with a private secrets file,
and web proxy binding. No Cloudflare Worker, Hyperdrive, Neon branch, Resend
sender, or staging URL was created by this local configuration work. Live
deployment and acceptance still need owner-provisioned accounts and secrets.
Local formatting, lint, all workspace typechecks, 73 test files / 463 tests,
the API staging dry-run, the web staging dry-run, and the staging vinext build
passed. The emitted web Wrangler artifact targeted `lovechapter-web-staging`.

## Live staging bootstrap (2026-09-26)

The owner created the `lovechapter` Neon project in AWS Singapore and supplied
direct URLs for separate `staging` and `staging-test` branches through ignored,
mode-0600 local files. Both URLs connected to distinct Neon compute endpoints.
Drizzle migration validation passed; all nine migrations were applied to the
disposable test branch, and its PostgreSQL integration suite passed (6 files /
29 tests). The staging application branch was migrated separately. Read-only
comparison found 24 public tables, 9 migration hashes, 66 indexes, and 254
constraints on each branch. No integration-test truncation ran against the
staging application branch.

A dedicated `lovechapter_staging_app` database role was created for the Worker
path. Its login and CRUD access to all 24 public tables passed, while schema
and database creation and table truncation were unavailable. Cloudflare
Hyperdrive `lovechapter-staging` was created against that role with query
caching disabled; a subsequent Cloudflare read confirmed `caching.disabled`
is true and TLS mode is `require`. The staging-only Wrangler binding now uses
its configuration ID, and the API staging dry-run selected that ID with auth
disabled. Cloudflare requires an uploaded CA certificate for `verify-full`;
its documented default `require` mode encrypts and validates server
certificates through WebPKI.

The first web Worker deployment produced
`https://lovechapter-web-staging.kruakemaths.workers.dev`, but was assets-only:
application pages returned 404 and `public/sw.test.ts` was published. A
regression test first reproduced both defects. The web Wrangler config now
sets vinext's server fetch handler as `main`, and the service-worker test lives
outside `public`. After the staging-only redeploy, live GETs to `/` and
`/sign-in` returned 200, `/sw.js` returned 200, and `/sw.test.ts` returned 404. `/api/v1/auth/session` still returned 500 because the API Worker and
proxy secrets are not configured; the web URL is not ready for testers.
Formatting, lint, workspace typechecks, 74 test files / 465 tests, the vinext
build, and compatibility check passed after the fix. An initial concurrent
test run timed out on one existing guest-workspace UI test; that test and the
complete suite passed when rerun without parallel validation jobs.

The API Worker deployment, web proxy settings, Resend delivery, auth/email,
RSVP, CSV, cron, and full staging acceptance have not been completed at this
point in the bootstrap record. Read-only `EXPLAIN` on the
empty staging schema selected the expected indexes for account, session,
invitation, guest-page, and due-email lookups; these are preliminary plans,
not the representative-data query-plan gate. No CI rerun or merge is claimed.

## API Worker staging runtime blocker (2026-09-26)

The owner supplied a staging Resend sending key in an ignored, mode-0600 local
file. Three independent 32-byte base64url keys were generated for proxy
ingress, rate limiting, and action tokens. Both API and jobs runtime parsers
accepted the configuration without exposing values. The first
`lovechapter-api-staging` deployment created
`https://lovechapter-api-staging.kruakemaths.workers.dev` with the staging
Hyperdrive binding, `AUTH_MODE=disabled`, and no cron triggers. A remote secret
listing confirmed the seven required secret names, without disclosing values.

Live `GET /health/live` consistently returns Cloudflare 500 / error 1101.
Cloudflare tail showed `[Elysia] Failed to compile route OPTIONS /*: Code
generation from strings disallowed for this context`. The stack reaches
`createApiHandler().compile()` from `worker.fetch`, so Elysia 2.0.0-beta.16
attempts dynamic route compilation during a request. Cloudflare permits this
operation during Worker startup, not in the request context. This failure
occurs before a database connection or Resend call. The web-to-API proxy was
intentionally left unconfigured; auth, cron, email delivery, RSVP, CSV, and
representative query-plan acceptance remain untested. No production resource,
CI rerun, or merge was touched. A Worker-safe Elysia compilation strategy
must preserve request-scoped dependencies and both backend runtime choices
before staging can continue.

## API Worker compilation fix and proxy smoke (2026-09-26)

The Worker now compiles one Elysia route table at isolate startup and reads
request-specific API dependencies from Cloudflare-supported
`AsyncLocalStorage`. Bun still constructs its ordinary API handler; the
Elysia routes, authorization, and database repositories remain shared. A
regression test reproduced the Cloudflare request-time code-generation error
before the fix and passed afterward. Another test overlaps requests with
different Hyperdrive bindings, origins, and ingress credentials to check
isolation. Local format, lint, typecheck, and 73 files / 466 tests passed.
Bun 1.4.2 API/jobs builds and API runtime smoke passed using a temporary
package execution, and the staging API Worker dry-run passed.

The corrected API Worker was redeployed with the same private secrets file.
Live direct `/health/live` returns 200; direct business and readiness requests
without the proxy credential return 403; credentialed `/health/ready` returns
200 through Hyperdrive/Neon. The web Worker received the exact API origin and
matching proxy credential as deployment-preserved secrets, then was redeployed.
Live web `/` and proxied `/api/health/live` and `/api/health/ready` return 200;
unauthenticated `/api/v1/auth/session` returns 401. Malformed sign-up and CSV
requests return 400. Resend delivery, local auth,
invitation/RSVP, real CSV, cron, representative-data query plans, and CI rerun
are still outstanding. `AUTH_MODE=disabled` and staging `crons=[]` remain in
the deployed configuration; production and merge were not touched.

## Resend staging transport check (2026-09-26)

The owner supplied a test recipient in an ignored, mode-0600 local file. A
single benign message was submitted through the application's
`createResendEmailSender` transport using the staging Resend key, the
`onboarding@resend.dev` sender, and a stable idempotency key. Resend accepted
the request and returned message ID
`01a0db5f-ae6a-762f-a31b-230e5fb7947f`. The owner confirmed receipt in
the test inbox. This checks the sender transport, not the Worker
outbox, verification/reset flow, or scheduled job delivery. Staging auth and
cron remain disabled; those end-to-end gates, RSVP, CSV, representative query
plans, CI rerun, and merge remain outstanding.

## Worker scrypt preflight (2026-09-26)

The Bun 1.4.2 development-runner benchmark completed 20 production-policy
scrypt hashes with p95 124.7 ms, two concurrent hashes, and 62.4 MiB RSS;
this is not a Worker measurement. With staging still configured as
`AUTH_MODE=disabled`, requests through the deployed web/API Workers to sign in
using nonexistent randomized addresses invoked the synthetic scrypt path and
returned the expected `401 invalid_credentials`, including a two-request
overlap. A bounded 20-request, two-concurrent direct API probe used unique
test fingerprints and returned `401 invalid_credentials` in all 20 cases;
round-trip p95 was 492 ms and maximum was 552 ms. Cloudflare GraphQL analytics
reported isolated successful scrypt-path API invocations at 128.2–148.9 ms
CPU time and 11.0–11.2 MiB V8 isolate memory, with no errors; one cold
invocation took 929.1 ms wall time, including database/network work. This
establishes runtime compatibility and an initial CPU/memory observation, not a
representative production-load Worker p95.

At the time of the probe, the owner confirmed that the Cloudflare Workers
account was on the Free plan. Its CPU allowance is 10 ms per HTTP invocation,
whereas the observed scrypt-path CPU time is over 128 ms. Successful
short-run probes do not establish sustained Free-plan viability because
Cloudflare permits some infrequent over-limit invocations. Do not enable
local identity or scheduled jobs on the Free plan or weaken the password
hashing policy to fit it.

Code inspection confirms `AUTH_MODE=disabled` disables protected-route
identity, but the `/v1/auth/*` endpoints remain callable. The synthetic
sign-in probe therefore writes bounded rate-limit counters to staging even
though it does not create an account. Keep this scope explicit; do not treat
the current mode as a full auth-endpoint maintenance gate. Staging local
identity and cron have not been enabled, and no production resource was
changed.

The shell environment subsequently lost outbound DNS/network access
(`EAI_AGAIN`). A follow-up Cloudflare analytics query and the planned staging
`AUTH_MODE=local` deployment could not run. Keep the deployed staging mode at
`disabled` and cron triggers empty until external access is restored; do not
claim registration, verification/reset, RSVP, CSV, cron, or CI acceptance.

## Workers Paid staging preparation (2026-09-26)

The owner reports upgrading the Cloudflare account to Workers Paid. The
effective account plan and CPU limit have not been independently verified:
the deployment shell still returns `EAI_AGAIN` for Cloudflare. The checked-in
staging API configuration is prepared with `AUTH_MODE=local` and
`triggers.crons=[]`; this is a local change only, not a deployed activation.
After access returns, verify the account/Worker CPU allowance, deploy the API
staging Worker, exercise the registration/auth outbox and email flow, and only
then enable cron in a separate change. The deployed Worker remains on
`AUTH_MODE=disabled` with no cron triggers. RSVP, CSV, representative query
plans, CI rerun, and merge remain outstanding.

The staging API Wrangler dry-run bundled successfully and showed the staging
Hyperdrive binding with `AUTH_MODE=local`; API type-check and the 12 targeted
Worker/preflight tests passed. The preflight test now checks its argument
validator directly because this sandbox denies subprocess creation from a
Vitest worker (`EPERM`); the CLI guard itself still rejects a missing
`--secrets-file`. These local checks do not verify the Paid plan or activate
the deployed Worker.

## Staging local auth, real cron, and representative plans (2026-09-26)

Outbound access returned. Cloudflare OAuth could read Worker settings but not
the Billing API (`403`, missing Billing Read). The owner-reported Paid upgrade
therefore remains the subscription evidence; the deployed API Worker and
account settings both report the Standard usage model. Cloudflare's current
documentation gives Paid Workers a 30-second default CPU limit, adjustable up
to five minutes. The API Worker staging dry-run passed with `AUTH_MODE=local`.
It was deployed with the existing ignored seven-secret file, while cron stayed
empty. Remote readback confirmed local auth, Standard usage model, and no cron;
proxied liveness/readiness returned 200 and unauthenticated session returned 401. Production was not changed.

A staging test signup returned 202. A read-only Neon check found one unverified
account and one due verification-email outbox job with zero attempts. Only
after this check, the two staging schedules (`* * * * *` for email delivery and
`*/15 * * * *` for cleanup) were enabled and deployed. Remote schedule readback
confirmed both. After propagation, the real scheduled Worker claimed and sent
the verification job once (`attempt_count=1`, `sent_at` set, no error code).
The owner has not yet confirmed receipt or clicked the verification link;
verification, sign-in/session, reset, RSVP, and CSV remain untested end to end.

The PostgreSQL integration/concurrency suite passed again on the separate
staging-test branch (6 files / 29 tests); no test truncation ran against the
staging application branch. A transactional staging-test query-plan probe then
ran seven safe `SELECT` plans on synthetic data, including wedding/guest pages,
invitation, account/session, due-job, and rate-limit cleanup reads. It rolled
back all synthetic rows; details and limitations are in `docs/QUERY_REVIEW.md`.
Exact generated SQL and broader data distributions still need review before
the query-plan gate is considered complete. CI has not been rerun, and no
merge or production release has occurred.

## Staging session read blocker (2026-09-26)

The staging account became verified. Through the deployed web/API proxy,
sign-in returned 200 and set a session cookie, but `GET /v1/auth/session` with
that cookie returned 500. Cloudflare tail confirmed the API Worker handled the
request, rather than a proxy failure. Re-running the exact generated
`buildResolveSessionQuery` against the disposable staging-test branch produced
PostgreSQL error `42883`: `timestamp with time zone <= interval`. The
interpolated `now` values in timestamp arithmetic are untyped parameters;
PostgreSQL infers the subtraction operand as an interval. A diagnostic-only
version with explicit `timestamptz` casts executed successfully, including a
matching session refresh, inside rolled-back transactions. The application
query has not yet been changed or redeployed. Add a real PostgreSQL regression
test, make the two casts, rerun validation, then repeat staging session and
sign-out/revocation checks before RSVP/CSV. CI and merge remain gated.

## Session fix and staging acceptance continuation (2026-09-26)

After owner approval, a PostgreSQL regression test reproduced error `42883`
against staging-test before the fix. Two `now` parameters in
`buildResolveSessionQuery` were explicitly cast to `timestamptz`; the test
then passed for both the refresh and subsequent no-refresh read. The matching
SQL-contract assertion was updated. Local format, lint, all workspace
typechecks, 73 unit-test files / 466 tests, six PostgreSQL integration files /
30 tests on staging-test, and the API staging Worker dry-run passed. No
integration-test truncation ran on the staging application branch.

API staging version `8fdcb97a-60ae-461c-b8f3-12a26bc11738` was deployed
with the existing staging secrets, local auth, Hyperdrive binding, and both
cron schedules. Through the web proxy, sign-in/session returned 200, sign-out
returned 204, and the revoked cookie returned 401. The test account then
requested a password reset; the real cron sent its email job once without
error. Reconstructed token metadata matched the stored hash without exposing
the token. Reset returned 200, the old session and password were rejected,
and the derived replacement password produced a valid new session. The owner
confirmed receipt of the reset email in the test inbox.

Live RSVP acceptance created a wedding and guest, issued a public invitation,
submitted and read back an attending RSVP without a guest account, and rejected
an over-limit party. A second guest flow updated declined to attending,
replaced the invitation, rejected the old link and old RSVP endpoint, accepted
the new link, and rejected a random token. CSV acceptance uploaded UTF-8 rows,
previewed one valid/one invalid row, excluded the invalid row through mapping,
rejected a stale mapping version, committed and replayed the same idempotency
key, and exported Unicode data with `no-store`. Unauthenticated export/upload,
non-CSV upload, invalid UTF-8, and over-5,000-row upload were rejected. An
attempt to commit a batch with one invalid row returned 409 and created no
partial guest records.

The `*/15` Worker cron removed one deliberately expired auth rate-limit probe
on staging. The next real cleanup tick also removed a separate expired
guest-import batch and its row (both counts changed from one to zero). The initial and
larger multi-tenant synthetic SELECT plans and 14 exact generated SQL shapes
were reviewed on staging-test; details are in `docs/QUERY_REVIEW.md`. A real
provider failure/retry transition has not been induced on staging; retry
classification and scheduling are covered by existing unit tests. CI has not
been rerun, and there has been no merge or production deployment.

The owner declined a controlled temporary invalid-Resend-key test, so no
provider failure was injected and the live retry requirement remains open.
Local Bun 1.4.2 API/jobs builds and API runtime smoke passed, as did
`drizzle-kit check`; this is not a Bun/VPS staging acceptance run.

## Disposable PostgreSQL email retry integration (2026-09-26)

The previously proposed invalid-Resend-key test would not exercise retry:
the sender treats ordinary 4xx rejections as terminal, while 429 is retryable.
A new jobs integration test therefore runs the real email processor, token
codec, and PostgreSQL outbox repository against the separate disposable
staging-test branch. Only the HTTP boundary to Resend is replaced: it returns
429 once and then success, with no outbound email or staging secret change.
The test checks for competing older due jobs and cleans up only its own account
afterward; one synthetic account left by the earlier broad-reset test run was
removed explicitly from the disposable branch.
The first attempt persisted `provider_rate_limited`, cleared the lease, and
scheduled the next attempt 15 seconds later. An early batch claimed nothing;
the due batch reused the same persisted idempotency key, marked the job sent
on attempt two, and a later batch did not send it again. The test passed; a
temporary zero-delay mutation made it fail at the expected scheduled-time
assertion, and it passed again after restoring production code. The new test
is wired into the PostgreSQL CI job, but that remote CI job has not run for
these uncommitted changes. Real deployed Worker retry on a transient provider
failure remains unverified, so the staging acceptance gate is still open.

Local format, lint, all workspace typechecks, 73 unit-test files / 466 tests,
the jobs Bun 1.4.2 build, and the PostgreSQL CI-order sequence (six database
files / 30 tests followed by the jobs retry test) passed. One earlier unit
run timed out on the existing guest-workspace selection test, which passed
alone and in a complete rerun. One earlier jobs integration start failed to
connect to Neon within the configured five seconds before any test executed;
a read-only connection check, an isolated retry, and the complete CI-order
sequence passed afterward. This transient connection failure was observed,
not attributed to a proven cause or counted as a clean first-run result.

## First Worker staging retry gate revision (2026-09-26)

The owner approved ADR-025: the first Worker staging acceptance uses real
scheduled verification/reset delivery through Resend together with the
disposable PostgreSQL processor retry test (controlled 429 followed by
success). The active staging Resend key is not deliberately invalidated or
rate-limited, and no live transient-provider failure is claimed. This removes
that specific live-failure blocker, but does not waive the exact-commit
staging acceptance, CI rerun, or production release/cutover gates.

## Committed Worker staging rehearsal and review (2026-09-26)

Commit `8e6808e18c04a0ee67afbf11712c9b88dbea90c0` was built and deployed
to the API and web staging Workers only. The API deployment selected the
separate staging Hyperdrive binding, local auth, and both scheduled triggers;
the web deployment retained its staging API origin and proxy credential. The
web homepage, auth pages, proxied liveness/readiness, and direct API liveness
returned 200. Direct API readiness/business calls without the proxy secret
returned 403 as intended. No production Worker or database was changed.

The committed staging code completed a fresh web-proxied reset flow: the real
scheduled Worker sent one new reset email job, its stored token hash matched
reconstructed metadata, reset/sign-in/session succeeded, and sign-out revoked
the session. A fresh wedding and guest completed public invitation view,
declined-to-attending RSVP update, invitation replacement, old-link rejection,
and new-link acceptance without a guest account. A separate UTF-8 CSV with
Unicode content produced one valid and one invalid preview row; mapping
excluded the invalid row, stale mapping was rejected, one guest was committed,
the same idempotency key replayed the result, and export contained the Unicode
guest with `no-store`. Unauthenticated session/export and a random invitation
were rejected. These were disposable staging test records; the test account's
password was reset to an ephemeral value and the owner can set a new one via
Forgot password. The temporary local acceptance script was removed afterward.

The `*/15` deployed Worker cron removed a uniquely scoped expired auth-rate-
limit probe. On the separate disposable staging-test branch, the 30-test
database integration suite and one-test durable email retry suite passed in
CI order. A transactionally rolled-back synthetic query-plan probe reviewed
seven important SELECTs with representative rows, including the invitation,
session, due-email, and cleanup indexes. The local repository CI command
passed using temporary Bun 1.4.2: 73 files / 466 tests at that revision,
format, lint, typechecks, both Bun builds, Bun smoke, database snapshot check,
native Next and vinext builds/check, and Worker dry-runs. A first invocation
without Bun on this shell's PATH stopped at the build; it was rerun with the
pinned version and passed.

Read-only code review found that the release planner
classified a lone `schema.ts` change as backend-only. A failing regression
test reproduced the issue; the planner now rejects schema-source changes
without a changed SQL migration, and 73 files / 468 tests passed locally
after that fix. The planner/doc correction does not alter Worker runtime code.
Remote PR CI subsequently passed on
`f795fad650e03fcf561b3822b4787ce86e6aef7a`; merge is still pending.

## Inbox confirmation and final staging gate (2026-09-26)

After the owner requested another message, the deployed Worker accepted a
fresh reset request through the web proxy (202), and the real minute cron
marked its new email job sent on the first attempt. The owner confirmed this
new reset message arrived. The owner also found the earlier single
verification message in the test inbox, displayed there at 09:36. A verified
account does not queue another verification message through the normal flow;
the existing verified account and received original message are the evidence
for that part of the gate. No reset link was used in this confirmation round,
and no password was changed.

The five Worker staging categories in `docs/DEPLOYMENT.md` now have evidence:
auth/email, public RSVP, CSV including rejection/idempotency, real email and
cleanup cron plus the controlled disposable-database retry, and PostgreSQL
integration/query plans. Neither the active Resend credential nor production
resources were disrupted; a live provider 429 was not claimed. The current
release-planner/documentation follow-up changes no deployable application or
package source from the live-tested revision. Production release automation
remains disabled pending real production provisioning and its enforced
acceptance gate.

## Deleted-migration planner regression (2026-09-26)

A follow-up read-only review found that the schema-source guard used Git path
names without change statuses. A deleted historical `.sql` file could therefore
satisfy the apparent migration requirement. A new failing regression test
reproduced this case. The planner now reads NUL-delimited Git status/path
pairs and requires an added or modified SQL migration when schema source
changes; a deletion does not count. The targeted planner suite passes after
the fix. No deployable application or package source changed. Local full CI
passed with 73 files / 472 tests, format, lint, workspace typechecks, Bun
builds and smoke, migration snapshot check, Next/vinext builds and check,
and Worker dry-runs. The final staging revision check and remote PR CI on
this correction remain before a separate merge decision.

## PR #2 merge and Worker production direction (2026-09-26)

The final planner correction passed PR CI and PR #2 was merged to `main` as
`63054888056389743c7e078b795bfff1dd61ecf9`. Post-merge GitHub CI passed.
The staging evidence above belongs to PR #2; production has not been
provisioned or deployed. The owner selected the Worker backend for the first
production installation, confirmed full user-facing maintenance for breaking
releases, and requested automatic production promotion only after exact-SHA
staging acceptance. ADR-026 records those decisions.

The Worker maintenance-gate/cutover design is in
`docs/superpowers/specs/2026-09-26-worker-maintenance-cutover-design.md` for
owner review. It has not been implemented. The existing linked worktree for
the new design branch passed the local baseline unit suite (73 files, 472
tests) before documentation edits; that is not a new staging acceptance run.

## Worker maintenance-gate implementation plan (2026-09-26)

The owner approved the Worker maintenance/cutover design. The follow-on
implementation plan is in
`docs/superpowers/plans/2026-09-26-worker-maintenance-gate.md`. It separates
database admission, API/streaming, cron/Bun job parity, web maintenance,
direct operator control, and exact-SHA staging acceptance into testable
slices. No gate implementation, staging migration/deploy, production resource,
or promotion automation has been performed in this planning step.

## Release gate database slice (2026-09-26)

The first implementation slice adds a separate `ops` schema with one seeded
release-control row and bounded active-work leases. Application admissions
hold a short shared row lock through lease insert; the direct controller's
closure update conflicts with admissions and reopening requires the expected
SHA plus zero leases. No lease is automatically expired or cleared. The schema
migration changes no business tables and has only the table primary keys, not
speculative secondary indexes.

The disposable staging-test PostgreSQL branch accepted the migration and
passed seven new release-gate integration tests, including a lock-order race,
plus the existing 30 database integration tests. A temporary no-lock mutation
made the race test fail, and restoring `FOR SHARE` made it pass. The local unit
suite passed 73 files / 474 tests; database typecheck, lint, format, and
`drizzle-kit check` passed. Safe SELECT plans showed a primary-key scan for
control-row admission and tiny sequential scans for the empty lease table;
these plans are not production-cardinality evidence. Neither active staging
nor production was migrated or deployed in this slice.

## Release gate API admission slice (2026-09-26)

The API Worker and Bun server now use one pre-Elysia admission rule: direct
untrusted ingress is rejected before PostgreSQL, every business request takes
an HTTP lease, and a closed or unreadable gate returns a no-store 503 with
`Retry-After`. Response streaming holds the lease until completion,
cancellation, or failure. Liveness stays database-independent; protected
readiness checks both PostgreSQL and the gate singleton even during
maintenance, and the private no-store release-state route exposes only the
mode. This is code-only: no active staging or production deployment occurred.

The focused API suite passed 46 tests. The full provider-free suite passed
74 files / 487 tests. API typecheck, lint, formatting, Bun 1.4.2 build and
smoke, and both default and staging API Worker dry-runs passed. A concurrent
first full-suite run had two unrelated 5-second test timeouts; those files
and then the entire suite passed when rerun without competing checks. The
default Worker dry-run still shows the intentional top-level placeholder;
the staging dry-run selected the distinct staging Hyperdrive binding.

## Release gate scheduled-work slice (2026-09-26)

The Worker minute email batch and quarter-hour retention batch now acquire
separate release leases before any claim or cleanup. The Bun jobs loop uses
the same rule for each bounded email and combined cleanup pass, sleeps while
closed, and retries cleanup after reopening rather than treating a skipped
pass as completed. Admission errors produce only a fixed safe event; lease
release failures propagate so a cutover cannot silently report a clean drain.
The existing 10-email and 500-row cleanup caps are unchanged.

Focused Worker/jobs tests passed 30 cases, and the full provider-free suite
passed 74 files / 494 tests. API and jobs typechecks, Bun 1.4.2 API/jobs
builds, staging API Worker dry-run, lint, and formatting passed. This is still
code-only; no active staging or production cron/deployment was changed.

## Release gate web presentation slice (2026-09-26)

The web proxy now reads only the protected API release mode and fails closed
with a self-contained English 503 page or JSON API 503. A separate canonical
`RELEASE_PROBE_SECRET` allows GET/HEAD presentation inspection, strips the
probe header before rendering/forwarding, and never bypasses API admission.
The service worker still has no fetch cache. No active staging or production
web Worker was deployed in this slice.

The web-focused suite passed 13 tests and the full provider-free suite passed
77 files / 507 tests. Web typecheck, lint, formatting, native Next build,
vinext build/check (95% compatible, zero issues, existing `reactStrictMode`
partial), and staging web dry-run passed. A local `wrangler dev` run against
the built Worker confirmed 503/no-store for home, sign-in, invitation, and
`/api`; static icon/chunk returned 200; a valid GET/HEAD probe rendered pages
while POST remained 503; and no probe value appeared in response headers or
body. This is local built-Worker evidence, not a deployed staging result.
With a loopback mock of the protected release-state API returning `open`, the
same built Worker rendered sign-in and invitation pages normally and forwarded
`/api` to the mock upstream; the mock's 403 was expected for that unimplemented
business route. This also exercised the state fetch in the local Worker runtime.

## Release gate operator slice (2026-09-26)

The direct PostgreSQL staging CLI now supports `status`, `close`, `drain`, and
evidence-gated `open`; it rejects pooled-looking URLs, wrong environments,
malformed or nonmatching SHAs, incomplete evidence, and active leases. A
timeout/interruption never reopens maintenance. Status exposes only mode,
target SHA, and lease count. The runbook records least-privilege app grants,
the exact-SHA cutover order, private smoke, and forward-fix/verified-restore
behavior. No production command is enabled.

Seven CLI unit tests passed. The disposable staging-test PostgreSQL suite
passed 7 files / 38 tests, including wrong-SHA and orphaned-lease reopen
rejection. A real Bun 1.4.2 CLI `status` call against that disposable branch
returned open/zero leases without exposing the connection URL; a production
environment invocation exited nonzero with a generic error. Database
typecheck and Drizzle snapshot check passed. Active staging and production
were not closed, migrated, or deployed in this slice.
The full provider-free suite also passed 78 files / 514 tests before commit.

## Release gate least-privilege correction (2026-09-26)

Active staging exposed a grant mismatch after the first gate-aware deploy:
PostgreSQL requires `UPDATE` for direct `SELECT ... FOR SHARE`, while the
Hyperdrive app role intentionally has no control-row mutation privilege.
Business admission failed closed with HTTP 503 even though the gate mode was
open. The closure drill stopped; production was not touched. A separate
disposable recovery branch reproduced SQLSTATE 42501 with the genuinely
restricted staging app role. A Neon API-created test role on `staging-test`
unexpectedly inherited `neon_superuser`; with owner approval, it was deleted
from that branch and never used as privilege evidence.

Custom migration `0010_release_gate_admission.sql` adds an owner-run,
restricted-search-path `SECURITY DEFINER` function that atomically locks the
control row and inserts a lease. `PUBLIC` execution is revoked. The API and
jobs now use one function call per admission; the app role needs only
`EXECUTE`, lease `SELECT (id)`/`DELETE`, schema usage, and control `SELECT`.
The restricted-role regression failed before this correction and passed
after the migration and explicit grants on the disposable branch. Its full
database integration suite passed 7 files / 39 tests. Local repository CI
then passed 78 files / 514 tests, format, lint, typechecks, builds, migration
check, Bun smoke, vinext/Next checks, and Worker dry-runs. Safe sparse-branch
query plans and the remaining cardinality caveat are recorded in
`docs/QUERY_REVIEW.md`. Active staging has not yet received migration 0010 or
the corrected Worker revision; the staging closure and acceptance drill
remain open.

## Worker staging maintenance drill on the corrected SHA (2026-09-26)

Commit `e463dc8e9627ee1d5d542b3fb811e56302377c3b` passed local CI
(78 files / 514 tests, format, lint, typechecks, builds, migration check,
Bun smoke, Next/vinext checks, and Worker dry-runs) and 7 PostgreSQL
integration files / 39 tests on a disposable recovery branch. API and web
staging dry-runs selected the staging configurations. Active staging received
additive migration 0010 and the narrowed app grants before API deployment;
the existing direct lease `INSERT` was revoked only after the new API served
all traffic. Catalog checks showed no app control-row `UPDATE`, no direct
lease `INSERT`, app function `EXECUTE`/lease `SELECT (id)`/`DELETE`, and no
`PUBLIC` function execution. The retained staging data was 1 user and 2
weddings. API Worker version
`7d53e8a7-eb31-4ef0-9f96-2c2c5d808ba0` and web Worker version
`a13126e9-b02c-40d7-ab91-f54fa98f3141` were deployed from that SHA.
Protected readiness and release-state returned 200/open, direct business
ingress returned 403, the public sign-in page returned 200, and an
unauthenticated web-proxied business request returned the expected 401
instead of the earlier 503.

On active staging, a synthetic HTTP lease admitted while open remained
visible after CLI closure. New HTTP/email/cleanup admissions returned null.
Public sign-in and API returned no-store 503; protected readiness stayed
200, valid private GET probe rendered sign-in, and an invalid probe stayed 503. The synthetic lease was released, CLI drain confirmed zero active
leases, and evidence-gated CLI open restored the same SHA. A first `open`
invocation used a relative evidence path from the workspace package and
failed closed; the absolute path succeeded. After reopening, the gate was
open with zero leases, sign-in returned 200, and unauthenticated business
access returned 401. The earlier no-compute staging checkpoint and
disposable PITR rehearsal remain the recovery evidence; no production
branch or service was touched.

On this exact deployed SHA, the verified staging test account requested a
fresh reset through the web proxy. Real minute Worker cron sent the new job
once; its persisted token hash matched reconstructed metadata, and the owner
confirmed inbox receipt. Reset, sign-in, session, sign-out, and revoked
session checks passed. A disposable wedding and Unicode guest completed
public invitation/RSVP without a guest account; an over-limit RSVP was
rejected and readback retained the valid party size. CSV upload preview
flagged one invalid row, mapping excluded it, stale mapping returned 409,
commit created one guest, same-key replay matched, and no-store export
contained Unicode data. Only the wedding created by this test was removed;
the account password is now an ephemeral test value unknown to the owner and
can be changed through Forgot password. The earlier verified account and
verification-inbox evidence still apply; no new verification email was
requested for this already-verified account.

The controlled Resend 429→success retry integration passed on isolated
`staging-test` PostgreSQL (1 test); no staging Resend key was changed and a
real provider failure was not claimed. Seven representative SELECT plans
were rerun against synthetic transactional data on `staging-test` and rolled
back; details are in `docs/QUERY_REVIEW.md`. A separately scoped expired
rate-limit marker was present before the next deployed quarter-hour cleanup
tick and absent afterward; the gate remained open with zero leases and the
two pre-existing weddings. Remote PR CI and any merge decision remain
pending. Production deployment and automatic promotion remain disabled.

## Exact-SHA release-gate correction and Worker staging acceptance (2026-09-26)

A read-only review identified four Important defects after the earlier
`e463dc8` staging drill: duplicate `sslmode` parameters could bypass the
CLI's TLS check; evidence from an earlier closure of the same SHA could
reopen a later closure; an unresponsive web release-state fetch could hang;
and readiness did not compare the deployed API with the latest migration.
Commit `5718cdc1f70c6b7563ebe8bdb78f8eedd7ca0f28` corrects all four
with focused red/green regressions. The CLI rejects duplicate `sslmode`,
requires evidence newer than the current closure, and compares that closure
timestamp atomically during reopen. The web state fetch/body has a
three-second deadline. Protected readiness compares the newest Drizzle
migration hash with the compiled revision. Active staging's restricted app
role received only `USAGE` on `drizzle` and `SELECT (id, hash)` on the
migration ledger; disposable-branch restricted-role and live readiness
checks passed. This correction changed no business table or migration.

The exact `5718cdc` API/web staging Worker versions are
`03e59c3b-1850-4850-969f-0a11635334d0` and
`50640419-55bf-4067-8da5-f606717367dc`. A fresh active-staging closure
blocked public pages and API with no-store 503 while protected readiness and
the private GET probe returned 200. A queued reset-email job remained
pending with zero attempts during a real minute-cron tick, then was sent
once after reopen (`attempt_count=1`, no error); the owner confirmed inbox
receipt. A deliberate lock of the control row stalled the web release-state
request; public access failed closed to no-store 503 in about 3.1 seconds.
The CLI refused to reopen with an active synthetic lease, accepted a drained
state with new evidence, and later rejected that evidence after a second
closure of the same SHA.

The second closure held a **real API Worker HTTP request** in flight by
temporarily locking only `auth_rate_limits` on staging. One HTTP lease was
visible after closure; a new public sign-in page returned no-store 503. The
already-admitted request completed with its expected 401 after the lock was
released, and the lease count returned to zero. Protected readiness and
private sign-in presentation still returned 200 while closed. New exact-SHA
evidence recorded the API/web version IDs and post-closure private smoke;
the CLI reopened staging. Readback showed mode `open`, zero leases, two
pre-existing weddings, one test account, public sign-in 200, and
unauthenticated session 401. The temporary table lock was rolled back and
scratch test scripts were removed. The active staging checkpoint is Neon
branch `br-royal-term-azoxtj68` at parent LSN `0/1D60CD8`; the earlier
disposable PITR restore rehearsal used branch `br-soft-recipe-azs60m8r` and
left active staging and production untouched.

On this same `5718cdc` Worker pair, the reset token metadata matched its
stored hash; reset/sign-in/session/sign-out/revoked-session returned
200/200/200/204/401. A disposable wedding and Unicode guest completed
invitation view, account-free RSVP, over-limit rejection, and readback.
CSV upload, invalid-row preview/exclusion, stale mapping rejection,
idempotent commit replay, and no-store Unicode export passed. The
test-created wedding was removed. The test account's password is now an
ephemeral value unknown to the owner; use Forgot password to set a new one.
The earlier received verification email still covers the already-verified
test account; no second verification message was generated. Real staging
cron sent queued reset mail and performed the prior cleanup exercise; the
controlled 429→success retry remains disposable-PostgreSQL evidence, not a
claimed live Resend failure. Seven representative SELECT plans were rerun on
`staging-test` and rolled back. The new readiness query selected the Drizzle
migration primary key on its ten-row ledger; details and measurement limits
are in `docs/QUERY_REVIEW.md`.

Local CI on `5718cdc` passed 79 files / 519 tests plus format, lint,
typechecks, migration check, Bun builds/smoke, Next/vinext builds/check, and
both Worker dry-runs. Two initial full-suite attempts exposed an existing
201-row guest UI test's five-second timeout under full-suite contention;
the focused test passed and its test-specific timeout was raised to ten
seconds before the passing full run. A subsequent read-only review found
that PostgreSQL query-string `host=` can override the URL authority host
after the CLI's pooled-host check. A new regression failed before a fix and
passed after URL options were restricted to TLS mode and optional required
channel binding. That CLI-only follow-up has not been redeployed as a new
Worker SHA. After that correction and the documentation update, local CI
passed 79 files / 520 tests, format, lint, every workspace typecheck, the
migration check, Bun builds/smoke, Next/vinext builds/check, and Worker
dry-runs. The disposable `staging-test` PostgreSQL suite passed 7 files /
39 tests with one test skipped, and its controlled jobs retry test passed 1/1.
Remote PR CI and the merge decision remain
pending. Neither production resources nor automatic
promotion were created; staging acceptance does not authorize a production
release.
