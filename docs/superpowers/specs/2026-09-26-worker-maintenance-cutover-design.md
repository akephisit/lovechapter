# Worker maintenance gate and staging cutover design

## Purpose and scope

The owner selected Cloudflare Workers for the first production installation.
Before a breaking schema or API release, LoveChapter must prebuild the selected
backend and web, stop new user and scheduled work, drain work already admitted,
change the one canonical schema and API contract, deploy both new components,
check the result privately, and only then reopen. Downtime is acceptable;
running old and new schema contracts together is not. All user-facing pages,
including guest RSVP and authentication, show maintenance while the gate is
closed. Liveness and release diagnostics remain available to operators.

This spec covers the release gate, a Worker staging cutover/recovery drill,
and the contracts later production automation must consume. It does **not**
provision production resources or enable production promotion. A separate
implementation plan will handle production resource provisioning and the
automatic promotion workflow after the gate has passed staging acceptance.
Component-only, nonbreaking releases continue to use the existing impact
planner and need not enter maintenance.

## Constraints and decisions

- The first production backend is one Cloudflare API Worker with Hyperdrive;
  the Bun/VPS backend remains a supported alternative for other installations.
  The release gate must be honored by the Bun API and job loop as well, but
  this spec does not deploy or accept a Bun/VPS installation.
- Staging and production have separate Neon databases, Hyperdrive
  configurations, Workers, secrets, and release-gate state. No custom domain
  is assumed; generated `workers.dev` origins remain configurable.
- Keep Elysia 2, Drizzle, the existing authenticated proxy boundary, and one
  canonical schema. The operational gate is not a legacy compatibility layer.
- The gate must not depend on deleting or editing Cron Triggers during a
  cutover: trigger changes can take up to 15 minutes to propagate.
- The gate must not infer that all HTTP work has drained from a fixed timer:
  a Worker HTTP invocation can remain active while its client is connected.
- No production write, migration, or resource creation is authorized by this
  design document. Actual provisioning needs the owner's region and credential
  decisions, and secrets never enter Git or chat.

## Release-control data and authority

Add a small `ops` schema in the selected installation's PostgreSQL database.
It contains a singleton release-control row (`open` or `maintenance`, target
commit SHA, change timestamp) and an active-work lease table keyed by a
random lease ID. Leases record only work kind and start time, never account,
guest, invitation, URL, token, or request-body data. Missing or unreadable
control state means maintenance. The operational tables remain available
through a business-schema migration; a release that changes them requires a
separately reviewed bootstrap/cutover plan.

Admission and closure must be ordered atomically in PostgreSQL. A short
transaction/statement takes a shared lock on the singleton row and creates
the lease only if the row is `open`. The release controller takes the
conflicting lock to set `maintenance`, waits for earlier admissions to
commit, and then waits until no active leases remain. Later admissions are
denied. Do not hold a database transaction open for the lifetime of an HTTP
response or an email send. Remove each lease when the request response body
finishes or is canceled, or when a scheduled batch completes. A failed lease
cleanup leaves the lease in place and blocks cutover; leases are not
automatically treated as safe merely because they are old. An operator must
investigate an orphaned lease rather than force a timed release.

Staging acceptance exposed a PostgreSQL privilege constraint: direct `SELECT
... FOR SHARE` requires `UPDATE` privilege on the control table, which the
Worker must not receive. Admission therefore executes inside the narrowly
scoped `ops.admit_release_lease(text)` security-definer function. It locks the
control row and inserts a lease in one statement, returns null when closed,
and fails closed for missing state. Revoke its default `PUBLIC` execution,
fix its search path to trusted schemas, and grant `EXECUTE` only to the
selected backend's application role. The app role retains only control
`SELECT` and lease `SELECT (id)`/`DELETE`; it cannot update the control row or
insert a lease directly. Hyperdrive does not support advisory locks, so they
are not an alternative on the Worker path.

The release controller uses a separate direct PostgreSQL credential outside
Workers. There is no public HTTP endpoint that can change gate state. The
control row may reopen only for the expected target SHA after the release
checks below pass. The first migration creates and seeds the gate while the
existing installation is still on a nonbreaking version; gate-aware Worker
versions must serve 100% of traffic before the first breaking cutover. Do not
use a gradual deployment with an ungated version during migration.

## HTTP, frontend, and scheduled behavior

Every authorized business API invocation obtains an admission lease before
Elysia handles it. Direct requests without the existing private proxy
credential still fail at ingress without a database round trip. When closed,
business API requests return a stable 503 response with `no-store` and
`Retry-After`; `/health/live` stays independent of PostgreSQL, while the
protected `/health/ready` checks the deployed API/schema combination even
while maintenance is active. Readiness may report 200 to the operator before
public traffic reopens; it never changes the gate state or admits business
work. If readiness fails, the gate stays closed.
A private release-state read endpoint returns only the gate mode to the web
Worker, authenticates with the existing server-to-server proxy credential,
and disables caching. It does not expose release controls to browsers.

