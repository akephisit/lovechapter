# Automatic Worker Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically accept the exact `main` SHA on Worker staging, then release it to production with whole-site maintenance and selective Worker deployment.

**Architecture:** One GitHub Actions coordinator calls small, testable release modules. The planner, target guard, version/evidence ledger, staging probes, and cutover runner fail closed independently; production promotion is disabled until separate resources, protected source, and a closed-gate bootstrap are verified.

**Tech Stack:** Node.js 24, Bun 1.4.2 for local/operator tooling, TypeScript, Vitest, Elysia 2, Next.js/vinext, Wrangler 4.135.0, Cloudflare Workers/Hyperdrive, Neon PostgreSQL, Drizzle, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-26-automatic-worker-release-design.md`

**Source-policy supersession:** The PR/reviewer/required-pre-push-CI steps in
Tasks 7–9 are superseded by
`docs/superpowers/plans/2026-09-26-direct-main-single-ci-release.md` and
ADR-028. Preserve the remaining staging, maintenance, migration, and
production-bootstrap safety gates; do not treat this note as a live acceptance.

## Global Constraints

- The first production installation selects the Cloudflare API Worker, not Bun/VPS; CI still verifies the Bun alternative.
- Every app deployment closes the whole-site gate; docs-only changes neither deploy nor close it. Web-only deploys web, API-only deploys API, shared/migration/unknown deploys both.
- Use one canonical schema and coordinated breaking cutover; do not add legacy columns, dual writes, or old/new API compatibility solely for rolling release.
- Use the existing Neon `production` branch, separate staging resources, direct non-pooled TLS credentials for migrations/gate, and cache-disabled Hyperdrive for the Worker.
- Use configurable `*.workers.dev` origins; no custom domain is registered. Keep source/docs in English and owner communication in Thai.
- `RELEASE_PROBE_SECRET` is a distinct 32-byte base64url secret and permits GET/HEAD presentation only, never business mutations.
- Inbox delivery is **waived**, not passed. Keep verified-email auth and test auth/outbox/provider/cron paths that do not require inbox access.
- No secret, account data, invitation token, or database URL in Git, build artifacts, logs, release evidence, or chat.
- A post-closure failure keeps or restores maintenance; never automatically roll back a migrated database or clear an orphaned lease.

## Review Focus

1. A queued or superseded `main` run must not take over a release already closed for another SHA (Task 7 test).
2. A production URL or Hyperdrive binding resolving to staging must be rejected before database connection or deploy (Task 2 test).
3. Web-only evidence must preserve the actual unchanged API version/source SHA, not relabel it with the new commit (Task 3 test).
4. A failed public check immediately after reopen must reclose the gate and fail the release (Task 7 test).
5. A missed cron tick, provider failure, or missing query-plan check must fail staging acceptance rather than silently count as a pass (Task 6 test).

---

## File map and execution boundary

- `scripts/release-impact.mjs` and `scripts/migration-review.mjs`: pure path impact and reviewed migration decision.
- `packages/database/src/release-target.ts`: pre-connection Neon/Hyperdrive identity check; `release-evidence.ts`: typed reopen evidence; `release-gate-cli.ts`: staging/production gate commands.
- `scripts/worker-versions.mjs`: pre-close build/upload and post-close 100% version switch; Cloudflare deployment readback.
- `scripts/acceptance/staging-http.mjs`, `staging-jobs.mjs`, and the existing query-plan probe: bounded synthetic staging checks with structured evidence.
- `scripts/deployment-ledger.mjs`: durable GitHub deployment baseline and selected Worker version records.
- `scripts/release-orchestrator.mjs`: phase ordering and failure handling, with a thin `scripts/release-cli.mjs` for external commands.
- `.github/workflows/release.yml`: serial push-to-`main` coordinator, no PR secrets, disabled production promotion until bootstrap; `.github/CODEOWNERS` and existing CI are review gates.
- Worker Wrangler configs and package scripts: explicit production/staging target names and prebuild/deploy commands; docs record setup and recovery.

Do Tasks 1–7 without enabling production promotion. Task 8 performs the one-time external bootstrap only after its read-only preflight identifies the exact resources. Task 9 is the activation and live acceptance checkpoint. Each task gets its own commit and focused review; never advance past a failing check.

### Task 1: Conservative impact and migration review contract

**Files:** Modify `scripts/release-impact.mjs`, `scripts/release-impact.test.mjs`; create `scripts/migration-review.mjs`, `scripts/migration-review.test.mjs`. The existing root Vitest command collects these tests.

**Interfaces:** `classifyReleaseImpact(changes)` retains `{ web, backend, migrate }`. `validateMigrationReviews(changes, readReview): Promise<{ kind: "none" | "nonbreaking" | "breaking" | "blocked"; paths: string[] }>` reads `packages/database/drizzle/reviews/<migration-basename>.md` for each added/modified SQL file. Required nonempty sections: `Classification` (`breaking: yes|no`, `data_deletion: yes|no`), `Data transformation`, `Locking and query effects`, `Validation`, `Recovery`; `data_deletion: yes` yields `blocked`.

- [ ] **Step 1: Write failing tests.** In the two test files, assert `classifyReleaseImpact([{status:"A",path:"packages/database/drizzle/reviews/0011.md"}])` is docs-only, an SQL migration is both+`migrate`, a schema edit without added/modified SQL throws, and `validateMigrationReviews` rejects missing/empty sections or unknown classification while returning `blocked` for explicit data deletion.
- [ ] **Step 2: Run the focused tests.** `npx vitest run scripts/release-impact.test.mjs scripts/migration-review.test.mjs`; expected FAIL on the new cases.
- [ ] **Step 3: Implement the two exports.** Treat review Markdown as documentation before the database path branch; parse only exact migration basenames and headings, with no free-form SQL execution or inferred safety.
- [ ] **Step 4: Re-run focused tests and `npm run format:check`.** Both must pass.
- [ ] **Step 5: Commit.** `git add scripts/release-impact.mjs scripts/release-impact.test.mjs scripts/migration-review.mjs scripts/migration-review.test.mjs && git commit -m "feat(ops): require reviewed migration impact"`.

### Task 2: Verify environment identity before any release connection

**Files:** Create `packages/database/src/release-target.ts`, `packages/database/src/release-target.test.ts`; modify `packages/database/src/release-gate-cli.ts`, `packages/database/src/release-gate-cli.test.ts`; update `apps/api/wrangler.jsonc` production Hyperdrive ID only after Task 8 provisions it.

**Interfaces:** `ReleaseTargetInput` has `environment: "staging" | "production"`, expected Neon project/branch/database, separate direct release and Hyperdrive application roles, direct URL, and Cloudflare account/Hyperdrive IDs. `verifyReleaseTarget(input: ReleaseTargetInput, inventory: { neonEndpoints: NeonEndpoint[]; hyperdrive: HyperdriveConfig }): VerifiedReleaseTarget` compares exact expected branch/endpoint host/database, the direct URL user to the release role, the Hyperdrive origin user to the distinct application role, the Hyperdrive ID/origin, and `caching.disabled === true`; its return value contains only environment, branch ID, release role, database, and host. `loadReleaseInventory(input, credentials, fetcher = fetch)` calls Neon branch-endpoint and Cloudflare Hyperdrive read APIs; return only sanitized fields. `runReleaseGateCli` calls these checks for staging **and** production before `Client.connect()`; tests inject `fetcher` rather than using live credentials. Worker names are checked in Task 4.

- [ ] **Step 1: Write failing tests.** Assert production→staging branch/host, pooled URL, mismatched role/database, enabled Hyperdrive cache, API error, and a swapped Hyperdrive ID all reject before the injected `createClient` is called; valid staging/production inventory reaches `status`. Assert error output contains no password or token.
- [ ] **Step 2: Run `npx vitest run packages/database/src/release-target.test.ts packages/database/src/release-gate-cli.test.ts`;** expected FAIL for production and cross-environment cases.
- [ ] **Step 3: Implement typed guard and CLI integration.** Require explicit expected IDs from each GitHub environment and provider read tokens; do not trust `RELEASE_ENVIRONMENT` or URL spelling alone. Keep existing direct URL query-option rejection.
- [ ] **Step 4: Re-run focused tests and `npm run typecheck --workspace @lovechapter/database`;** both must pass.
- [ ] **Step 5: Commit.** `git add packages/database/src/release-target* packages/database/src/release-gate-cli* && git commit -m "feat(ops): verify Neon and Hyperdrive release target"`.

### Task 3: Exact-SHA, selective-version release evidence and durable baseline

**Files:** Create `packages/database/src/release-evidence.ts`, `packages/database/src/release-evidence.test.ts`, `scripts/deployment-ledger.mjs`, `scripts/deployment-ledger.test.mjs`; modify `packages/database/src/release-gate-cli.ts`, `packages/database/src/release-gate-cli.test.ts`.

**Interfaces:** `WorkerVersion = { versionId: string; sourceSha: string }`; `ProductionBaseline = { sha: string; web: WorkerVersion; api: WorkerVersion }`. `validateReleaseEvidence(raw, { environment, sha, closedAt, previousVersions, stagingSha })` returns a typed record containing `web`/`api: { versionId, sourceSha, changed }`, `migration: "not_required" | "applied_and_validated"`, `privateSmokePassed`, `acceptedAt`, and explicit `inboxDelivery: "waived"`. `selectProductionBaseline(deployments, statuses, gateStatus): ProductionBaseline` accepts only a successful `lovechapter-worker-release` deployment whose SHA and versions agree with `ops.release_control`; `recordDeployment(result, githubClient)` writes a success status only after reopen and public verification.

- [ ] **Step 1: Write failing tests.** Assert a web-only release keeps the previous API ID/SHA, a both-Worker release requires both new SHAs, stale `acceptedAt <= closedAt` or staging SHA mismatch rejects, a failed/missing GitHub status, unrelated GitHub environment deployment, or gate mismatch yields no baseline, and no credential/user field is serialized.
- [ ] **Step 2: Run `npx vitest run packages/database/src/release-evidence.test.ts scripts/deployment-ledger.test.mjs packages/database/src/release-gate-cli.test.ts`;** expected FAIL.
- [ ] **Step 3: Implement validator, CLI use, and GitHub deployment adapter.** Read real Cloudflare version IDs separately in Task 4; do not use expiring Actions artifacts as the baseline ledger.
- [ ] **Step 4: Re-run focused tests and database typecheck;** both must pass.
- [ ] **Step 5: Commit.** `git add packages/database/src/release-evidence* packages/database/src/release-gate-cli* scripts/deployment-ledger* && git commit -m "feat(ops): attest selective release versions"`.

### Task 4: Build before closure and switch only selected Worker versions

**Files:** Create `scripts/worker-versions.mjs`, `scripts/worker-versions.test.mjs`; modify `apps/api/package.json`, `apps/web/package.json` to add explicit prepare/promote commands. Retain the staging API default-target preflight in `scripts/staging-api-preflight.mjs`; production Wrangler configuration is Task 9.

**Interfaces:** `PreparedVersions = { sha: string; previous: { web: WorkerVersion; api: WorkerVersion }; webBuilt: boolean; apiUploadedVersionId?: string }`, using `WorkerVersion` from Task 3. `prepareWorkerVersions({ environment, impact, sha }, commandRunner): Promise<PreparedVersions>` builds selected components, dry-runs against explicit Worker names/bindings, and uploads the API version without serving it. For web, `vinext build` precedes closure and `vinext-cloudflare deploy --skip-build` is the selected post-close path. `deployPreparedVersions(prepared, commandRunner): Promise<{ web: WorkerVersion; api: WorkerVersion }>` switches only selected component(s), checks each active Cloudflare deployment is exactly one version at 100%, and reads back unchanged versions.

- [ ] **Step 1: Write failing tests.** Assert web-only never executes API deploy, API-only never executes web deploy, both builds finish before any switch, unknown/missing `staging` env or placeholder Hyperdrive aborts, a sentinel secret is absent from the web client bundle, and a 90/10 split or wrong Worker name fails readback.
- [ ] **Step 2: Run `npx vitest run scripts/worker-versions.test.mjs scripts/staging-api-preflight.test.mjs scripts/staging-worker-config.test.mjs`;** expected FAIL for new behavior.
- [ ] **Step 3: Implement command adapter.** Use pinned Wrangler 4.135.0 and vinext beta.8/10; keep `keep_vars` and 100% deployments. Do not use independent Cloudflare Git deployment. Verify the web `--skip-build` path on staging before allowing production.
- [ ] **Step 4: Re-run focused tests and both Worker dry-runs;** expected PASS with correct staging/default IDs and no publish.
- [ ] **Step 5: Commit.** `git add scripts/worker-versions* apps/api/package.json apps/web/package.json && git commit -m "feat(ops): prepare selective Worker deployments"`.

### Task 5: Bounded live staging HTTP acceptance

**Files:** Create `scripts/acceptance/staging-http.mjs`, `scripts/acceptance/staging-http.test.mjs`; update `docs/DEPLOYMENT.md` only for the required staging test account/secret setup.

**Interfaces:** `runStagingHttpAcceptance({ webOrigin, testEmail, testPassword, sha }, { fetcher, fixtureStore }): Promise<HttpAcceptance>` drives `/api/v1/auth/*`, `/api/v1/weddings`, guest invitation/RSVP, and CSV import/export through the web Worker. `fixtureStore` records exact synthetic IDs/tokens for scoped cleanup; no broad table deletion. The result contains named passed checks and `inboxDelivery: "waived"`, never a claim that inbox receipt or deployed token-link redemption passed.

- [ ] **Step 1: Write failing tests.** Assert verified-account sign-in/session/sign-out, verification/reset request 202 plus outbox observation, guest RSVP without account, bounded CSV round trip, and cleanup of only test-created IDs. A 503, stale cookie, wrong tenant, or cleanup failure rejects and returns no accepted report.
- [ ] **Step 2: Run `npx vitest run scripts/acceptance/staging-http.test.mjs`;** expected FAIL.
- [ ] **Step 3: Implement HTTP runner with injected fetch and scoped fixture store.** Keep credentials and invitation tokens out of logs/JSON evidence; use one staging-only verified account whose password is stored in GitHub staging secrets after one-time owner setup.
- [ ] **Step 4: Re-run focused tests and `npm run lint`;** both must pass.
- [ ] **Step 5: Commit.** `git add scripts/acceptance/staging-http* docs/DEPLOYMENT.md && git commit -m "feat(ops): automate staging HTTP acceptance"`.

### Task 6: Cron, retry, and query-plan acceptance

**Files:** Create `scripts/acceptance/staging-jobs.mjs`, `scripts/acceptance/staging-jobs.test.mjs`, `scripts/staging-query-plan-probe.test.mjs`; modify `scripts/staging-query-plan-probe.mjs`, `docs/QUERY_REVIEW.md`.

**Interfaces:** `runStagingJobsAcceptance({ sha, deadlines }, { store, clock }): Promise<JobsAcceptance>` creates only tagged synthetic email/cleanup markers, observes the real 1-minute and 15-minute staging schedules, and requires expected bounded state changes. `runQueryPlanProbe({ testDatabaseUrl, activeStagingHost, productionHost, expectedTestBranchId, confirm }, clientFactory, neonInventory): Promise<QueryPlanAcceptance>` proves the URL host belongs to the expected disposable Neon branch and differs from staging/production, then seeds representative data in a rolled-back transaction and asserts reviewed critical index/query-count expectations; it never connects to production or executes mutating `EXPLAIN ANALYZE`.

- [ ] **Step 1: Write failing tests.** Assert a missed cron deadline or provider rejection fails; a separate fake-provider 429→success retry passes only as isolated evidence; identical staging/test hosts, a production host, wrong test branch ID, missing confirmation, absent critical plan, or failed transaction rollback rejects. Assert the report labels real inbox delivery `waived`.
- [ ] **Step 2: Run `npx vitest run scripts/acceptance/staging-jobs.test.mjs scripts/staging-query-plan-probe.test.mjs`;** expected FAIL.
- [ ] **Step 3: Implement the two runners.** Preserve safe SELECT plan shapes and synthetic fixture sizes from `docs/QUERY_REVIEW.md`; pass URLs through environment secrets instead of hardcoded local file paths; use the existing bounded job limits.
- [ ] **Step 4: Re-run focused tests plus disposable PostgreSQL integration tests (`npm run test:postgres --workspace @lovechapter/database` with confirmed test DB);** both must pass.
- [ ] **Step 5: Commit.** `git add scripts/acceptance/staging-jobs* scripts/staging-query-plan-probe* docs/QUERY_REVIEW.md && git commit -m "feat(ops): gate staging jobs and query plans"`.

### Task 7: Serial cutover runner and guarded GitHub workflow

**Files:** Create `scripts/release-orchestrator.mjs`, `scripts/release-orchestrator.test.mjs`, `scripts/release-cli.mjs`, `scripts/release-workflow.test.mjs`, `scripts/release-migration-command.mjs`, `packages/database/src/release-migration-cli.ts`, `.github/workflows/release.yml`, `.github/CODEOWNERS`; modify `docs/DEPLOYMENT.md` to document the disabled-by-default workflow. Keep existing `.github/workflows/ci.yml` as an independent PR gate.

**Interfaces:** `runCutover({ environment, sha, impact, migration }, driver): Promise<ReleaseResult>` calls `driver.prepare → close → drain → migrate-if-required → deploy → privateSmoke → open → publicCheck → record`; every method receives the full SHA and returns a typed result or throws. `driver.reclose(sha)` runs if `publicCheck` fails after open. `driver` supplies the Task 2–6 adapters. A production call additionally requires exact-SHA staging acceptance, baseline match, recovery checkpoint, protected `main`, and `PRODUCTION_RELEASE_ENABLED === "true"`; otherwise no production mutation. `scripts/release-cli.mjs` is the only workflow entry point and never prints secret arguments.

- [ ] **Step 1: Write failing tests.** Assert preparation failure never closes; drain/migration/deploy/smoke failure leaves gate closed; failed post-open public check recloses; a newer SHA cannot steal an already closed release; docs-only performs no deploy/maintenance; skipped staging check blocks production. Static workflow test asserts `push: main`, checkout of the exact `github.sha`, same-SHA CI and PostgreSQL jobs before staging, one serial concurrency group with `cancel-in-progress: false`, staging→production `needs`, `production` flag default-off, no `pull_request_target`/PR secrets, and no production deploy command outside the guarded job.
- [ ] **Step 2: Run `npx vitest run scripts/release-orchestrator.test.mjs scripts/release-workflow.test.mjs`;** expected FAIL.
- [ ] **Step 3: Implement the runner and workflow.** Re-run CI on actual `main` SHA after merge; use `contents: read`/`deployments: write` only where needed, environment-scoped secrets, pinned Actions, `main` branch restrictions, and no automatic production credential on PR. Failed reclose raises an incident and never records success.
- [ ] **Step 4: Run focused tests, `npm run ci`, and PostgreSQL integration on a disposable database;** all must pass before enabling any live job.
- [ ] **Step 5: Commit.** `git add scripts/release-orchestrator* scripts/release-cli.mjs scripts/release-workflow.test.mjs .github/workflows/release.yml .github/CODEOWNERS docs/DEPLOYMENT.md && git commit -m "feat(ops): coordinate gated Worker releases"`.

### Task 8: Protected source, staging rehearsal, and production preflight

**Files:** Modify `AGENTS.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`, `PROJECT_CONTEXT.md`, `docs/OPEN_QUESTIONS.md`, `docs/PROGRESS.md`; create `scripts/bootstrap-preflight.mjs`, `scripts/bootstrap-preflight.test.mjs`. External targets in this task: protected `main`, GitHub `staging`/`production` environments, and staging-only credentials. Production resources remain unprovisioned until Task 9.

**Interfaces:** `checkBootstrapReadiness({ github, neon, cloudflare, secretsMetadata, recoveryEvidence }): BootstrapReadiness` reports exact missing protections/resources without reading secret values. The preflight is read-only and cannot set `PRODUCTION_RELEASE_ENABLED`. The staging-only workflow runs with production promotion disabled and proves automated maintenance, selective deploy, and named acceptance checks before production provisioning.

- [ ] **Step 1: Write failing preflight tests.** Missing required CI/review/owner protection, an environment with required reviewers or non-main deployment access, independent Cloudflare Git deployment, wrong Neon branch ID, default/pooled Hyperdrive, missing Worker secret name, missing restore evidence, or an open gate before first Worker publication each yields `ready: false` with no secret value in diagnostics.
- [ ] **Step 2: Run `npx vitest run scripts/bootstrap-preflight.test.mjs`;** expected FAIL.
- [ ] **Step 3: Implement preflight and exact-target runbook.** Record the permanent maintenance/selective-deploy rule in `AGENTS.md` and product decisions; configure required `Verify` and `PostgreSQL integration` checks plus human/owner review on `main`, and main-only environments without required deployment reviewers or production secrets. If no independent reviewer can satisfy the branch rule, stop and ask for a trusted collaborator rather than bypassing review. Disable independent Cloudflare Git deployment. Ask the owner to place staging keys in the GitHub staging environment, never chat.
- [ ] **Step 4: Re-run preflight tests and stage a live release with production flag off.** Verify exact-SHA auth/RSVP/CSV/cron/query-plan evidence and staging maintenance/selective behavior; preflight should truthfully report missing production resources rather than pass.
- [ ] **Step 5: Commit code/docs only.** `git add scripts/bootstrap-preflight* AGENTS.md docs/DEPLOYMENT.md docs/DECISIONS.md PROJECT_CONTEXT.md docs/OPEN_QUESTIONS.md docs/PROGRESS.md && git commit -m "docs(ops): protect source and rehearse Worker staging"` (omit unchanged files; never add local credentials).

### Task 9: One-time production bootstrap and auto-promotion activation

**Files:** Modify `apps/api/wrangler.jsonc`, `docs/DEPLOYMENT.md`, `docs/PROGRESS.md`, `docs/QUERY_REVIEW.md` for production targets, runbook, and actual evidence. External: dedicated production Hyperdrive and Workers, credentials in the production GitHub environment, and `PRODUCTION_RELEASE_ENABLED` after bootstrap acceptance.

**Interfaces:** The one-time operator sequence provisions the selected Neon `production` branch's application/release roles, dedicated cache-disabled Hyperdrive, Worker bindings/secrets, and recovery checkpoint; rehearses restore on an isolated branch; applies initial schema and closes the gate **before** first public Worker publication. It deploys both Workers, private-smokes while closed, opens only with accepted evidence, and verifies public behavior. Only then enable automatic promotion; the durable GitHub deployment status and `ops.release_control` must agree on SHA/versions. No bypass for inbox: report `waived`.

- [ ] **Step 1: Write the bootstrap checklist as assertions in the runbook.** Capture SHA, both first Worker version IDs, gate closure/drain/open timestamps, migration result, accepted staging checks, inbox waiver, recoverable point, isolated restore result, and production public smoke; a missing item blocks activation.
- [ ] **Step 2: Run the full local and disposable-DB gates.** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run ci`, `npm run test:postgres --workspace @lovechapter/database`, and jobs PostgreSQL integration with confirmed disposable credentials; each must pass.
- [ ] **Step 3: Resolve exact production targets read-only, then provision.** Confirm project/branch IDs, Worker names, Hyperdrive origin/cache, least-privilege roles, Workers Paid CPU budget, separate secrets, and workers.dev origins; never print secret values. Repeat staging both-Worker migration rehearsal on a disposable branch if Task 8 did not cover it.
- [ ] **Step 4: Bootstrap behind a closed gate and activate.** Rehearse isolated Neon PITR restore, migrate the production branch, close before either first Worker URL is published, deploy both, private/public smoke, and verify branch/environment protections plus explicit inbox-waiver report. Only then set `PRODUCTION_RELEASE_ENABLED=true`; verify automatic promotion on the next reviewed app commit to `main`. On any failure, leave/restore maintenance and stop.
- [ ] **Step 5: Record evidence and commit documentation/config.** Update progress/runbook/query review with actual results, not anticipated success; `git add apps/api/wrangler.jsonc docs/DEPLOYMENT.md docs/PROGRESS.md docs/QUERY_REVIEW.md && git commit -m "docs(ops): record Worker production bootstrap"` (omit unchanged files).

## Official references to recheck at execution time

- [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- [Cloudflare Worker versions/deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/), [Worker deployment API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/), and [Hyperdrive config read API](https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/get/).
- [Neon branch endpoints API](https://api-docs.neon.tech/reference/listprojectbranchendpoints) and [Neon branch isolation](https://neon.com/docs/get-started-with-neon/workflow-primer).
