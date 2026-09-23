# Planning Checklist Implementation Plan

**Goal:** Deliver an authenticated, wedding-scoped preparation checklist with deadlines and progress.

**Architecture:** Contracts and normalization feed a focused PostgreSQL repository via the existing domain service. The couple page mounts a wedding-keyed planning component above the guest workspace.

**Spec:** `docs/superpowers/specs/2026-09-23-planning-checklist-design.md`

**Stack:** Pinned TypeScript, Elysia 2, Drizzle/PostgreSQL, React and Vitest.

## Global constraints

- Do not seed prescribed tasks or categories; dates are real calendar days.
- Membership is checked by SQL for every read/write and task IDs are scoped to the wedding.
- List at most 50 tasks per page; overview at most eight dated open tasks.
- No new hosting or external service is required.

## Tasks

1. **Contracts and domain:** Add `PlanningTask`, `PlanningTaskInput`, `PlanningTaskPatch`, `PlanningOverview`, list filter, and page types. Start with failing normalization and service tests for trimmed strings, invalid dates, empty patches, authentication, and scoped CRUD. Add a dedicated `PlanningRepository` port and in-memory implementation for the API proof.
2. **Database:** Start with a schema test asserting composite ownership key, checks, and list/partial-deadline indexes. Add the table and generate a Drizzle migration. Start with SQL contract tests showing authorized membership joins and bounded deterministic queries; implement a focused repository. Add a disposable PostgreSQL test that creates two weddings, exercises pagination, counts and deadlines, and rejects a cross-wedding update.
3. **API and client:** Start with API tests for create/list/overview/update/delete, invalid bodies, and private 404 behavior; add Elysia routes with strict TypeBox bodies and query bounds. Start with client tests for encoded paths and same-origin requests; wire the production client and API server repository.
4. **UI:** Start with a component test for wedding switching, creating a task, editing due date, completion/reopen, deletion confirmation, and progress. Implement a separate planning workspace and mount it with `key={selected.id}` in the selected wedding panel. Render deadlines with the wedding locale/time zone, and distinguish incomplete from completed tasks.
5. **Release:** Update progress and open questions; run formatting, lint, typecheck, source tests, migration checks, full CI in GitHub Actions and PostgreSQL integration. Review diffs and push to PR #2; resolve CI failures before reporting completion.

## Review focus

- An invalid date such as February 30 must fail before reaching PostgreSQL.
- An empty patch must fail rather than silently refresh `updated_at`.
- A task ID from another wedding must not reveal that task or mutate it.
- A large task list must page without repeating or omitting equal-timestamp rows.
- A request that completes while the user changes wedding must not update the new wedding's UI.
