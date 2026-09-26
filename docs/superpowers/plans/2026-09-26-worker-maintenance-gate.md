# Worker Maintenance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and accept a fail-closed maintenance gate and coordinated breaking-cutover drill on the existing Worker staging installation, without enabling production deployment.

**Architecture:** PostgreSQL orders business-work admission and gate closure with a singleton control row and short-lived leases. API fetch, scheduled work, and the Bun alternative share the gate repository; the web Worker checks a private API status route before serving users. A separate direct-PostgreSQL operator tool closes, drains, and reopens only the expected SHA after recorded checks.

**Tech Stack:** TypeScript, Elysia 2.0.0-beta.16, Next.js 16.3.5, vinext 1.0.0-beta.10, Drizzle ORM 0.45.3, pg 8.23.0, Neon PostgreSQL, Cloudflare Workers/Hyperdrive, Vitest 5.0.1.

**Spec:** `docs/superpowers/specs/2026-09-26-worker-maintenance-cutover-design.md`

## Global Constraints

- Read `PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/OPEN_QUESTIONS.md`, `docs/DATABASE_GUIDELINES.md`, and `docs/DEPLOYMENT.md` before code changes.
- The first production installation selects Worker; Bun/VPS remains an alternative for other installations, never simultaneous with Worker on one database.
- Keep Elysia 2, one canonical schema, no old/new compatibility layer, and no production provisioning or promotion in this plan.
- Use generated `workers.dev` origins; do not assume a custom domain or put credentials in Git/chat.
- Keep identifiers, comments, migrations, and technical docs in English; do not assume a Thai-only user or time zone.
- Keep gate queries bounded and parameterized, review generated SQL and indexes, and avoid new N+1 or unbounded application reads.
- All newly admitted user-facing routes, including auth and guest RSVP, show maintenance while closed; liveness and protected operator readiness remain available.
- Admission/closure must be atomic; no long database transaction across HTTP streaming or email delivery; never auto-expire or auto-clear a lease.
- Direct API ingress without the proxy credential remains 403 without a PostgreSQL round trip; missing/unreadable gate state fails closed.
- Worker Cron Trigger configuration changes are not an immediate stop; scheduled handlers and the Bun job loop must check the gate before work.
- For a breaking change, deploy each new Worker version to 100% from the same SHA; never split traffic with an ungated or old-contract version.
- Apply migration and recovery only through a direct, non-pooled credential outside Workers; use a disposable branch for destructive integration tests and restore rehearsal.
- Do not enable an independent Cloudflare Git deploy or production job. The staging drill must repeat auth/email, RSVP, CSV, cron/retry, and SQL/query-plan acceptance on the exact tested SHA.

## Review Focus

- Closure racing a new HTTP or cron admission: Task 1's concurrency test proves no lease starts after closure commits.
- A canceled or failed streaming CSV response: Task 2's tests prove lease release occurs once after response completion/cancel, never before.
- Missing gate row or status fetch failure: Tasks 1 and 4 prove API/web fail closed without serving cached user content.
- A forged probe header or non-GET probe: Task 4 proves no mutation, user session, or proxy secret bypass.
- A stranded lease after crash/cleanup failure: Tasks 1 and 5 prove no age-based clearing or automatic reopening.

---

## File map

| Unit                    | Files and responsibility                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database contract       | `packages/database/src/schema.ts`, generated `packages/database/drizzle/0009_release_control.sql` and meta snapshot: `ops` control/lease tables and seed row.                                                          |
| Gate data access        | New `packages/database/src/release-gate-repository.ts`: atomic admission, release, read mode; direct-credential controller transitions. `packages/database/src/client.ts` and `index.ts` expose the application store. |
| API admission           | New `apps/api/src/release-admission.ts`: ingress-first admission and response-lifetime lease. `apps/api/src/worker.ts`, `server.ts`, `api-handler.ts`, `app.ts` wire Worker/Bun and private status.                    |
| Background work         | `apps/api/src/worker-jobs.ts`, `apps/api/src/worker.ts`, `apps/jobs/src/processor.ts`, `apps/jobs/src/index.ts`: one lease per bounded scheduled/loop batch.                                                           |
| Web gate                | New `apps/web/lib/release-state.ts`, `apps/web/lib/maintenance-response.ts`, `apps/web/proxy.ts`: private state read, self-contained page/API 503, restricted presentation probe.                                      |
| Operator and acceptance | New `packages/database/src/release-gate-cli.ts`, `docs/DEPLOYMENT.md`, `docs/PROGRESS.md`, `docs/QUERY_REVIEW.md`: direct operator control, staging runbook and evidence.                                              |

