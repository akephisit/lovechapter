# One-time staging Worker release baseline

## Purpose and boundary

Establish the first accepted, exact-SHA Worker version pair on the existing
LoveChapter staging installation so its normal selective release coordinator
can run. This is a one-time bootstrap, not a compatibility mode for later
releases. It must preserve the existing staging data, prove the path from the
deployed `0010` schema to reviewed migration `0011_release_versions`, and run
the complete live staging acceptance suite before the staging release switch
can be considered. The first public installation still selects the Worker
backend; Bun/VPS parity remains a CI requirement, not a second deployment.

The owner approved writing this design and runbook, **not** closing staging,
migrating its active database, uploading/deploying Workers, or enabling a
release switch. Those live actions require a separate go/no-go decision after
the implementation and dry run are reviewed. Production resources and
automatic promotion remain out of scope for this bootstrap.

## Current facts and decision

At the design checkpoint, protected `main` is `e236c04`, the manual
`staging-test` preflight passed on run `36287280538`, and the isolated
`staging-test` branch has `0011`. Active `staging` still has only migrations
through `0010`, no four version columns, an open gate with zero leases, and no
accepted Worker version baseline. The currently active Worker pair is
gate-aware, but their version IDs alone do not attest to the source SHA.
Neon currently reports `staging` as a root branch (`parent_id: null`), which
matters because Neon instant restore is limited to root branches.
Every value in this paragraph is historical evidence and must be read back
before execution; it is not a release input to copy into a script.

The normal executor rejects an open gate without both accepted versions.
Moreover, normal gate `status`/`drain` and the migration CLI query the `0011`
columns before they can operate. Enabling `STAGING_RELEASE_ENABLED` now would
fail, not bootstrap the installation. Keep both repository release flags
unset during the one-time procedure.

The chosen approach is a separate, manually dispatched, protected-`main`
bootstrap workflow with a narrow pre-`0011` gate reader and the existing
provider-verified release target guard. It runs same-SHA CI and disposable
PostgreSQL checks, rehearses recovery, builds both Workers, closes and drains,
verifies an exact post-drain recovery checkpoint, applies only reviewed `0011`,
deploys both Workers, privately smokes the closed installation, then records
both actual versions in the atomic gate reopen. Full public staging acceptance
follows. A manual list of
independent commands has more target/SHA/operator-error risk. Copying old
Worker IDs into the gate would not prove the new deployment path or their
source SHA. Neither alternative is an acceptable shortcut.

## Components and trust boundaries

- **Bootstrap coordinator:** a one-time manual workflow selected only on
  protected `main`, pinned to one full SHA and serialized with the normal
  release workflow. It cannot run for a branch, PR, stale main tip, or when
  `STAGING_RELEASE_ENABLED` or `PRODUCTION_RELEASE_ENABLED` is true. CI and
  disposable PostgreSQL jobs finish before the staging environment job can
  read secrets. The environment is restricted to protected `main`.
- **Target guard:** compare the configured Neon project, exact `staging`
  branch ID, endpoint host, database and distinct direct release/migration
  roles against Neon metadata; compare Cloudflare account, staging-only
  Hyperdrive ID, origin role/host/database, disabled query caching, exact
  Worker names and disabled Version URLs against Cloudflare metadata. Fail
  before opening a database connection or uploading a version on mismatch.
  Never print credentials or provider response bodies.
- **Pre-schema gate operation:** bootstrap-only SQL uses the pre-`0011`
  `ops.release_control` fields (`id`, `mode`, `target_sha`, `changed_at`) and
  bounded lease reads. It closes with the existing conditional `closeFor`
  semantics, verifies the closure timestamp/target, and waits for zero HTTP,
  email and cleanup leases without forcing expiry. It does not alter normal
  `status` to support two schemas. After `0011` is verified, all subsequent
  status, open and release operations use the normal current-schema code.
- **Migration and Worker adapters:** reuse the reviewed Drizzle migration
  history and the existing both-Worker preparation/deployment primitives.
  The API version may be uploaded before closure only after confirming its
  Version URL is disabled; uploading must not route it to users. The web
  artifact is built and checked before closure, then deployed with its
  verified no-rebuild path while closed. Both active deployments must resolve
  to one version at 100% after the switch.
