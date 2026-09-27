# Modern Wedding Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long authenticated page with a compact bilingual rose wedding workspace, accurate RSVP overview, and editable wedding settings.

**Architecture:** Keep the existing `/` route and one selected wedding in a focused shell; mount only the active section. Add shared service/repository methods for an authorized RSVP aggregate and role-guarded wedding settings update so Bun and Worker use the same behavior. Reuse existing planning, guest, budget, schedule, and seating editors rather than copying their business logic.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, Elysia 2, Drizzle/PostgreSQL, Vitest; Cloudflare frontend/API Workers and Bun/VPS backend parity.

**Spec:** `docs/superpowers/specs/2026-09-27-modern-wedding-workspace-design.md`

## Global Constraints

- Ship every new user-facing string in English and Thai; preserve independent UI language and wedding locale.
- One current contract/schema; no compatibility-only paths or schema migration for this feature.
- Server-authorize every wedding read/write; only Owner, Couple, and Planner may edit wedding settings.
- Count active guest parties, not people; archived guests never contribute to RSVP totals.
- Build/test both Bun/VPS and Worker backend paths; deploy only the selected Worker installation.
- One active section loads its own bounded data; never prefetch all sections on initial load.
- Production release uses protected `main`, CI, whole-site maintenance, paired Worker cutover, and public check under ADR-029.

## Review Focus

1. A wedding with no guests must show zero parties and no invented response percentage (Task 1 and Task 5 tests).
2. An archived guest with a prior RSVP must not appear in any response count (Task 2 integration test).
3. A Collaborator or a member of another wedding must not edit settings or infer private values (Task 3 API/integration tests).
4. A slow response from the prior wedding must not overwrite the newly selected wedding's UI (Task 4 test).
5. A dirty edit form must not disappear silently when changing section or wedding (Task 6 test).

---

### Task 1: Shared RSVP summary contract and service

**Files:** Modify `packages/contracts/src/index.ts`, `packages/domain/src/ports.ts`, `packages/domain/src/service.ts`, `packages/domain/src/testing/in-memory-repository.ts`; test `packages/domain/src/testing/in-memory-repository.test.ts` and `apps/api/src/app.test.ts`; modify `apps/api/src/app.ts`.

**Interfaces:** Produces `RsvpSummary = { totalActive: number; attending: number; declined: number; replied: number; awaiting: number }`, `LoveChapterRepository.getRsvpSummary(userId: string, weddingId: string): Promise<RsvpSummary>`, `LoveChapterService.getRsvpSummary(weddingId: string): Promise<RsvpSummary>`, and authenticated `GET /v1/weddings/:weddingId/rsvp-summary`.

- [ ] **Step 1:** Add failing tests for zero active parties, awaiting/attending/declined counts, replacing an RSVP status, archived responders, and cross-wedding denial. Add an API route test asserting the exact response fields and unauthenticated denial.
- [ ] **Step 2:** Run `npx vitest run packages/domain/src/testing/in-memory-repository.test.ts apps/api/src/app.test.ts`; expect new tests to fail because the method/route is absent.
- [ ] **Step 3:** Add the contract, repository/service methods, in-memory aggregation, and Elysia route. `replied = attending + declined`, `awaiting = totalActive - replied`; require the onboarded user and wedding membership.
- [ ] **Step 4:** Run the same focused Vitest command; expect all tests to pass.
- [ ] **Step 5:** Commit the shared behavior and tests.

### Task 2: One authorized PostgreSQL RSVP aggregate

**Files:** Modify `packages/database/src/queries.ts`, `packages/database/src/repository.ts`, `packages/database/vitest.postgres.config.ts`; test `packages/database/src/repository.test.ts`; create `packages/database/src/workspace-postgres.integration.ts`; update `docs/QUERY_REVIEW.md` with generated SQL/index/plan evidence.

**Interfaces:** Consumes Task 1 `getRsvpSummary`; produces `buildRsvpSummaryQuery(input: { userId: string; weddingId: string }): SQL` and the Postgres repository implementation.