### Task 1: Atomic PostgreSQL gate and migration

**Files:** Modify `packages/database/src/schema.ts`, `client.ts`, `index.ts`, `vitest.postgres.config.ts`, `schema.test.ts`; create `release-gate-repository.ts`, `release-gate-postgres.integration.ts`, generated `drizzle/0009_release_control.sql` and snapshot/journal entries.

**Interfaces:** Produce `ReleaseMode = "open" | "maintenance"`, `GateKind = "http" | "email" | "cleanup"`, `ReleaseGateStore` with `readMode(): Promise<ReleaseMode>`, `admit(kind: GateKind): Promise<string | null>`, and `release(id: string): Promise<void>`. Produce `PostgresReleaseGateController` with `closeFor(sha: string): Promise<void>`, `activeCount(): Promise<number>`, `status(): Promise<{ mode: ReleaseMode; targetSha: string | null; activeCount: number; oldestLeases: { id: string; kind: GateKind; startedAt: string }[] }>`, and `openFor(sha: string): Promise<boolean>`. `status()` returns at most 100 leases in deterministic order. `PostgresRuntime` and `InvocationPostgresRuntime` expose `releaseGateStore`. A missing row or query error throws; callers fail closed.

- [ ] **Step 1: Write failing database tests.** Name tests `seeds one open control row`, `orders admission before closure`, `fails closed without control state`, and `refuses unsafe reopen`. Pin results with `expect(await store.admit("http")).toBeNull()` after closure, `expect(await controller.activeCount()).toBe(1)` before release, and `expect(await controller.openFor(otherSha)).toBe(false)`. In `schema.test.ts`, assert the exact `ops` table names, singleton/mode checks, UUID primary key, and no guest/token columns.
- [ ] **Step 2: Run red tests.** `TEST_DATABASE_URL=<disposable-url> TEST_DATABASE_CONFIRM=lovechapter_test npm run test:postgres --workspace @lovechapter/database` must fail on missing gate types/tables; the disposable URL must differ from `DATABASE_URL`.
- [ ] **Step 3: Add schema.** Define `ops.release_control` (`id=1`, mode, nullable 40-hex target SHA, changed timestamp) and `ops.release_leases` (UUID, kind, start timestamp) in `schema.ts`.
- [ ] **Step 4: Generate and inspect migration.** Run `npm run db:generate --workspace @lovechapter/database -- --name=release_control`, inspect SQL/snapshot, and add the seed insert to `0009_release_control.sql`; the migration must not alter existing business tables.
- [ ] **Step 5: Implement repository and controller.** `admit` takes `FOR SHARE` on the control row and inserts in one short transaction; `closeFor` takes the conflicting update lock and rejects another target; `openFor` requires matching SHA and zero leases. No lease-age bypass.
- [ ] **Step 6: Run green checks.** Rerun the database integration command and `npm run db:check --workspace @lovechapter/database`; confirm the admission/close test uses independent connections and inspect constraints/indexes.
- [ ] **Step 7: Commit.** Commit only the database slice after tests pass.

### Task 2: API ingress, streaming lease, and private state route

**Files:** Create `apps/api/src/release-admission.ts`, `release-admission.test.ts`; modify `apps/api/src/app.ts`, `api-handler.ts`, `worker.ts`, `server.ts`, `worker.test.ts`, `server.test.ts`, `app.test.ts`.

**Interfaces:** Consume `ReleaseGateStore`. Produce `withApiAdmission(request: Request, gate: ReleaseGateStore, ingress: { proxyCredential: string; fingerprintKey: Uint8Array }, handle: () => Promise<Response>): Promise<Response>`. Exempt only `/health/live`, protected `/health/ready`, and protected `GET /health/release-state` from admission; all other API methods acquire a lease. Add `ApiDependencies.releaseMode(): Promise<ReleaseMode>`; the private route returns exactly `{ mode: ReleaseMode }` with `no-store`. Closed business requests return `Retry-After: 60`. Protected readiness probes the database and gate singleton while maintenance remains closed; private smoke validates the release-specific API/business-schema pairing. Bun and Worker wrappers call the same admission function before Elysia; the Worker keeps its invocation client open through response finalization.

