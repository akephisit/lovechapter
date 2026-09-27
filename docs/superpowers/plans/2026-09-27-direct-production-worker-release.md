# Direct Production Worker Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a protected `main` push build, cut over, and verify the first LoveChapter production Worker installation without a staging release, with migration-before-deploy and reload-on-return.

**Architecture:** Reuse the existing release gate, impact planner, Worker preparation, migration CLI, and deployment ledger. Remove staging acceptance from the production path, add one small Neon recovery-point adapter for breaking migrations, and expose the published release to a client-side tab-return check. First publication is a one-time closed-gate setup because no production Worker baseline exists yet; later pushes use the single automatic workflow.

**Tech Stack:** GitHub Actions, Node.js 24, Bun 1.4.2, Cloudflare Workers/Wrangler 4.135.0, Next.js 16.3.5/vinext 1.0.0-beta.10, Elysia 2.0.0-beta.16, Neon PostgreSQL/Drizzle, Vitest 5.0.1.

**Spec:** `docs/superpowers/specs/2026-09-27-direct-production-worker-release-design.md`

## Global Constraints

- Production runs only the Cloudflare API Worker backend; CI still verifies Bun/VPS parity.
- Owner-only fast-forward pushes to protected `main`; no PR, reviewer, or branch-hosted CI.
- Every application deploy closes the whole site after build; docs-only changes do not deploy.
- Migrations run after maintenance and drain, before Worker deployment; breaking changes deploy both Workers from the same SHA.
- Only a breaking migration creates a new Neon recovery point, after drain and before SQL; no staging/rehearsal requirement.
- Never expose a mismatched Worker/schema pair; post-closure failure leaves maintenance on.
- Keep origins configurable; do not assume ownership of `lovechapter.net`.
- The uncommitted staging recovery files in this worktree are earlier task work; inspect their diff and retire them with forward edits, never discard unrelated user changes.

## Review Focus

- A stale `main` SHA or failed CI must never reach production credentials or maintenance (Task 1 tests).
- An empty/partial production baseline must enter only the explicit first-publication path, never a normal selective release (Tasks 4 and 6 tests).
- A failed or ambiguous snapshot creation must leave the gate closed and skip SQL (Tasks 2 and 3 tests).
- Web-only, API-only, shared, and migration changes must select exactly the intended Worker pair (Task 3 tests).
- A returning tab during maintenance, an unavailable status endpoint, or unchanged release must not create a reload loop (Task 5 tests).

---

### Task 1: Direct-main source policy and release workflow

**Files:** Modify `.github/workflows/release.yml`, `scripts/release-cli.mjs`, `scripts/release-cli.test.mjs`, `scripts/release-workflow.test.mjs`, `AGENTS.md`, `PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`.

**Interfaces:** `runReleaseCli(["production"], env, {driverFactory})` accepts only the protected exact-SHA `main` push and `PRODUCTION_RELEASE_ENABLED=true`; the production job depends directly on `ci` and `postgres` and receives no staging output or secrets.

- [ ] **Step 1: Write failing tests.** Assert a protected production push is accepted without `RELEASE_STAGING_SHA`; a staging invocation, stale/unprotected ref, or disabled production flag is rejected. Assert workflow has no staging job, `production.needs` includes `ci` and `postgres`, and CI precedes production.
- [ ] **Step 2: Run `npx vitest run scripts/release-cli.test.mjs scripts/release-workflow.test.mjs`; confirm the new assertions fail.**
- [ ] **Step 3: Make the minimal workflow/CLI changes.** Keep the production flag off by default and exact-SHA checkout. Add a superseding ADR and update `AGENTS.md` plus locked product/release wording explicitly; do not delete live staging resources.
- [ ] **Step 4: Rerun the two tests and `npx prettier --check` on the changed files; require PASS.**
- [ ] **Step 5: Commit only Task 1 files.**

### Task 2: One recovery point for a breaking migration

**Files:** Create `scripts/neon-recovery-point.mjs`, `scripts/neon-recovery-point.test.mjs`; modify `scripts/release-orchestrator.mjs`, `scripts/release-orchestrator.test.mjs`.

**Interfaces:** `createNeonRecoveryPoint({projectId, branchId, sha, closedAt}, {fetcher})` returns `{snapshotId, sourceBranchId}` after the Neon snapshot creation operations complete and a bounded readback finds that exact snapshot. `runCutover()` calls `driver.createRecoveryPoint(sha, {closure})` only for `migration.kind === "breaking"`, after `drain` and before `migrate`.