- [ ] **Step 1:** Add a failing SQL contract test for a single parameterized membership-scoped SELECT, active-guest filtering, a join to the one-RSVP-per-guest relation, and bounded integer aggregates. Add a disposable-Postgres integration test for empty, awaiting, replied, archived, and unrelated-wedding cases.
- [ ] **Step 2:** Run `npx vitest run packages/database/src/repository.test.ts`; expect the new query test to fail. Run `npm run test:postgres --workspace @lovechapter/database` only with the confirmed disposable `TEST_DATABASE_URL`/`TEST_DATABASE_CONFIRM` fixture; expect the new case to fail.
- [ ] **Step 3:** Implement the SQL builder and repository mapping in one round trip; return NotFound for no membership without exposing another wedding's counts. Use existing schema indexes unless representative `EXPLAIN (ANALYZE, BUFFERS)` on disposable data justifies a new one; do not run ANALYZE on production.
- [ ] **Step 4:** Rerun focused tests and `npm run test:postgres --workspace @lovechapter/database` with the confirmed disposable fixture; inspect generated SQL and record the query plan in `docs/QUERY_REVIEW.md`. Expect passing tests and no N+1/unbounded row transfer.
- [ ] **Step 5:** Commit query, repository, tests, and review evidence.

### Task 3: Authorized wedding settings update

**Files:** Modify `packages/contracts/src/index.ts`, `packages/domain/src/ports.ts`, `packages/domain/src/service.ts`, `packages/domain/src/testing/in-memory-repository.ts`, `packages/database/src/queries.ts`, `packages/database/src/repository.ts`, `apps/api/src/app.ts`; test `packages/domain/src/testing/in-memory-repository.test.ts`, `packages/database/src/repository.test.ts`, `packages/database/src/workspace-postgres.integration.ts`, and `apps/api/src/app.test.ts`.

**Interfaces:** Produces `UpdateWeddingInput = { name: string; weddingDate: string | null; timeZone: string; locale: string }`, `LoveChapterRepository.updateWedding(userId: string, weddingId: string, input: UpdateWeddingInput): Promise<WeddingSummary>`, `LoveChapterService.updateWedding(weddingId: string, input: UpdateWeddingInput): Promise<WeddingSummary>`, and `PATCH /v1/weddings/:weddingId`.

- [ ] **Step 1:** Add failing tests for name/date/time-zone/locale update, explicit date clearing, invalid calendar date or locale/zone, no membership, Collaborator denial, and Owner/Couple/Planner allowance. Assert a response never reflects a client-supplied role.
- [ ] **Step 2:** Run `npx vitest run packages/domain/src/testing/in-memory-repository.test.ts packages/database/src/repository.test.ts apps/api/src/app.test.ts`; expect missing method/route failures.
- [ ] **Step 3:** Reuse creation validation while preserving explicit nullable date; use one parameterized UPDATE guarded by wedding membership role in SQL, returning the updated summary and actual role. In-memory behavior must match. Do not add columns or migrate.
- [ ] **Step 4:** Rerun the focused Vitest command and `npm run test:postgres --workspace @lovechapter/database` with the confirmed disposable fixture; expect pass. Inspect generated UPDATE SQL and confirm tenant/role predicates.
- [ ] **Step 5:** Commit settings contract, authorization, and tests.

### Task 4: Compact wedding shell and navigation

**Files:** Modify `apps/web/components/couple-workspace.tsx`, `apps/web/components/couple-workspace.test.tsx`, `apps/web/app/globals.css`, `apps/web/lib/ui-copy.ts`; create focused `apps/web/components/workspace/workspace-navigation.tsx` and tests if extraction reduces the existing component; retain existing UI primitives.

**Interfaces:** Produces `WorkspaceSection = "overview" | "planning" | "guests" | "budget" | "schedule" | "seating"` and a selected-wedding shell. Consumes existing `listWeddings/createWedding`; later tasks mount section content inside it.

- [ ] **Step 1:** Add failing UI tests for no wedding creation state, one-wedding auto-open, multi-wedding picker/load-more, one selected section at a time, Thai/English labels, keyboard active state, and a stale list/switch response not replacing the selected wedding.
- [ ] **Step 2:** Run `npx vitest run apps/web/components/couple-workspace.test.tsx`; expect new assertions to fail against the long stacked page.
- [ ] **Step 3:** Build compact header/rose tokens, desktop sidebar and scrollable mobile section nav; hide creation behind a compact action except the zero-wedding state. Preserve pagination, clear wedding-scoped state immediately on switch, and remove the obsolete fallback guest editor only after the current editor is mounted in Task 6. Keep overview as an initially empty slot until Task 5.
- [ ] **Step 4:** Rerun focused UI tests; expect pass at 320px semantics and no whole-page horizontal overflow in testable layout checks.
- [ ] **Step 5:** Commit the shell and UI tests.

