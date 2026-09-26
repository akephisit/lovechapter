# Automatic Worker staging acceptance and selective production release

## Purpose and approved outcome

The first public LoveChapter installation uses the Cloudflare web and API
Workers and the existing Neon `production` branch. The owner wants one release
path: a committed change is pushed directly to `main` without a PR or reviewer;
one hosted CI gate checks that exact `main` commit, automated Worker staging
acceptance follows, and production promotion needs no second release click.
Every **application deployment**, even a web-only or API-only change, enters
maintenance across the whole site. Builds and tests finish before closure; the
workflow deploys only the affected Worker(s),
privately checks the whole application, and then reopens. Docs-only changes
with no application deployment do not enter maintenance.

The owner accepts a temporary exception for **real inbox delivery**. Automated
auth, outbox, provider-response, and cron checks still run, but neither CI nor
the release report may call an unobserved inbox delivery "passed." The current
Resend test sender cannot deliver verification/reset messages to ordinary
users; public launch with that limitation was explicitly accepted. Do not
weaken verified-email sign-in, bypass the email requirement, or silently turn
this exception into permanent policy. Revisit it when a sending domain or an
independent inbox test is available.

This design extends the already accepted Worker maintenance gate. It changes
the earlier component-only rule: deployment remains selective, but maintenance
is mandatory for every app deployment. It does not replace the canonical
schema with compatibility columns or dual-version APIs merely to avoid a
maintenance window. Bun/VPS remains an alternative for a different
installation and is checked by CI, but it is not deployed to this one.

## Current boundary and release authority

The staging Worker pair, Neon staging/staging-test branches, release admission
gate, drain command, private web presentation probe, and impact classifier
exist. The implementation worktree now contains a disabled push-to-`main`
coordinator and provider-verified release commands, but has not completed a
live exact-SHA staging release. There is no production Worker pair or
production Hyperdrive/secrets. The existing Neon `production` branch is
selected but is not an accepted application installation. `main` has neither a
matching ruleset nor legacy branch protection, and the repository has no
GitHub environments. The current CI verifies code but does not deploy.

Use **one GitHub Actions release coordinator**. Independent Cloudflare Git
deployments could make a Worker live before the gate closes or staging passes;
manual promotion conflicts with the requested automatic flow. Only the
coordinator may deploy either Worker, migrate the selected database, or open
the gate during a normal release; audited break-glass recovery uses the same
controller and is not a direct table edit. The owner may make changes in an
isolated branch/worktree, commit there, and push the candidate commit to
`main` by a normal fast-forward update. No branch-hosted CI, branch push, PR,
independent reviewer, or manual merge is required. Before pushing, verify
that the remote `main` tip is an ancestor of the candidate commit; never use
force-push to make the candidate fit. Run applicable local checks while
developing, but run hosted CI only once, on the actual `main` push.

Protect `main` against force-push and deletion, while allowing direct pushes
without required PR approval or pre-push status checks. Required pre-push
checks would conflict with the chosen post-push CI flow. Keep staging and
production environment secrets restricted to protected `main`; no branch or
PR job receives them. If write access expands beyond the owner, revisit this
direct-push authority before enabling automatic production release. A push
authorizes the normal release **only if** the same-SHA CI, staging acceptance,
and production bootstrap gates subsequently pass. A migration that
intentionally discards customer data remains outside the automatic path and
needs separate explicit owner approval and a recovery plan.

The coordinator serializes releases (`cancel-in-progress: false`), pins the
full commit SHA, and runs one CI/PostgreSQL validation path on the pushed
`main` SHA before any maintenance, migration, or deployment. Consolidate the
existing overlapping `main` CI workflows so validation is not duplicated;
component-specific artifact preparation may still build selected Workers for
each environment before its closure. A failed CI run leaves its commit on
`main` but does not enter maintenance or deploy; fix it with a later
fast-forward commit, never a force-reset. Only commits on protected `main` may
reach staging or production credentials. A queued run rechecks the current
production release baseline and staging result before promotion; a stale or
superseded run stops without changing production. The workflow records the
commit, impact plan, migration decision, Worker version IDs, gate transitions,
checks, and outcome without recording secrets or user data.