- [ ] **Step 1: Write failing tests.** Verify no snapshot on code-only or nonbreaking migration; breaking order is `close → drain → snapshot → migrate → deploy`. Reject wrong source branch, missing snapshot ID, failed/asynchronous operation, failed readback, and ambiguous POST without retrying POST; assert no SQL runs and maintenance stays closed.
- [ ] **Step 2: Run `npx vitest run scripts/neon-recovery-point.test.mjs scripts/release-orchestrator.test.mjs`; confirm the new assertions fail.**
- [ ] **Step 3: Implement the small adapter against Neon's documented snapshot create, operation-status GET, and snapshot-list GET endpoints; do not log token or provider body.** The create name includes the candidate SHA; bounded readback verifies completed operation, ID, and source branch. Do not automatically retry an ambiguous POST. Keep the existing migration command sequential after it.
- [ ] **Step 4: Rerun the focused tests; require PASS.**
- [ ] **Step 5: Commit only Task 2 files.**

### Task 3: Production cutover contract without staging evidence

**Files:** Modify `scripts/release-orchestrator.mjs`, `scripts/release-orchestrator.test.mjs`, `scripts/release-evidence-builder.mjs`, `scripts/release-evidence-builder.test.mjs`, `scripts/release-driver.mjs`, `scripts/release-driver.test.mjs`, `packages/database/src/release-evidence.ts`, `packages/database/src/release-evidence.test.ts`, `packages/database/src/release-gate-cli.ts`, `packages/database/src/release-gate-cli.test.ts`, `packages/database/drizzle/reviews/0011_release_versions.md`; verify existing `scripts/release-impact.test.mjs` and `scripts/release-plan.test.mjs`.

**Interfaces:** `runCutover({environment:"production", sha, impact, migration}, driver)` uses the current gate baseline and the Task 2 recovery hook, then migration, selected deployment, private smoke, atomic reopen, and public check. `buildReleaseEvidence()` and `validateReleaseEvidence()` keep exact closure/SHA/version checks but no `stagingSha` field or staging acceptance prerequisite.

- [ ] **Step 1: Write failing tests.** A valid production release needs no staging acceptance; wrong closure, wrong Worker version, or incomplete private smoke still blocks reopen. Test web-only/API-only retain the untouched version; shared or SQL migration changes deploy both. Test a post-open failure recloses.
- [ ] **Step 2: Run `npx vitest run scripts/release-orchestrator.test.mjs scripts/release-evidence-builder.test.mjs scripts/release-driver.test.mjs scripts/release-impact.test.mjs scripts/release-plan.test.mjs packages/database/src/release-evidence.test.ts packages/database/src/release-gate-cli.test.ts`; confirm the new direct-production assertions fail and existing impact tests remain green.**
- [ ] **Step 3: Remove only the staging dependency from production evidence and preflight.** Preserve provider target verification, direct migration URL, lease drain, full-SHA checks, and fail-closed behavior. Update `packages/database/drizzle/reviews/0011_release_versions.md` to describe direct-production acceptance rather than a staging rehearsal.
- [ ] **Step 4: Rerun focused tests plus `npm run typecheck --workspace @lovechapter/database`; require PASS.**
- [ ] **Step 5: Commit only Task 3 files.**

### Task 4: Wire the normal production release end to end

**Files:** Modify `scripts/live-release.mjs`, `scripts/live-release.test.mjs`, `scripts/release-execution.mjs`, `scripts/release-execution.test.mjs`, `scripts/bootstrap-preflight.mjs`, `scripts/bootstrap-preflight.test.mjs`, `.github/workflows/release.yml`, `scripts/github-release-client.mjs`, `scripts/github-release-client.test.mjs`, `scripts/deployment-ledger.mjs`, `scripts/deployment-ledger.test.mjs`; retire unused staging-only coordinator imports and files only after their replacement passes.

**Interfaces:** `runLiveRelease({environment:"production", sha}, env, adapters)` wires `gate`, `workerRunner`, `githubRead`, `githubDeployment`, `ledger`, `migration`, and Task 2 recovery into `executeRelease()`. `ledger.readProductionBaseline(gateStatus)` must agree with the latest successful GitHub deployment; no previous baseline means normal release stops and Task 6 is required.

- [ ] **Step 1: Write failing live-coordinator tests.** Mock the complete production path, stale main, docs-only skip, missing/partial baseline, missing production secret, and failed target metadata. Require no staging fixtures or accepted SHA. Test GitHub deployment read/write adapter without printing credentials.
- [ ] **Step 2: Run `npx vitest run scripts/live-release.test.mjs scripts/release-execution.test.mjs scripts/deployment-ledger.test.mjs scripts/github-release-client.test.mjs`; confirm the new assertions fail.**
- [ ] **Step 3: Wire production-only adapters and the workflow.** Use the existing `release:gate` target guard, migration CLI, Worker runner, and accepted deployment ledger. Keep release jobs serial, flags disabled until first publication, and production secrets scoped to the production environment. Remove staging-only release wiring and tests that no longer describe a supported path; leave live staging resources untouched.
- [ ] **Step 4: Rerun focused tests and `npx vitest run scripts/release-workflow.test.mjs`; require PASS.**
- [ ] **Step 5: Commit only Task 4 files.**

