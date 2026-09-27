# Direct production Worker release

## Purpose and decision

The first LoveChapter installation uses the frontend and API Cloudflare Workers
with the existing Neon `production` branch. The owner wants a short, automatic
path from an owner-directed, fast-forward push to protected `main` to a working
production site. There is no staging release or staging acceptance gate in this
path. CI and artifact builds precede whole-site maintenance; reviewed pending
migrations run while closed and before Worker deployment; the site reopens only
after a private smoke test. A returning browser tab reloads when the published
release changes.

This design supersedes the staging-before-production requirements of ADR-026,
ADR-027, ADR-028, and the 2026-09-26 automatic Worker release design. It does
not supersede runtime parity, tenant/auth security, the single canonical
schema, or ADR-024's breaking-cutover requirements. Existing staging Workers
and Neon branches are not release prerequisites and are not deleted by this
change. Their cleanup needs a separate decision. The temporary waiver for
observing real inbox receipt remains explicit; it is not a claim that mail
delivery to arbitrary users works.

## Source and impact

Development may use a separate branch or worktree. The owner commits and
fast-forwards the candidate to protected `main` without a PR, reviewer, or
branch-hosted CI. A single serial GitHub Actions workflow checks the exact
`main` SHA. Failed CI leaves production untouched; the fix is a later forward
commit. Docs-only changes run CI but do not enter maintenance or deploy.

Compare the candidate with the last successfully opened production release.
Web-only changes deploy the web Worker; API/job-only changes deploy the API
Worker. Shared contracts, migrations, or uncertain impact deploy both. CI
still verifies both supported backend runtime paths, even though this
installation deploys only the Worker backend. All artifacts selected for
deployment are built and checked before maintenance. A breaking migration
builds and tests both web and API from one SHA and deploys both while closed.

## One-time production publication

Production is not provisioned yet: the existing Neon branch is not by itself
a working installation. Before enabling push-triggered releases, inspect its
actual migration ledger and retained data, provision production-only
Hyperdrive, web/API Workers, origins, secrets, and a whole-site maintenance
gate, and verify that the selected Worker backend is the only API/job runner
for this installation. Keep the first public Worker pair closed until the
current schema has been applied, both Workers from one SHA are deployed,
private web/API readiness passes, and the gate can reopen. Do not assume the
production branch is empty or copy the staging baseline into it.

The first publication uses the same CI/build, migration-before-deploy, smoke,
and reopen order as later releases, with an explicit initial baseline because
there is no previous production Worker version to diff against. It is an
operator-triggered one-time setup; only after it succeeds is normal automatic
production release enabled. Production credentials remain in the production
GitHub environment and Cloudflare/Neon secret stores, never in Git or logs.

## Normal release sequence

1. CI verifies format, lint, types, tests, disposable PostgreSQL integration,
   migration SQL/review, Bun API/job parity, Worker dry-runs, and the selected
   web/API builds at the pushed SHA. Check current production target and
   baseline before changing traffic.
2. Close the whole-site gate. Pages, same-origin and direct API requests,
   writes, and scheduled handlers enter maintenance. Wait for admitted HTTP
   and job leases to drain. Do not infer drainage from a delay.
3. If a migration is pending, apply it through a direct Neon connection while
   closed, then validate the migration ledger, schema, and retained data. For
   an incompatible/breaking migration, create and verify one recoverable Neon
   point **after drain and before migration** using a small provider call.
   The bootstrap must confirm the production branch supports the selected
   snapshot/point-in-time method; the workflow records its identifier and
   stops if creation or readback fails. No separate staging/rehearsal branch
   or elaborate recovery automation is a normal release requirement. A
   code-only release creates no new recovery point.
4. Deploy only the selected Worker(s) from the prepared SHA. A breaking
   schema/API cutover deploys both. Check actual active Worker versions and
   the untouched Worker's existing version where deployment is selective.
5. Privately smoke-test the closed pair: database readiness, web rendering,
   same-origin proxy, direct API ingress denial, and maintenance behavior.
   Reopen the gate, then perform a small public liveness/readiness check.

A failure before closure leaves the old site open. A failure after closure
leaves maintenance on and requires a forward fix or a verified data restore;
never expose an incompatible Worker/schema pair or automatically restart an
old Worker against a new breaking schema. Do not automatically restore the
database or silently discard writes. A migration that intentionally deletes
customer data still needs separate owner approval and a specific data plan.

## Returning browser tabs

The web app exposes a small no-cache, read-only release-status response with
the published version and maintenance mode. On `visibilitychange`/`pageshow`,
a tab that becomes active checks it. If the site is still in maintenance, the
tab shows the maintenance state and waits for reopening. Once open, if the
published version differs from the version loaded by the tab, it performs one
full-page reload. An unchanged version does not reload on every tab switch.
The service worker must not serve stale release-status or authenticated data.
An active form may lose unsaved browser-only input on a release-triggered
reload; that trade-off is accepted for this simple cutover and should be made
clear in the maintenance UI.

## Verification and exit criteria

Tests cover impact selection, CI/build-before-close ordering, whole-site
maintenance and drain, migration-before-deploy, no-migration deploys,
breaking two-Worker releases with a recovery point, selective Worker releases,
failed-phase closed behavior, and reload-on-return without a reload loop.
Existing auth, RSVP, CSV, cron, and representative query-plan checks run in
CI or a disposable database where appropriate. Production private and public
smoke prove the deployed installation, but no staging acceptance result is
required or reported. Real inbox delivery is reported as `waived`, not
`passed`.

Update `PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, and
`docs/PROGRESS.md` to name this direct-production path and remove obsolete
staging release gates. Retire or repurpose the incomplete staging-bootstrap
code and plan without changing the existing staging installation. No claim of
production readiness is made until production resources, the one-time first
publication, and normal-release verification actually pass.