## Impact plan and component versions

Determine changes from the last successfully opened production commit to the
candidate commit, not only the latest push's `before` SHA. The production
release-control state and a durable GitHub deployment record must agree on
that baseline; an expiring workflow artifact is not the release ledger, and
mismatch fails closed. The first installation uses an explicit
bootstrap baseline, not a guessed Git diff. Keep `scripts/release-impact.mjs`
as the conservative planner and test its boundaries:

| Change                                                                    | Release build/deploy | Maintenance |
| ------------------------------------------------------------------------- | -------------------- | ----------- |
| Docs only, no app deployment                                              | Neither Worker       | No          |
| Web only                                                                  | Web Worker           | Whole site  |
| API, auth, jobs, or database code only without migration                  | API Worker           | Whole site  |
| Shared contracts/domain, SQL migration, or unknown executable/config path | Both Workers         | Whole site  |

CI continues to verify both supported backend runtime builds and the full
application. Release artifacts for the selected Worker(s) are built before
closure. When both Workers change, both builds and preflight checks finish
before either is deployed. A selective release retains the untouched Worker's
recorded version/source SHA; it does **not** falsely claim both Workers came
from the candidate SHA. A both-Worker release deploys both from that SHA at
100%, not a gradual incompatible mix. The private smoke covers the full
web/API pair in either case. An uncertain contract impact selects both.

A schema-source change without a generated SQL migration is rejected by the
existing planner. Every SQL migration also needs a checked-in risk/cutover
record stored as `packages/database/drizzle/reviews/<migration-basename>.md`:
expected data transformation, locking and query effects, whether it is
breaking, validation, and recovery. CI verifies the matching record and required
sections are present; no PR approval is required. A changed SQL file or
complete record alone is not proof that a migration is safe. Unknown or
destructive effects block automatic promotion rather than being guessed into
a compatibility mode; destructive data changes require separate owner approval.

## Automated acceptance on staging

The release coordinator uses separate, restricted staging credentials and
the existing staging Workers/Neon branch. It runs format, lint, types, unit
tests, Bun parity/build checks, Worker builds, PostgreSQL integration and
migration checks, and validates generated SQL. It applies pending migrations
to staging only through a direct, non-pooled TLS connection. Before every
staging app deployment it closes and drains the staging gate; the web/API
maintenance response and paused scheduled work must be observable. It deploys
the selected staging Worker(s), runs private smoke while closed, then reopens
only with evidence from that closure and SHA.

Live staging acceptance uses synthetic, bounded test records and checks auth
verification/reset requests, sign-in/session controls for a verified test
account, account-free RSVP, CSV import/export, and both scheduled job paths.
It verifies outbox state and
provider acceptance where applicable, but explicitly waives real inbox
receipt and therefore does not claim deployed token-link redemption passed
end-to-end; token validation/redemption still runs in isolated tests. The
retry/failure path can use the already approved isolated
PostgreSQL/provider-fake evidence; do not invalidate the active Resend key to
force a live failure. Representative SELECT query plans run on a disposable
synthetic-data database/branch, with tenant scope, expected cardinality,
indexes and round trips checked against reviewed expectations. Known critical
SQL shapes and query counts have automated assertions; a changed plan
expectation requires an updated checked-in rationale and automated regression
evidence, and a sequential scan on a tiny table is not failure by itself.
`EXPLAIN ANALYZE` is never used for unsafe production writes. Staging
acceptance records which checks actually ran, their results,
and the inbox waiver. A skipped required check is failure, not
success. If staging schema drift or a prior failed promotion makes it
impossible to demonstrate the migration path from the current production
schema, stop for reconciliation rather than assume staging's success proves
production safety.

## One-time production bootstrap

Automatic promotion stays **disabled** until a separately verified bootstrap
is complete. Provision a production Hyperdrive binding to the selected Neon
`production` branch with query caching disabled, dedicated application and
direct migration/release credentials, production web/API Workers, scoped
Cloudflare and Neon access, distinct proxy/probe/auth/Resend secrets, and
`staging`/`production` GitHub environments restricted to `main`. Keep
`workers.dev` origins configurable; no domain ownership is assumed. Validate
Worker names, Hyperdrive target, Neon project/branch/database/role, and
direct-vs-pooled connection identity against configured expected resources;
`RELEASE_ENVIRONMENT=production` or a URL's spelling alone is not identity
proof. No secret goes into Git, chat, logs, or client bundles.

