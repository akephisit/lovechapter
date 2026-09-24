# LoveChapter — Progress

## Current phase

The backend can be packaged either for Bun/VPS or for a Cloudflare API Worker;
choose one backend runtime per installation. The repository includes API/job artifacts,
the same-origin web proxy, account UI, provider-free tests, example systemd and
Caddy assets, an operational handoff, and a GitHub Actions production release
path that verifies, migrates, and deploys the Worker choice in order after a
push to `main`.

This is locally verified code, not a production deployment. No Hyperdrive
configuration, VPS, custom
domain, Neon production database, Resend sender, or live URL is provisioned or
claimed.

## Implemented

- Main-branch production release job gated on CI and PostgreSQL integration,
  with dedicated Neon migration credentials, sequential API/web Worker deploys,
  readiness checks, and no production work on pull requests
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
