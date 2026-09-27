# One-time Staging Worker Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first accepted, exact-SHA Worker pair on active staging without exposing a mixed application/schema, then hand subsequent releases to the normal selective coordinator.

**Architecture:** A short-lived, protected-main manual workflow reuses the existing target guard, Worker preparation/deployment, smoke, acceptance, and current-schema gate modules. Only pre-`0011` gate inspection/closure/drain and the `0010` → `0011` migration entry are new. A post-drain Neon recovery branch precedes migration; both Workers are deployed from prepared artifacts while maintenance is closed. The one-time path is removed after accepted staging evidence.

**Tech Stack:** Node.js 24, Bun 1.4.2, TypeScript, Vitest, PostgreSQL 16, Neon CLI/API, Drizzle ORM, Wrangler 4.135.0, Next.js/vinext, Cloudflare Workers/Hyperdrive, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-27-staging-worker-baseline-design.md`

## Global Constraints

- This plan implements **staging only**. Keep `STAGING_RELEASE_ENABLED` and `PRODUCTION_RELEASE_ENABLED` unset; production first-publication is separate.
- The workflow is `workflow_dispatch` on protected `main`, pinned to one full SHA and serialized with `lovechapter-worker-release`; CI and disposable PostgreSQL jobs precede access to staging secrets.
- The existing provider-verified target guard must run before database connection or Worker upload. Match exact Neon branch/endpoint, distinct direct release/migration roles, staging-only cache-disabled Hyperdrive, Worker names, and disabled Version URLs.
- Require active `0010` as the exact migration prefix and no `0011` version columns before the one-time path. Migrate only reviewed `0011_release_versions`; do not add a permanent dual-schema normal release path.
- Build/check **both** Workers before closure; an API upload is allowed only while its Version URL is disabled and must not activate it. No rebuild occurs during closure.
- Close the whole-site gate, drain HTTP/email/cleanup leases without forcing expiry, then create and verify the **post-drain** recovery branch before migration.
- Record actual 100% Worker version IDs and source SHAs; private smoke while closed precedes atomic reopen. Full public auth/RSVP/CSV/cron/query-plan acceptance follows; inbox delivery is `waived`, never `passed`.
- Failure after closure leaves or restores maintenance. No automatic active-branch restore, data deletion, old-binary rollback, or cross-SHA takeover. Never print credentials, database URLs, account data, or provider response bodies.
- The owner approved this spec for planning, **not** active staging closure, migration, Worker upload/deploy, or release-switch activation. A separate go/no-go is required after implementation and dry-run review.

## Review Focus

1. An already-closed gate for the same SHA must retain its original `changed_at`, not silently reset the closure boundary (Task 1 test).
2. A fresh pre-closure clone must not count as the required post-drain checkpoint (Task 3 test).
3. A candidate API version that could be reached through a Version URL must block upload, even when the active Worker URL is healthy (Task 4 test).
4. A partial/ambiguous Worker deployment or gate-open response must leave maintenance in force and must not record an accepted baseline (Task 4 test).
5. Failed public acceptance followed by failed reclosure must be reported as an incident, not a successful or safely closed release (Task 4 test).

---

## File map and execution boundary

- `packages/database/src/staging-bootstrap-gate.ts`: one-time, pre-`0011` gate status, one-time closure, bounded drain; no change to normal `PostgresReleaseGateController.status()`.
- `packages/database/src/staging-bootstrap-cli.ts`: provider-verified staging-only direct connection and narrow gate commands.
- `packages/database/src/staging-bootstrap-migration-cli.ts`: closure-bound, exact-prefix `0011` migration and current-schema validation.
- `scripts/staging-bootstrap-recovery.mjs`: Neon identity, isolated rehearsal, LSN checkpoint, and data/ledger verification without logging secrets.
- `scripts/staging-worker-baseline.mjs`: injectable phase coordinator and fail-closed state transitions. `scripts/deployment-ledger.mjs`: sanitized durable staging-baseline record after acceptance.
- `scripts/staging-worker-baseline-cli.mjs`: protected-main adapter to existing Worker, smoke, acceptance, GitHub, and database commands.
- `.github/workflows/staging-worker-baseline.yml`: one-time manual, serialized workflow. `docs/DEPLOYMENT.md` and `docs/PROGRESS.md`: operator packet and actual evidence only.

Tasks 1–4 implement and locally verify a **disabled-by-default** capability. Task 5 is a separate, explicitly approved live operation. Task 6 removes the one-time capability only after Task 5 is accepted. Each task gets a focused test cycle and commit; do not advance past a failing gate.

### Task 1: Narrow pre-schema gate controller

**Files:** Create `packages/database/src/staging-bootstrap-gate.ts`, `packages/database/src/staging-bootstrap-gate.test.ts`; modify `packages/database/src/release-gate-postgres.integration.ts` to start a second fixture at the checked-in `0010` prefix.

**Interfaces:** `PreSchemaGateStatus = { mode: "open" | "maintenance"; targetSha: string | null; changedAt: string; activeCount: number; oldestLeases: { id: string; kind: "http" | "email" | "cleanup"; startedAt: string }[] }`. `PostgresStagingBootstrapGate(client: Client)` exposes `status(): Promise<PreSchemaGateStatus>`, `closeOnce(sha: string): Promise<PreSchemaGateStatus>`, and `drain(sha: string, closedAt: string, options: { deadlineMs: number; signal?: AbortSignal }): Promise<PreSchemaGateStatus>`. It reads only the four pre-`0011` control columns and at most 100 ordered leases; `closeOnce` changes an **open** row only. Resume requires a separate status read with the original timestamp.

- [ ] **Step 1: Write failing tests.** Assert `status` never selects version columns; `closeOnce` requires a lowercase 40-character SHA, refuses a different/already-closed SHA without changing `changed_at`, and returns the observed closure timestamp. Assert `drain` verifies the same SHA/timestamp on every poll, reaches zero, and rejects timeout/abort without expiring leases. Add a real PostgreSQL `0010` fixture proving these operations work without the four `0011` columns.
- [ ] **Step 2: Run focused tests.** `npx vitest run packages/database/src/staging-bootstrap-gate.test.ts`; expected FAIL for the missing controller. Run the new PostgreSQL case with `TEST_DATABASE_URL` pointing only to disposable PostgreSQL; expected FAIL before implementation.
- [ ] **Step 3: Implement the stated controller.** Use parameterized SQL and a conditional `UPDATE ... WHERE id = 1 AND mode = 'open' RETURNING changed_at`; keep the existing current-schema repository unchanged.
- [ ] **Step 4: Verify.** Focused Vitest and `TEST_DATABASE_URL=... TEST_DATABASE_CONFIRM=lovechapter_test npm run test:postgres --workspace @lovechapter/database` pass on disposable PostgreSQL; database typecheck passes.
- [ ] **Step 5: Commit.** `git add packages/database/src/staging-bootstrap-gate.ts packages/database/src/staging-bootstrap-gate.test.ts packages/database/src/release-gate-postgres.integration.ts && git commit -m "feat(ops): add one-time pre-schema staging gate"`.

### Task 2: Verified gate and exact `0011` migration commands

**Files:** Create `packages/database/src/staging-bootstrap-cli.ts`, `packages/database/src/staging-bootstrap-cli.test.ts`, `packages/database/src/staging-bootstrap-migration-cli.ts`, `packages/database/src/staging-bootstrap-migration-cli.test.ts`; extend `packages/database/src/release-gate-postgres.integration.ts`.

**Interfaces:** `runStagingBootstrapGateCli(args: string[], env: Record<string,string|undefined>, options?): Promise<void>` accepts only `status`, `close --sha <full-sha>`, or `drain --sha <full-sha> --closed-at <timestamp>`. `runStagingBootstrapMigrationCli(args: string[], env: Record<string,string|undefined>, options?): Promise<void>` accepts only `--sha`, `--closed-at`, `--checkpoint-branch-id`, and `--checkpoint-lsn`; it independently reads the checkpoint branch and requires Neon's `parent_id` to equal the verified staging branch and `parent_lsn` to equal the supplied LSN, then verifies retained SQL markers before trusting it. Both call `releaseTargetFromEnvironment`, `validateDirectDatabaseUrl`, `loadReleaseInventory`, and `verifyReleaseTarget` before connecting, require `RELEASE_ENVIRONMENT=staging`, and emit metadata-only JSON. Migration uses the distinct direct `RELEASE_MIGRATION_DATABASE_URL`/role, `pendingMigrations()` equal to exactly `["packages/database/drizzle/0011_release_versions.sql"]`, Drizzle's checked-in folder, and `expectedSchemaMigrationHash`; it then verifies all four columns, the all-or-none constraint, retained-row markers, same closed SHA/timestamp, and zero leases through current-schema status.

- [ ] **Step 1: Write failing tests.** Wrong Neon branch/endpoint, pooled URL, wrong role/Hyperdrive, `production`, missing checkpoint, `0011` already applied, unexpected ledger prefix, changed closure timestamp, or nonzero lease count reject before mutation. The disposable `0010` integration case applies `0011` exactly once and verifies current-schema status and retained fixture rows; its second invocation fails without rerunning SQL. Sanitized errors contain no credential or URL.
- [ ] **Step 2: Run focused tests.** `npx vitest run packages/database/src/staging-bootstrap-cli.test.ts packages/database/src/staging-bootstrap-migration-cli.test.ts`; expected FAIL for missing commands.
- [ ] **Step 3: Implement the two CLIs.** Reuse existing target/migration helpers; do not broaden `release-gate-cli.ts` or `release-migration-cli.ts` to accept old schemas. Bind migration to the checkpoint verified by Task 3, not merely a supplied nonempty ID.
- [ ] **Step 4: Verify.** Focused Vitest, disposable PostgreSQL integration, database typecheck, and `npm run db:check --workspace @lovechapter/database` pass.
- [ ] **Step 5: Commit.** `git add packages/database/src/staging-bootstrap-cli* packages/database/src/staging-bootstrap-migration-cli* packages/database/src/release-gate-postgres.integration.ts && git commit -m "feat(ops): guard one-time staging migration"`.

### Task 3: Neon rehearsal and post-drain recovery evidence

**Files:** Create `scripts/staging-bootstrap-recovery.mjs`, `scripts/staging-bootstrap-recovery.test.mjs`; modify `docs/DEPLOYMENT.md` with the recovery and stop-condition packet.

**Interfaces:** `RetainedMarkers = { users: number; weddings: number; guests: number; invitations: number; rsvps: number; authAccounts: number; authEmailJobs: number }`, read by fixed, bounded operational queries. `rehearseStagingBootstrap({ projectId, stagingBranchId, expectedPending }, neon, connect): Promise<RehearsalEvidence>` creates an isolated **data-and-schema** child from current staging, checks `0010` ledger and retained markers, applies reviewed `0011` with a branch-specific direct credential, and validates `0011`; it separately creates/opens a historical child from a known point without restoring active staging. `createPostDrainCheckpoint({ projectId, stagingBranchId, sha, closedAt }, neon, connect): Promise<CheckpointEvidence>` requires a root staging branch, current retained-history eligibility, unchanged drained closure, and an LSN read **after drain** with `select pg_current_wal_flush_lsn()::text`; it creates a uniquely named branch with Neon API `branch.parent_id=<staging ID>`, `branch.parent_lsn=<observed LSN>`, and `branch.init_source=parent-data`, then reads back those fields, opens the child separately, and verifies the `0010` ledger and retained markers. Provider response bodies and credentials are never printed. Evidence includes branch ID, LSN, closure timestamp, marker counts, and verification time, never a URL/password.

- [ ] **Step 1: Write failing tests.** Reject a `staging-test`/already-`0011` rehearsal source, schema-only clone, wrong parent ID, expired LSN, unavailable root-history restore, pre-closure or pre-drain clone, marker mismatch, and a checkpoint that cannot be opened. Assert no active staging reset/restore/delete call and no secret-bearing evidence.
- [ ] **Step 2: Run focused tests.** `npx vitest run scripts/staging-bootstrap-recovery.test.mjs`; expected FAIL for missing exports.
- [ ] **Step 3: Implement provider adapter and runbook.** Use documented Neon branch API/CLI with explicit project/branch IDs and `--no-secrets` where applicable; fail closed if exact-LSN checkpoint semantics cannot be established. The disposable rehearsal branch is not the permanent checkpoint.
- [ ] **Step 4: Verify.** Focused Vitest, `npm run format:check`, and `npm run lint` pass. Only read-only provider discovery is allowed at this task's end; do not create an active cutover checkpoint yet.
- [ ] **Step 5: Commit.** `git add scripts/staging-bootstrap-recovery* docs/DEPLOYMENT.md && git commit -m "feat(ops): verify staging recovery checkpoint"`.

### Task 4: Manual coordinator, private/public acceptance, and workflow

**Files:** Create `scripts/staging-worker-baseline.mjs`, `scripts/staging-worker-baseline.test.mjs`, `scripts/staging-worker-baseline-cli.mjs`, `scripts/staging-worker-baseline-workflow.test.mjs`, `.github/workflows/staging-worker-baseline.yml`; modify `scripts/deployment-ledger.mjs`, `scripts/deployment-ledger.test.mjs`, `docs/DEPLOYMENT.md`, and `docs/PROGRESS.md`.

**Interfaces:** `runStagingWorkerBaseline({ sha }, driver): Promise<BaselineResult>` orders `preflight → rehearsal → goNoGo → prepareBoth → closeOnce → drain → checkpoint → migrate0011 → deployBoth → privateSmoke → pausedJobs → open → publicAcceptance → record`. The `driver` exposes each named method, `readMainHead()`, `readActiveDeployments()`, `reclose(sha)`, and `incident(reason)`; `pausedJobs` uses bounded tagged markers and observes both configured cron schedules without public mutations. Its adapter reuses `prepareWorkerVersions({ environment: "staging", impact: { web: true, backend: true }, previous: null, ... })`, `deployPreparedVersions`, `runPrivateReleaseSmoke`, current-schema `gate.open`, `runPublicReleaseCheck`, and `runStagingAcceptanceCli`. `recordStagingBaseline({ sha, gateStatus, acceptance, checkpoint }, githubClient): Promise<number>` writes a sanitized GitHub `staging` deployment and success status only after gate/version/acceptance agreement. The workflow is manual only, protected-main/repository gated, same-SHA `npm run ci` and PostgreSQL integration, serialized with `.github/workflows/release.yml`, and uses staging environment secrets plus `deployments: write` only in the final job. A separate, exact-SHA owner go/no-go must be represented by a guarded dispatch input or a second dispatch stage **after** a published pre-cutover packet; a default input cannot authorize API upload, closure, or deploy.

- [ ] **Step 1: Write failing tests.** Assert stale/unprotected `main`, either enabled release flag, wrong target, wrong Worker name, enabled Version URL/cache, independent Cloudflare Git deployment, missing CI/Postgres result, incomplete rehearsal or go/no-go packet, and changed active version reject before upload/closure. Assert API upload occurs only with disabled Version URL and never activates before closure; both builds precede closure. Missing checkpoint, nonzero leases, deployment not exactly one version at 100%, mixed source SHA, incomplete private smoke/evidence, ambiguous open, or skipped named acceptance (including isolated retry) cannot record success. Private smoke verifies pages, proxy/direct API denial, and scheduled no-op while closed. Public failure must reclose; failed reclose calls `incident` and fails. The GitHub staging-baseline record excludes credentials and cannot be marked successful before named acceptance. Static YAML test checks the manual/protected-main/same-SHA/serialized/environment constraints.
- [ ] **Step 2: Run focused tests.** `npx vitest run scripts/staging-worker-baseline.test.mjs scripts/staging-worker-baseline-workflow.test.mjs`; expected FAIL for missing coordinator/workflow.
- [ ] **Step 3: Implement coordinator, thin CLI, and workflow.** Reuse existing target guard and smoke/evidence builders; use the normal current-schema gate only after migration. Record actual IDs/SHAs and named acceptance outcomes with `inboxDelivery: "waived"`. Make any uncertain open/reclose result fail closed, not green.
- [ ] **Step 4: Verify without live mutation.** Focused tests, `npm run ci`, disposable PostgreSQL/job integration, API Worker Wrangler dry-run, web vinext dry-run, Bun API/job smoke, and workflow static checks pass. A protected-main dispatch must have a pre-cutover mode that may create only isolated rehearsal branches, not upload a Worker version or touch active staging; do not dispatch the active mode under this task.
- [ ] **Step 5: Commit and push through the approved direct-main source flow.** Commit only code/docs/config, then fast-forward push after local checks; hosted same-SHA CI must pass. Keep both release flags unset and report the pre-cutover packet for owner review.

### Task 5: Active staging cutover and acceptance — separate go/no-go

**Files:** Update `docs/PROGRESS.md` and `docs/DEPLOYMENT.md` with observed evidence only. External targets: active staging Neon branch, its two Workers, and the isolated checkpoint branch. No production target.

**Interface:** The Task 4 workflow's active mode requires the owner-approved full SHA and pre-cutover packet ID; it cannot be triggered by a default or stale input. This task is **blocked until the owner separately approves that exact active staging cutover** after reviewing Task 4's implementation, dry-run, recovery rehearsal, and expected maintenance window.

- [ ] **Step 1: Re-read live identities and stop conditions.** Confirm protected `main` SHA, no concurrent release, flags unset, active `0010`, gate open, both gate-aware Workers at 100%, disabled Version URLs, exact staging Hyperdrive, root/retention eligibility, distinct roles, rehearsal and recovery contact. Any drift means no-go; active leases are allowed here but must reach zero after closure and drain.
- [ ] **Step 2: Dispatch only the approved SHA.** Observe both Worker builds and API upload before maintenance; then closure, drained leases, post-drain checkpoint, reviewed `0011` migration, both Worker switches, private smoke, and closed-state scheduled no-op evidence for both configured cron schedules before atomic reopen and public acceptance. Use bounded, tagged markers; do not improvise a manual bypass on failure.
- [ ] **Step 3: Verify and record.** Read back gate, full migration hash, zero leases, 100% Worker IDs/SHAs, checkpoint, named auth/RSVP/CSV/cron/query-plan checks, and `inboxDelivery: "waived"`. If any public check fails, verify reclosure and treat an unconfirmed reclosure as an incident. Preserve the checkpoint through acceptance.
- [ ] **Step 4: Commit evidence only after acceptance.** Record observed timestamps/IDs and sanitized results in `docs/PROGRESS.md`; a failed or partial cutover is recorded as such, never as production-ready.

### Task 6: Remove one-time code and test normal selective release

**Files:** Delete `packages/database/src/staging-bootstrap-gate.ts`, `packages/database/src/staging-bootstrap-cli.ts`, `packages/database/src/staging-bootstrap-migration-cli.ts`, their tests, `scripts/staging-bootstrap-recovery.mjs`, `scripts/staging-worker-baseline.mjs`, `scripts/staging-worker-baseline-cli.mjs`, their tests, and `.github/workflows/staging-worker-baseline.yml`; modify `docs/DEPLOYMENT.md`, `docs/PROGRESS.md` to retain the runbook/evidence and note retirement.

**Interface:** Normal `.github/workflows/release.yml` remains the only application release path and requires current `0011` status plus an accepted Worker pair. `STAGING_RELEASE_ENABLED` is still a separate decision, not an automatic consequence of Task 5; production remains disabled.

- [ ] **Step 1: Write/extend tests before removal.** In `scripts/release-execution.test.mjs` and `scripts/release-workflow.test.mjs`, assert an accepted two-version `0011` staging baseline permits a later web-only or API-only plan while an absent baseline still rejects; each app deploy still closes whole-site maintenance. Retain a regression test for the normal current-schema-only gate.
- [ ] **Step 2: Run the tests.** New focused cases should fail if normal release cannot consume the accepted baseline; diagnose and fix that path before deleting bootstrap files.
- [ ] **Step 3: Remove the one-time entry points and update the runbook.** Do not remove canonical migration `0011`, the normal release gate, or the retained recovery record. Remove references from package scripts if any were added.
- [ ] **Step 4: Verify and commit.** Run `npm run ci`, disposable PostgreSQL/jobs integration, and workflow static tests; then commit the retirement. A later owner decision may enable staging selective release and run one real selective rehearsal. Production bootstrap remains a separate project.

## Handoff

The owner previously chose **Native execution, one task at a time**. Review this plan before Task 1. The plan approval does not authorize Task 5's live staging cutover; that requires a fresh go/no-go after Tasks 1–4 and the pre-cutover packet.