- [ ] **Step 1: Write failing tests.** Name tests `rejects direct ingress before admission`, `holds a streaming lease until cancellation`, `releases after handler failure`, and `serves protected release state`. Pin `expect(response.status).toBe(403)` plus `expect(gate.admit).not.toHaveBeenCalled()` for direct ingress; `expect(gate.release).not.toHaveBeenCalled()` before stream completion and `toHaveBeenCalledTimes(1)` afterward; closed/unreadable responses are 503 with `no-store`/`Retry-After`; readiness works while closed but returns 503 for a missing gate row.
- [ ] **Step 2: Run red tests.** `npx vitest run apps/api/src/release-admission.test.ts apps/api/src/worker.test.ts apps/api/src/server.test.ts apps/api/src/app.test.ts` must fail at the new expectations.
- [ ] **Step 3: Implement `withApiAdmission`.** Verify proxy ingress before PostgreSQL; wrap `Response.body` so `gate.release(id)` finishes on completion/cancel/error before the outer `withPostgresResponse` closes its client, and release on bodyless/throw paths. Return stable maintenance JSON without database details.
- [ ] **Step 4: Wire API handlers.** Call the shared function from Worker and Bun; add `releaseMode()` and private Elysia `GET /health/release-state`, keeping existing ingress/origin checks and liveness behavior.
- [ ] **Step 5: Run green tests.** Rerun the targeted Vitest command; direct `/health/ready` and release-state without the secret remain 403 and liveness opens no connection.
- [ ] **Step 6: Verify builds.** Run API typecheck, Worker dry-run, Bun build and smoke.
- [ ] **Step 7: Commit.** Commit only the API slice after checks pass.

### Task 3: Worker Cron and Bun job-loop admission

**Files:** Modify `apps/api/src/worker.ts`, `worker-jobs.ts`, `worker-jobs.test.ts`, `worker.test.ts`, `apps/jobs/src/processor.ts`, `processor.test.ts`, `index.ts`.

**Interfaces:** Consume `ReleaseGateStore.admit("email" | "cleanup")` and `release(id)`. Produce `runAdmittedBatch(gate: ReleaseGateStore, kind: "email" | "cleanup", work: () => Promise<void>): Promise<boolean>`; false means closed/unreadable and no work occurred. The Worker scheduled handler wraps one bounded batch; Bun `runJobLoop` accepts `releaseGate: ReleaseGateStore` and wraps each bounded cleanup/email pass rather than one lease for the whole loop.

- [ ] **Step 1: Write failing tests.** Name tests `does no scheduled work while closed`, `holds lease through provider send`, `releases after scheduled failure`, and `sleeps then resumes Bun loop`. Pin `expect(store.claimEmailJobs).not.toHaveBeenCalled()` and `expect(cleanup.cleanupExpiredGuestImports).not.toHaveBeenCalled()` while closed; `expect(gate.release).not.toHaveBeenCalled()` during a delayed send and `toHaveBeenCalledTimes(1)` after it. Assert minute/15-minute batches keep their existing caps.
- [ ] **Step 2: Run red tests.** `npx vitest run apps/api/src/worker-jobs.test.ts apps/api/src/worker.test.ts apps/jobs/src/processor.test.ts` must fail on the new expectations.
- [ ] **Step 3: Implement `runAdmittedBatch`.** Catch unreadable admission as a no-op with a token-safe event; propagate failed lease release rather than report successful cleanup.
- [ ] **Step 4: Wire Worker scheduled work.** Wrap the existing minute email batch and 15-minute combined cleanup batch without changing Cron Trigger configuration or caps.
- [ ] **Step 5: Wire Bun loop.** Admit separately around each bounded cleanup and email batch, sleep when closed, and keep provider/domain processing unchanged.
- [ ] **Step 6: Run green/build checks.** Rerun targeted tests and both API/Jobs typechecks and builds.
- [ ] **Step 7: Commit.** Commit only the job slice after checks pass.

