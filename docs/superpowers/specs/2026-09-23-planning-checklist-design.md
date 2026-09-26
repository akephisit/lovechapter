# Wedding Planning Checklist and Deadlines

**Date:** 2026-09-23

**Scope:** First usable planning workspace for authenticated wedding members.

## Intent and boundaries

Couples and invited planners need to keep track of their own wedding preparation without a prescribed national ceremony or hardcoded task list. Each member of a wedding can create, edit, complete, reopen, and remove tasks. Tasks may have an optional due date, category, and private note. Progress and the nearest unfinished deadlines are visible for the selected wedding. The due-date list is a preparation timeline; a wedding-day run sheet with time-of-day slots is a separate later feature. Budget, vendor contracts, automated reminders, and task assignment are also separate modules.

## Data and behavior

- `planning_tasks` has a composite `(wedding_id, id)` primary key, title (1–180 Unicode characters), optional category (up to 80), optional note (up to 2,000), optional date-only `due_date`, nullable `completed_at`, and timestamps. Wedding deletion cascades to its tasks.
- Dates are strict real `YYYY-MM-DD` calendar dates; storage never shifts them across time zones. The overview uses the wedding's IANA time zone for overdue display.
- Reads and mutations authorize wedding membership in SQL. Unknown weddings, tasks from another wedding, and nonmembers return the same 404. IDs come from the server. No default categories or tasks are seeded.
- A task list uses stable `(created_at DESC, id DESC)` keyset pagination, maximum 50 items per call, optionally filtered to open or completed tasks. A separate overview returns full-wedding total/completed counts and at most eight unfinished tasks with due dates, ordered by `(due_date ASC, id ASC)`.
- A task update sends only changed fields. Completion toggles `completed_at` independently and repeated toggles keep the existing completion time. Deleting requires a UI confirmation. No client-side cache persists tasks.

## Architecture

Contracts define task inputs, pages, and overview. Domain normalization handles Unicode length, blank trimming, strict date validation, and empty-patch rejection. A focused planning repository uses parameterized, tenant-scoped SQL with an index for task pages and a partial index for unfinished dated tasks. The existing API service and same-origin web client expose the feature. A separate component keyed by wedding ID owns its loading, filter, and mutation state; switching weddings cannot render a prior wedding's tasks.

## Verification

Test normalization, paging, cross-wedding and nonmember access, status transitions, bounded overview, API validation, client paths, and the couple UI. Run schema/migration checks and the disposable PostgreSQL CI integration suite. Do not claim a live deployment or reminder delivery.