- **Evidence and acceptance:** store the immutable SHA, provider identities,
  checked migration prefix/hash, closure timestamp, drained lease count,
  recovery checkpoint, both actual Worker version IDs and source SHAs,
  private smoke result, atomic reopen result, and named public acceptance
  checks. Only metadata and check outcomes may enter GitHub logs or durable
  deployment records. The real-inbox check is `waived`, never `passed`.

The bootstrap capability must have a deliberately short lifetime: once the
accepted pair and live acceptance are recorded, remove the pre-`0011`
adapter and manual workflow in a forward commit. The normal release path
continues to require the `0011` schema and accepted baseline. Retain the
written runbook and evidence for audit and disaster recovery.

## Operator runbook: before closure

The implementation plan must turn these assertions into guarded commands and
tests. This document is not an executable instruction to operate staging yet.

1. Select the current protected-`main` full SHA. Verify it is still the remote
   tip, no release workflow is running, both release flags are unset, and
   `staging` environment secrets are main-only. Verify CI, disposable
   PostgreSQL integration, Bun API/jobs builds and smoke, native Next/vinext
   checks, API Worker dry-run, and reviewed `0011` migration from that SHA.
2. Read the active staging gate, deployed Worker IDs, exact Neon and
   Cloudflare targets, secret **names**, Hyperdrive cache setting, and Version
   URL settings again. Require `0010` as the exact active migration prefix,
   no `0011` columns, `open` mode, and no active release attempt. Any drift
   blocks this one-time path. Check that the old Workers enforce maintenance
   for pages, direct API requests, and both scheduled handlers.
3. Rehearse `0010` → `0011` on a newly isolated, data-and-schema branch from
   active staging, and separately rehearse recovery by creating a historical
   branch from the staging root at a known point. The already migrated
   `staging-test` branch is not sufficient to prove this transition. Use a
   direct, branch-specific credential; verify representative retained row
   counts and the migration ledger before and after. Confirm that `staging`
   is still a root branch and that the selected LSN falls inside the
   provider's current history window; do not assume a child branch can use
   root-branch instant restore. Do not reset or restore active staging to
   rehearse.
4. Build **both** Worker artifacts from the selected SHA. Run target-specific
   dry-runs, inspect the web client bundle for server-secret inlining, and
   verify the web no-rebuild deployment path. Upload the API candidate version
   without activating it only after both Workers' Version URLs are confirmed
   disabled. Recheck the currently serving pair at 100%; no staged candidate
   may become public through another route or Cloudflare Git deployment.
5. Record a go/no-go packet with the tested SHA, active targets, current
   schema/version evidence, isolated rehearsal, operator/recovery contact,
   expected maintenance window, and a stop condition for every phase. Obtain
   the separate owner approval for the **active staging** cutover. Do not
   infer that approval from this spec review.

## Operator runbook: closed cutover

1. Revalidate the remote `main` tip, target identities, current gate and
   active deployment IDs. Close the gate for the selected SHA using the
   pre-schema narrow operation. Confirm maintenance on normal web pages,
   same-origin API, direct API, and scheduled work; a private presentation
   probe may bypass GET/HEAD maintenance rendering only, never business
   authorization. Drain all leases with an explicit deadline. An interrupted
   or timed-out drain leaves the gate closed.
2. **After** closure and zero leases, record the active staging Neon LSN and
   create/verify a recoverable data-and-schema branch at that point. This is
   the cutover checkpoint; a pre-closure clone alone could omit a write
   admitted before closure. Verify source branch ID, retained data markers,
   ledger prefix, root-branch restore eligibility, and that the checkpoint
   can be opened separately. Do not migrate active staging until this
   evidence exists. Keep the isolated recovery branch until the release is
   accepted and retention is recorded.
3. Using the distinct direct migration credential, assert the same closure
   timestamp/SHA, zero leases, and exact checked-in `0010` ledger prefix.
   Apply only reviewed `0011_release_versions`. Verify the full checked-in
   migration hash, all four columns and all-or-none constraint, and unchanged
   retained application data. A drift or partial migration leaves maintenance
   closed for investigation; do not automatically reapply SQL.
4. Deploy the prepared web and API candidates from the same SHA, with no new
   build during closure. Read back both actual version IDs and confirm each
   is the sole active version at 100%. Confirm no independent deployment
   changed either Worker, and the API still targets staging Hyperdrive.