### Task 5: Reload a returned browser tab after a release

**Files:** Modify `packages/database/src/release-gate-repository.ts`, `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/api-handler.ts`, `apps/api/src/worker.ts`, `apps/api/src/worker.test.ts`, `apps/api/src/bun-runtime-smoke.ts`, `apps/api/src/local-auth-flow.test.ts`, `apps/web/lib/release-state.ts`, `apps/web/lib/release-state.test.ts`, `apps/web/lib/maintenance-response.ts`, `apps/web/proxy.ts`, `apps/web/proxy.test.ts`, `apps/web/app/layout.tsx`; create `packages/database/src/release-gate-repository.test.ts`, `apps/web/app/release-status/route.ts`, `apps/web/app/release-status/route.test.ts`, `apps/web/components/release-refresh.tsx`, `apps/web/components/release-refresh.test.tsx`.

**Interfaces:** `PostgresReleaseGateStore.readPublicState()` returns `{mode, publishedSha: string | null}`; the API dependency `releaseStatus()` provides it on both Worker and Bun paths. The authenticated-proxy-only `/health/release-state` returns that shape with `cache-control: no-store`; `publishedSha` is null while closed, never an unaccepted maintenance target. The web's same-origin `GET /release-status` exposes only those two fields. `ReleaseRefresh` captures the version loaded by the tab, checks on `visibilitychange`/`pageshow`, waits while maintenance is active, and calls `location.reload()` once when an open published SHA differs.

- [ ] **Step 1: Write failing repository/API/web tests.** Cover open and maintenance state (`publishedSha: null` while closed), no cache, no direct API ingress bypass, hidden-to-visible update, unchanged SHA, status error, maintenance-then-open, an unknown initial version, and one reload maximum per new SHA.
- [ ] **Step 2: Run `npx vitest run packages/database/src/release-gate-repository.test.ts apps/api/src/app.test.ts apps/web/lib/release-state.test.ts apps/web/app/release-status/route.test.ts apps/web/components/release-refresh.test.tsx`; confirm new assertions fail.**
- [ ] **Step 3: Add the smallest read-only status and client component.** Do not add a service-worker fetch cache; preserve current no-store behavior. Mount the component once in root layout and make the maintenance page indicate that unsaved browser-only form input can be lost on release reload.
- [ ] **Step 4: Rerun focused tests, web typecheck, Next/vinext builds; require PASS.**
- [ ] **Step 5: Commit only Task 5 files.**

### Task 6: First publication, cleanup, and full verification

**Files:** Modify `docs/DEPLOYMENT.md`, `docs/PROGRESS.md`, `docs/OPEN_QUESTIONS.md`; delete or repurpose owned, unused `packages/database/src/staging-bootstrap-*` and `scripts/staging-bootstrap-recovery.*` only after confirming no release imports remain. Add a focused production first-publication runbook under `docs/DEPLOYMENT.md` rather than another permanent coordinator.

**Interfaces:** The one-time runbook inspects the actual Neon `production` ledger/data, provisions production Hyperdrive and secrets, builds both Workers at one SHA, applies pending schema while no public production Worker serves traffic, closes the gate before first public deployment, deploys both, privately smokes, opens with both actual version IDs, and creates the initial successful GitHub deployment record. Subsequent protected-main pushes use Tasks 1–4 automatically. It never infers production readiness from the existing staging installation.

- [ ] **Step 1: Add a disposable PostgreSQL bootstrap test from an empty/`0010` ledger to current schema and an all-null version baseline; test the first two-Worker reopen and normal second release.** Do not run destructive integration tests on the live Neon branch.
- [ ] **Step 2: Run `npm run test:postgres --workspace @lovechapter/database` against a confirmed disposable local PostgreSQL database; require PASS.**
- [ ] **Step 3: Write and review the exact one-time commands, target names, secret names, stop conditions, and status checks.** Read production Neon/Cloudflare/GitHub metadata before any live operation; verify root-branch snapshot eligibility and retained data. Keep release flags off until initial publication and smoke pass.
- [ ] **Step 4: Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run ci`, Worker dry-runs, Bun API/job smoke, and disposable PostgreSQL integration; record actual results.** Run a read-only production preflight. Live first publication follows only when those checks pass and the actual production targets are confirmed; report any missing credentials/resources to the owner without sharing secret values.
- [ ] **Step 5: Commit documentation and cleanup; only then fast-forward/push the verified candidate to `main` without force.** Verify hosted CI and, once the one-time production installation is open, one normal selective release. Do not claim production complete until public page/API readiness and scheduled-job observations are recorded; auth, RSVP, CSV, retry, and query-plan checks must pass in CI/disposable PostgreSQL, while real inbox receipt remains explicitly waived.