### Task 5: Bilingual overview and accurate data lifecycle

**Files:** Modify `apps/web/lib/api-client.ts`, `apps/web/lib/api-client.test.ts`, `apps/web/components/couple-workspace.tsx`, `apps/web/components/couple-workspace.test.tsx`, `apps/web/lib/ui-copy.ts`; create `apps/web/components/workspace/overview-panel.tsx` and its tests.

**Interfaces:** Consumes Tasks 1–2 `RsvpSummary` route; produces `createLoveChapterApi().getRsvpSummary(weddingId: string): Promise<RsvpSummary>` and an overview using the existing `getPlanningOverview`.

- [ ] **Step 1:** Add failing client and UI tests for exact same-origin `/api/v1/.../rsvp-summary` request, no fabricated totals, zero active parties, loading/retry error, wedding-switch invalidation, and refresh after visiting Guests/Planning again.
- [ ] **Step 2:** Run focused API-client and overview tests; expect missing method/overview assertions to fail.
- [ ] **Step 3:** Implement overview cards with wedding-local date, planning progress, guest-party RSVP counts, and section links. Fetch only two independent bounded summaries when Overview mounts; discard stale promises by wedding ID/generation. Invalidate by remount/revisit after guest and planning mutations, with an honest loading state.
- [ ] **Step 4:** Rerun focused tests; expect pass in both languages and no percentage when `totalActive=0`.
- [ ] **Step 5:** Commit the overview and tests.

### Task 6: Reuse all editors, guard drafts, and edit wedding settings

**Files:** Modify `apps/web/components/couple-workspace.tsx`, `apps/web/components/operations/operations-workspace.tsx`, `apps/web/components/guest-management/guest-workspace.tsx`, `apps/web/lib/api-client.ts`, `apps/web/lib/ui-copy.ts`; create `apps/web/components/workspace/wedding-settings-form.tsx` and tests; extend existing workspace/editor tests.

**Interfaces:** Consumes Task 3 `UpdateWeddingInput`/route and Task 4 `WorkspaceSection`; produces `createLoveChapterApi().updateWedding(weddingId: string, input: UpdateWeddingInput): Promise<WeddingSummary>` and section-scoped editor mounting.

- [ ] **Step 1:** Add failing UI tests for each section showing only its editor, Guest/CSV/envelope controls remaining reachable, settings save/date clear/error and Collaborator read-only mode, plus a dirty-form confirmation on section/wedding switch (cancel preserves draft). Add a client test for PATCH payload.
- [ ] **Step 2:** Run focused UI/client tests; expect missing settings/section/guard assertions to fail.
- [ ] **Step 3:** Expose operations panels by section without duplicate inner tabs, load Guests only when selected, keep existing guest-management/CSV/envelope capability, and centralize a form-dirty guard around section/wedding changes. Implement controlled settings inputs and update selected wedding/list after save; no UI language change from wedding locale.
- [ ] **Step 4:** Rerun focused tests including planning, guest-management, operations, and couple-workspace; expect pass. Confirm reduced-motion CSS and 320px navigation behavior.
- [ ] **Step 5:** Commit editor integration, settings UI, and tests.

### Task 7: Full verification, documentation, and production handoff

**Files:** Modify `docs/PROGRESS.md`; no unrelated product code unless a failing verification test identifies a defect.

**Interfaces:** Consumes Tasks 1–6 and delivers one releasable exact commit for the existing Worker installation.

- [ ] **Step 1:** Run `npm run format`, `npm run ci`, Bun API/jobs runtime smoke, API Worker Wrangler dry-run, and web vinext/Worker build. Run the disposable PostgreSQL integration suite with explicit disposable DB confirmation. Expect all checks to pass; fix failures via a reproducing test first.
- [ ] **Step 2:** Inspect generated SQL, indexes, query plan, locale/date behavior, responsive UI, no one-runtime-only backend change, and `git diff --check`; update `docs/PROGRESS.md` with actual evidence and any unverified live behavior.
- [ ] **Step 3:** Commit verification/documentation changes, obtain the final whole-branch code review, and fix Important/Critical findings with RED→GREEN tests and a green suite.
- [ ] **Step 4:** Fast-forward the tested branch to protected `main` and push as previously authorized. Check the exact-SHA GitHub release run and public web/API readiness; never claim live auth/RSVP/CSV/print passed without exercising them. If the cutover fails or maintenance stays on, report the incident and do not blindly reopen or redeploy old code.