Set up monitoring and a tested Neon recovery path. Rehearse a restore on an
isolated branch without touching live production. Apply the initial schema
and leave the production gate in maintenance **before** public Worker URLs
serve the application. Deploy both first versions, prove direct API ingress
is denied, privately test readiness, schema, web rendering and proxy, and
open only after evidence is accepted. This bootstrap is not a normal
component-selective release. Verify the Worker CPU/plan budget, cron and CSV
behavior, and the temporary email limitation before enabling auto-promotion.
The already existing production branch is not permission to skip bootstrap.

## Normal production cutover

1. Confirm exact-SHA staging acceptance, protected-source policy, impact and
   migration review, baseline/version identity, production resource identity,
   and recoverable Neon point. Build/dry-run selected production artifacts;
   do not close the gate if these checks fail.
2. Close the production gate for the SHA. Verify maintenance on public web
   routes and API; wait for zero HTTP and scheduled-work leases. Do not infer
   drainage from a timer or disable Cron Triggers as a substitute.
3. Run any reviewed pending migration and retained-data validation via the
   direct credential while closed. Run no migration for a no-migration release.
4. Deploy only the selected Worker(s) from the candidate SHA at 100% and
   verify the resulting version IDs and the untouched version(s). Cron stays
   gated during deployment.
5. Run authenticated **operator** probes while closed: API liveness and
   protected readiness/schema hash, private GET/HEAD web rendering through
   the presentation-only bypass, same-origin proxy/ingress rules, maintenance
   behavior and scheduled no-op. The probe secret grants no business mutation
   or user session. Record post-closure evidence, reopen atomically for that
   SHA, then verify public pages/API and job processing resume.

The release controller must be extended from staging-only to production
without allowing an environment flag to redirect a credential to the other
database. Its reopen evidence must carry actual changed and unchanged Worker
versions/source SHAs, migration outcome, post-closure smoke, and the accepted
staging SHA. It must reject evidence from an earlier closure, another SHA,
missing checks, or a resource mismatch. The old Worker is never relied upon
against a newly incompatible schema.

## Failure behavior and verification

Failure before production closure leaves production unchanged. Failure after
closure leaves the whole site in maintenance and surfaces an actionable
failed deployment/check; no automatic gate reopen, forced lease expiry,
database rollback, or code-only rollback across an incompatible schema. An
operator chooses a reviewed forward fix or tested database restore, validates
the resulting data and Worker pair, reruns private smoke, and only then opens.
Retries must be idempotent and bound to the same SHA/closure; a newer main
commit cannot silently take over a partially closed release.

Implementation validation must cover planner classification, branch/source
restrictions, secret isolation, the environment/branch identity guard,
stale-evidence rejection, closed/drained behavior, selective version evidence,
both-Worker cutover, skipped-check failure, migration failure, interrupted
deploy, and recovery runbook. Stage a full dry run before activating the
production trigger. Update `PROJECT_CONTEXT.md`, `AGENTS.md`, decisions,
deployment guide, open questions, and progress to supersede the previous
reviewer/PR source gate without weakening same-SHA CI, staging, maintenance,
or the inbox waiver. Remove the bootstrap preflight's independent-review
requirement; assert direct-push-compatible protected `main`, owner-only write
scope, no duplicate hosted `main` CI, and main-only environment secrets. The
existing `CODEOWNERS` file may document ownership but cannot be an enforced
release gate. No workflow may claim production is live until bootstrap and a
real production smoke pass.

## References

- [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) defines push-to-main SHA contexts.
- [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) documents direct pushes and status-check restrictions.
- [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) defines deployment-secret and branch restrictions.
- [Cloudflare Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) documents immediate 100% deployment behavior.
- [Prior Worker maintenance design](2026-09-26-worker-maintenance-cutover-design.md) defines the gate and staging drill that this release coordinator builds upon.
