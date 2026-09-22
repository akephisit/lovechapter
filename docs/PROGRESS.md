# LoveChapter — Progress

## Current phase

The approved Bun/VPS backend and first-party verified-email/password
authentication decisions are codified in the authoritative project documents.
The product-code migration has not started.

The checked-in MVP still contains the previous provider-backed authentication
and API Worker implementation until later tasks in the approved plan replace
and remove them. That transitional code is not the production target and has
not been deployed.

## Implemented in the current codebase

- Product name and global product vision
- Couple / Planner / Guest model
- npm-workspace monorepo
- Next.js 16 App Router Couple workspace and account-free guest RSVP route
- PWA manifest and conservative service-worker registration with no data caching
- Elysia 2 API routes, request validation, configured CORS, and stable errors
- Fail-closed server identity boundary plus environment-only development identity
- Existing provider-backed account flow pending approved replacement
- First-login Unicode profile onboarding and local profile ownership
- Wedding, membership, guest, invitation, and RSVP application flow
- Six-table Drizzle schema and generated PostgreSQL migration
- Tenant-scoped, parameterized, explicitly projected, bounded repository queries
- Indexed keyset pagination controls for wedding and guest collections
- SHA-256-only invitation-token storage and token-scoped public access
- Retryable transient invitation loading with private invalid/expired states
- Authenticated user visibility plus guest-list RSVP refresh and invitation copy
- Invitation-token-safe telemetry defaults
- Automated domain, repository, API, and UI coverage
- Current query/index review

## Approved and documented, not yet implemented

- Frontend Worker with a same-origin server-only API proxy
- Elysia 2 API on pinned Bun 1.4.2 as an always-on VPS process
- Separate bounded Bun background-job process
- Direct TLS Neon/PostgreSQL access through bounded API/job `pg.Pool` instances
- First-party verified-email/password accounts
- Database-backed secure cookie sessions
- Password reset with atomic all-session revocation
- PostgreSQL-backed bounded auth rate limits
- Durable auth email outbox with leases, retries, and bounded cleanup
- Resend behind a replaceable email adapter
- VPS systemd services, TLS reverse proxy, firewall, rollback, and backup assets
- Production scrypt benchmark and VPS staging smoke tests

No product-code work from Task 2 or later has been started in this documentation
milestone.

## Other product work not implemented

- Public wedding page
- Notification delivery beyond the approved auth-email direction
- Budget
- Vendors
- Seating
- Payments
- Planner Pro
- Realtime
- AI

## Validation status

Baseline verification at commit `6426a8d` on 2026-09-22:

- `npm test` — 21 test files and 139 tests passed.

Task 1 documentation verification on 2026-09-22:

- the active-document contradiction audit returned no matches;
- the ADR supersession audit found ADR-016, ADR-017, and ADR-018;
- `npx prettier --check AGENTS.md CODEX_START_PROMPT.md PROJECT_CONTEXT.md README.md docs`
  passed;
- `git diff --check` passed.

The earlier MVP validation recorded at that commit also included formatting,
lint, type-checking, database snapshot checking, API/web dry-run builds, native
Next build, and vinext compatibility checks. Those results describe the
pre-migration tree; they do not validate the approved Bun/VPS or first-party
authentication target.

No VPS, custom domain, Neon production environment, Resend production sender,
or deployed URL has been provisioned or claimed. Live migrations, representative
query plans, email delivery, same-origin proxying, Bun process lifecycle,
graceful restart, job recovery, and pool-exhaustion tests have not run.

The next plan milestone after this documentation-only task is Task 2: replace
the API Worker bootstrap with the bounded Bun runtime. It is outside the current
Task 1 scope.

Update this document after each significant Codex session.