### Task 4: Web maintenance page and restricted smoke presentation

**Files:** Create `apps/web/lib/release-state.ts`, `release-state.test.ts`, `maintenance-response.ts`, `maintenance-response.test.ts`, `apps/web/proxy.ts`, `proxy.test.ts`; modify `apps/web/lib/backend-proxy.ts` only if sharing its validated origin/secret parser is needed.

**Interfaces:** Consume protected API `GET /health/release-state` via `fetchReleaseMode(requestUrl: string, environment: { apiUpstreamOrigin: string; proxySharedSecret: string; fetch: typeof fetch }): Promise<ReleaseMode>`. Accept only JSON `{ mode: "open" | "maintenance" }`. `proxy.ts` exports `proxy(request: NextRequest): Promise<NextResponse | Response>` and a matcher excluding only maintenance-safe assets and health routes. Maintenance 503 uses `Retry-After: 60` and `no-store`. `RELEASE_PROBE_SECRET` is an independent canonical 32-byte base64url Worker secret; only a matching `x-lovechapter-release-probe` on GET/HEAD may bypass web presentation, never API admission.

- [ ] **Step 1: Write failing tests.** Name tests `covers all user page families`, `fails closed on state fetch error`, `rejects forged or mutating probes`, and `never forwards probe secret`. Pin `expect(response.status).toBe(503)` and `expect(response.headers.get("cache-control")).toBe("no-store")` for pages/API while closed; assert HTML has no external assets and API is JSON; assert open/liveness/static paths continue and POST stays closed with a valid probe. Check that the existing PWA service worker does not cache user pages or API responses.
- [ ] **Step 2: Run red tests.** `npx vitest run apps/web/lib/release-state.test.ts apps/web/lib/maintenance-response.test.ts apps/web/proxy.test.ts` must fail on the new expectations.
- [ ] **Step 3: Implement release-state fetch.** Call only the validated configured API origin with the existing proxy credential, reject unexpected response shapes, and do not cache the result.
- [ ] **Step 4: Implement maintenance response and `proxy.ts`.** Use pinned vinext's Next.js 16 proxy support; serve self-contained English HTML/JSON 503, and allow a GET/HEAD presentation probe only with the independent server-held secret. Never forward the probe header or use it to bypass API admission.
- [ ] **Step 5: Document secret.** Add `RELEASE_PROBE_SECRET` to the staging web Worker environment contract in `docs/DEPLOYMENT.md`.
- [ ] **Step 6: Run green/build checks.** Rerun targeted tests, web typecheck, vinext/Next builds and check, and staging Worker dry-run; probe the built Worker for static/dynamic route interception before deploy. Stop on a vinext gap.
- [ ] **Step 7: Commit.** Commit only the web slice after checks pass.

### Task 5: Direct operator control and fail-closed recovery runbook

**Files:** Create `packages/database/src/release-gate-cli.ts`, `release-gate-cli.test.ts`; modify `packages/database/package.json`, `docs/DEPLOYMENT.md`. Use the Task 1 controller, not a second copy of transition SQL.

**Interfaces:** CLI commands are `status`, `close --sha <40-hex>`, `drain --sha <40-hex>`, and `open --sha <40-hex> --evidence <path>`. It requires `RELEASE_DATABASE_URL` (direct/non-pooled) and `RELEASE_ENVIRONMENT=staging` for this phase; no production command is enabled. Evidence JSON contains `commitSha`, `apiWorkerVersion`, `webWorkerVersion`, `migrationChecked`, `privateSmokePassed`, and `acceptedAt`. `open` requires exact SHA, populated version IDs, true checks, and zero active leases; it does not itself assert email receipt or fabricate evidence.