The web Worker checks that endpoint at request ingress, before rendering
pages or forwarding `/api` requests. It serves a self-contained, English
fallback 503 maintenance page when the gate is closed or the status request
fails. This applies to home, workspace, authentication, guest invitation and
RSVP routes admitted after closure; a page response already in flight may
finish, but any later business API operation still requires its own lease.
Only liveness/readiness and the static assets required by the maintenance
page are exempt. The existing PWA service worker has no fetch
cache, and maintenance responses must remain `no-store`. The operator smoke
path may bypass the web maintenance _presentation_ only for authenticated
release-runner GET/HEAD probes using a separate server-held secret; it cannot
grant a user session, forward the probe secret to the API, expose it to
browsers, or bypass the API admission gate. Use the supported
vinext middleware/proxy surface for the pinned versions, with a built Worker
and deployed staging probe proving that static and dynamic routes are
actually intercepted; a compatibility gap blocks release rather than
silently weakening the gate.

The one-minute email and 15-minute cleanup scheduled handlers obtain a lease
before claiming or deleting records. If maintenance is active or the gate is
unreadable, they perform no business work. The Bun job loop uses the same
admission rule per bounded batch. Closing the gate waits for already admitted
email sends and cleanup to finish before migration; existing outbox jobs stay
durable and resume after reopening. Do not manufacture a live Resend failure
to prove this behavior.

## Breaking release sequence

1. Select an immutable commit SHA and reviewed migration/data-transform plan.
   Build both Worker artifacts and run code, database, and staging acceptance
   checks before entering maintenance. Record the currently deployed SHA and
   the target SHA. The exact production Neon region, sender, Worker origins,
   Hyperdrive, secrets, and GitHub environment must be provisioned separately.
2. Confirm a recoverable Neon point and rehearse the restore procedure on a
   disposable branch. Close the release gate to new API and scheduled work;
   verify all user-facing routes show maintenance and wait for zero active
   leases. Failure to close or drain aborts the migration while remaining
   closed.
3. Run the reviewed migration and retained-data validation over a direct,
   non-pooled PostgreSQL credential. Never run migrations through Hyperdrive
   or an application Worker. Keep the gate closed.
4. Deploy the new API and web Worker versions from the same SHA to 100% of
   their respective traffic. Do not split old/new traffic across a breaking
   contract. Verify recorded version IDs and the expected target SHA.
5. While still closed, run private operator smoke against the new versions:
   liveness/readiness, database/schema compatibility, GET/HEAD web rendering
   through the restricted presentation bypass, proxy ingress rejection of
   business work, and scheduled-handler no-op behavior. The release-runner
   secret carries no user session or invitation token and never authorizes
   mutations. Full auth/email, RSVP, CSV, cron, and query-plan acceptance
   belongs on staging before this step.
6. Reopen the gate only after every required check passes. Confirm public
   pages, API mutations, and scheduled processing resume. Record the SHA,
   Worker version IDs, migration and gate timestamps, and acceptance result.

If any post-migration step fails, remain in maintenance. An old binary alone
is not a rollback for an incompatible schema. Choose a reviewed forward fix
or a verified database restore, validate the resulting data/schema and
Worker pair, then repeat smoke before reopening. Intentional deletion of
user data needs separate explicit approval. Never auto-clear an active lease
or auto-reopen after a failed step.

## Staging acceptance for this subsystem

Use the existing Worker staging installation with synthetic records. Check
all page families, guest invitation URLs, sign-in/reset routes, proxy API
methods, direct API ingress rejection, liveness/readiness, cache headers,
and an unreachable gate-state endpoint. Start controlled HTTP and scheduled
work, close the gate during each, and prove that no new work is admitted and
that closure waits for the active leases. A queued email remains unsent while
closed and resumes once after reopening. A stuck/failed lease-cleanup case
must keep the release closed and require operator inspection.

Rehearse migration and restore with a disposable Neon branch, never a
destructive test against the active staging or production database. On the
staging Worker revision under test, repeat the existing auth/email, RSVP,
CSV, cron/retry, PostgreSQL integration, and representative query-plan gates
after reopening. Verify generated SQL, gate indexes/constraints and the
fixed number of additional round trips; measure release-gate latency on
representative traffic before enabling production. Record the p95 comparison
and resolve unacceptable overhead before promotion; this design does not
invent a latency threshold without representative traffic. A sequential scan on the
singleton or tiny active-lease set is not alone a reason to add an index.

## Follow-on production promotion contract

The later release workflow starts from a selected tested SHA, not from an
independent Cloudflare Git deployment. It serializes releases and uses
separate staging and production GitHub environments/secrets. The staging
job records automated checks plus an auditable acceptance of manual email
receipt or other non-automatable evidence against that exact SHA. Production
promotion then runs automatically after that acceptance, without a second
release click; production environment protections must enforce source and
secret boundaries without silently adding a second manual approval. It uses the
component-impact planner for nonbreaking changes and the coordinated
sequence above for breaking changes. A migration flag is a human-reviewed
release decision; a changed SQL file alone cannot prove compatibility.
If environment protections, credentials, production resources, the staged
cutover drill, or the exact-SHA evidence are missing, the workflow does not
promote. The repository must not enable a production deploy job until those
conditions are implemented and verified.

## References

- [Cloudflare Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/): a release uses one version at 100%, not gradual traffic splitting, for a breaking contract.
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/): changing triggers is not an immediate job stop.
- [Cloudflare Next.js/vinext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/): middleware support still needs verification against the pinned beta build.
- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/): HTTP streaming has no fixed wall-time cutoff while connected.
- [Neon instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore): test recovery rather than assume code rollback restores data.