5. While closed, run private readiness/schema and web-render probes, verify
   the web proxy's expected API path, direct API ingress denial, public
   maintenance responses, and scheduled-handler no-op. Private probes must
   not use real account/session mutation. Record the post-closure result.
6. Use the current-schema gate `open` operation with closure-bound evidence:
   both Workers `changed: true`, their observed IDs and selected source SHA,
   `migration: applied_and_validated`, `privateSmokePassed: true`, and
   `inboxDelivery: waived`. Its compare-and-swap check requires the same
   closure timestamp and zero leases; it stores both version IDs atomically.
   Read back gate and Cloudflare deployment state before declaring open.
7. Run the complete public staging acceptance on that same SHA: auth
   verification/reset outbox and verified account/session controls, tenant
   isolation, account-free RSVP, CSV round trip, bounded cleanup, real
   scheduled email/provider and cleanup behavior, isolated 429→success
   retry evidence, and representative query plans on the disposable test
   branch. Label actual inbox delivery `waived`. A skipped required check is
   failure. Record the named check outcomes and durable deployment evidence.

After acceptance, `STAGING_RELEASE_ENABLED` may be proposed for a **separate**
decision, followed by one normal selective staging release rehearsal. Do not
set `PRODUCTION_RELEASE_ENABLED` here. Production first publication has its
own missing Workers, Hyperdrive, secrets, recovery and baseline problem;
staging success cannot stand in for that bootstrap.

## Failure, retry and recovery

| Failure point                                           | Required state and next action                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before closure                                          | Existing staging remains open; discard unserved candidate versions only after resolving exact IDs. Do not migrate or deploy.                                    |
| Closure or drain cannot be proven                       | Keep maintenance closed. Inspect leases/old Worker behavior; never force expiry or open on a timer.                                                             |
| Checkpoint, migration or retained-data validation fails | Keep maintenance closed. Diagnose against the isolated checkpoint; use a reviewed forward fix or restore only after verifying the matching Worker/schema state. |
| One Worker deploy or private smoke fails                | Keep maintenance closed. Do not expose a mixed pair. Resume only with the same SHA, observed versions and a reviewed fix.                                       |
| Open result is ambiguous or public acceptance fails     | Reclose immediately and verify maintenance; an unconfirmed reclose is an incident, not success. Reconcile gate, Cloudflare and GitHub records before retry.     |

Retries are bound to the original SHA and closure timestamp. After `0011`
lands, a retry uses the current-schema code; it must not run the pre-schema
migration a second time. A newer `main` SHA cannot take over an incomplete
closed cutover. No automatic code-only rollback across a schema change and no
automatic restore of active staging are allowed. Recovery must account for
data accepted before closure and any state created after reopen.

## Verification and exit criteria

Test the bootstrap coordinator with fail-closed cases for stale/unprotected
SHA, wrong Neon branch or Hyperdrive, enabled Version URLs/cache, unexpected
`0011` state, migration-prefix drift, no recovery point, nonzero leases,
upload/deploy mismatch, incomplete evidence, ambiguous open, and post-open
reclosure failure. Integration tests must start from actual `0010` schema
and confirm the one-time `0011` path, both Worker source SHAs, and subsequent
normal selective-release baseline. Run formatting, lint, typechecks, full
tests, builds/dry-runs, Bun parity smoke, and disposable PostgreSQL tests.
The live rehearsal must record observed, not inferred, auth/RSVP/CSV/cron
and query-plan outcomes.

Bootstrap is accepted only when the active staging gate is open at the tested
SHA with both actual 100% Worker version IDs, the full `0011` ledger hash,
zero leases, complete named staging acceptance, and a verified recovery
record. A public liveness check alone is insufficient. Keep production
disabled and do not claim production readiness until its separate first-
publication and auto-promotion path is implemented and verified.

## References

- [Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) distinguishes upload from active deployment and documents the default immediate 100% `wrangler deploy` behavior.
- [Worker Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) documents public access to uploaded versions when enabled.
- [Neon instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore) limits point-in-time restore to root branches and documents its overwrite semantics; use the current provider retention window and branch identity at execution time.
- [Neon branch CLI](https://neon.com/docs/cli/branches) documents creating an isolated historical branch with an explicit parent point.
- [Automatic Worker release design](2026-09-26-automatic-worker-release-design.md) defines the later normal selective flow and separate production bootstrap.