- [ ] **Step 1: Write failing CLI/controller tests.** Name tests `rejects unsafe reopen evidence`, `leaves maintenance on interrupted drain`, and `redacts status`. Pin `expect(await controller.openFor(otherSha)).toBe(false)` and a nonzero CLI exit for invalid SHA, missing direct URL, wrong environment/evidence, false smoke, missing version IDs, or an active lease. Assert output contains mode/SHA/count but not database URL or secrets.
- [ ] **Step 2: Run red tests.** `npx vitest run packages/database/src/release-gate-cli.test.ts` and the Task 1 PostgreSQL integration test must fail at the new expectations.
- [ ] **Step 3: Implement CLI.** Use one direct `pg.Client` closed in `finally`; require staging environment and valid SHA/evidence for transitions. `drain` polls until zero leases or operator abort without changing gate state on timeout/interruption; expose no age-based clear command.
- [ ] **Step 4: Document runbook.** Record prebuild → recoverable point/restore rehearsal → close/drain → migrate → deploy both same SHA → private smoke → evidence → open, plus forward-fix/verified-restore behavior. Document app-role grants: `USAGE` on `ops`, `SELECT` on control, `INSERT`/`DELETE` on leases, and no control-row `UPDATE` for the Worker credential.
- [ ] **Step 5: Run green checks.** Rerun targeted tests, database typecheck and `db:check`; on a disposable branch prove wrong SHA and orphaned lease prevent reopening.
- [ ] **Step 6: Commit.** Commit only the operator slice after checks pass.

### Task 6: Exact-SHA Worker staging acceptance and handoff

**Files:** Modify `docs/DEPLOYMENT.md`, `docs/PROGRESS.md`, `docs/QUERY_REVIEW.md` with real evidence only; any newly found regression gets its own failing test and focused code commit before retesting.

**Interfaces:** Consume the committed artifacts and CLI from Tasks 1–5. Produce a recorded staging SHA, API/web Worker version IDs, migration and gate timestamps, category acceptance results, p95 gate overhead comparison, and a disposable-branch restore result. No production resource or workflow changes.

- [ ] **Step 1: Run local preflight.** Run `npm run ci` from the immutable candidate SHA; expected: every check passes before touching staging.
- [ ] **Step 2: Inspect staging targets.** Confirm staging Hyperdrive ID, isolated Neon/Resend credentials, direct migration role distinct from the app role, and current Worker version IDs; stop on a missing prerequisite.
- [ ] **Step 3: Dry-run both artifacts.** Build API/web from that SHA and dry-run both staging targets; expected: no production binding or secret is selected.
- [ ] **Step 4: Rehearse recovery.** Apply migration and perform Neon restore on a disposable branch, verifying retained data; never run destructive recovery analysis against active staging.
- [ ] **Step 5: Bootstrap active staging.** Apply only the nonbreaking gate migration with the direct credential, verify the seeded open row and app-role privileges, then deploy gate-aware API/web Workers from the same SHA.
- [ ] **Step 6: Probe built web routing.** Confirm static and dynamic user pages and `/api` actually pass through `proxy.ts`; stop on a vinext gap.
- [ ] **Step 7: Drill closure.** Confirm a recoverable point on active staging, then with synthetic streaming HTTP, queued email, and controlled scheduled work, close the gate and prove zero new admissions plus waiting for active leases; a stuck lease must leave maintenance active.
- [ ] **Step 8: Smoke and reopen.** While closed, verify private readiness, GET/HEAD rendering, business ingress rejection, and scheduled no-op; record actual evidence, reopen for the same SHA, and prove queued email resumes exactly once.
- [ ] **Step 9: Repeat user-flow acceptance.** On the same SHA, repeat auth/email with inbox receipt, public RSVP, CSV/idempotency/rejection, and real Worker email/cleanup cron plus the controlled disposable-database retry.
- [ ] **Step 10: Repeat SQL/performance acceptance.** Rerun PostgreSQL integration and representative safe SELECT plans; record generated SQL, gate round trips, index/constraint review, and p95 latency comparison on representative traffic.
- [ ] **Step 11: Final CI and handoff.** Run format, lint, typechecks, tests, both runtime builds, vinext/Next checks, Worker dry-runs, migration check, and remote CI on the accepted SHA; update progress/query evidence, request code review, and stop for the separate production plan. Do not merge or enable production deployment merely because the drill passed.

## Completion boundary

This plan ends with the staging gate accepted and documented. Production Neon/Hyperdrive/Worker/Resend provisioning, GitHub protected environments, and exact-SHA automatic promotion require a separate reviewed plan after the staging drill. The current production release block stays in force until then.
