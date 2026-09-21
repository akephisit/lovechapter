# AGENTS.md — LoveChapter

## Required reading

Before meaningful work, read:

1. `PROJECT_CONTEXT.md`
2. `docs/DECISIONS.md`
3. `docs/PROGRESS.md`
4. `docs/OPEN_QUESTIONS.md`
5. `docs/DATABASE_GUIDELINES.md`
6. `docs/DEPLOYMENT.md`

`PROJECT_CONTEXT.md` is the product source of truth.

Do not silently override locked decisions.

---

## Communication and international readiness

Communicate with the project owner in Thai by default unless they request
another language.

Keep source-code identifiers, API and database names, migrations, comments,
and technical documentation in English so the project remains accessible to an
international engineering team.

LoveChapter is a global product. When designing or implementing features:

- do not assume every user is Thai, lives in Thailand, or uses Thai language;
- support Unicode names and user-provided content;
- preserve explicit locale and IANA time-zone data where they affect behavior;
- format dates, times, numbers, and currencies with locale-aware APIs rather
  than fixed country-specific formats;
- avoid hardcoding one country's address, phone-number, currency, payment,
  tax, legal, or notification conventions into shared domain logic;
- keep user-facing copy and UI structure ready for future localization,
  including text expansion and both left-to-right and right-to-left languages;
- use English as the current fallback product language until supported locales
  and translation ownership are explicitly decided;
- do not build a full internationalization system prematurely, but do not make
  changes that would unnecessarily block or complicate one later.

Record unresolved country- or locale-specific product decisions in
`docs/OPEN_QUESTIONS.md` instead of silently treating one market's behavior as
global.

---

## Product name and domain

Product name: **LoveChapter**

No custom domain is registered yet.

`lovechapter.tech` is only a candidate.

Until registration is confirmed:

- use Cloudflare `*.workers.dev` deployment URLs;
- keep origins configurable;
- never hardcode `lovechapter.tech`;
- do not create redirects/cookies/CORS rules that assume ownership of that domain.

---

## Locked stack

Frontend:

- Next.js
- React
- TypeScript
- App Router
- Tailwind CSS
- shadcn/ui
- PWA-capable
- Cloudflare Workers
- use the current Cloudflare-recommended vinext path when compatible

Backend:

- Elysia 2
- TypeScript
- Cloudflare Workers runtime

Database:

- Neon PostgreSQL
- Cloudflare Hyperdrive
- Drizzle ORM
- prefer `pg` / node-postgres with Hyperdrive when compatible

Supporting Cloudflare services only when needed:

- R2
- Queues
- Workflows/Cron
- Durable Objects
- KV

Bun:

- allowed for package management/scripts/local tooling;
- not the production HTTP runtime.

Do not use Bun-only server/runtime APIs in domain logic.

Do not replace Elysia 2 with another HTTP framework without explicit approval.

Elysia 2 and its Cloudflare adapter are currently version-sensitive. If a blocker exists, reproduce and document it rather than silently changing architecture.

---

## SQL and database performance — MANDATORY

Efficient SQL is a permanent engineering requirement.

Before creating or changing a query, consider:

- expected cardinality;
- tenant/wedding scope;
- filter predicates;
- joins;
- ordering;
- pagination;
- index support;
- number of database round trips.

Rules:

1. Never introduce an N+1 query pattern when a join, batch query, relation query, or bounded prefetch can solve it.
2. Never use unbounded list queries in application paths.
3. Avoid `SELECT *` in performance-sensitive/application queries; select only required columns.
4. Push filtering, sorting, aggregation, and pagination into PostgreSQL rather than loading excessive rows into application memory.
5. Use parameterized queries / ORM parameters. Never concatenate untrusted values into SQL.
6. Use keyset/cursor pagination for large or growing collections when practical. OFFSET pagination is acceptable only when bounded and justified.
7. Add indexes based on real query patterns, not guesswork.
8. Composite index column order must match common equality/range/order access patterns.
9. Foreign-key columns commonly used for joins/filtering should be evaluated for indexes.
10. Avoid redundant/duplicate indexes and unnecessary indexes that increase write cost.
11. Use unique constraints for business invariants where appropriate.
12. Use `EXISTS` for existence checks when the full count is not required.
13. Prefer set-based operations/batching over loops that perform one SQL statement per row.
14. Keep transactions short and intentional.
15. Avoid unnecessary database round trips from Workers to PostgreSQL.
16. Apply tenant/wedding filtering in SQL, not after rows are fetched.
17. Define deterministic ordering for pagination.
18. Query only the data the caller is authorized to access.

For important/non-trivial queries:

- inspect generated SQL;
- validate indexes;
- review query plans with representative data;
- use `EXPLAIN` / `EXPLAIN (ANALYZE, BUFFERS)` safely in development/staging for SELECT queries when useful;
- remember that `EXPLAIN ANALYZE` executes the query;
- do not run destructive performance analysis against production.

A sequential scan is not automatically wrong for tiny tables. Do not add indexes solely to eliminate all sequential scans.

See `docs/DATABASE_GUIDELINES.md`.

---

## Multi-tenant security

All wedding-owned access must be server-scoped.

Never trust client values for:

- tenant;
- wedding;
- user;
- guest;
- role;
- ownership;
- billing ownership.

Authorization is required server-side.

Invitation tokens must be high entropy and unguessable.

Never commit secrets.

---

## Product rules

Authenticated:

- Couple
- Planner
- future collaborators

Guest:

- no normal account requirement;
- no password requirement for normal RSVP;
- secure invitation token/URL/QR access.

Keep separate:

- creator;
- workspace owner;
- role;
- billing owner.

Guest never pays.

LINE/WhatsApp/SMS are optional integrations only.

Core notification direction:

- in-app;
- email;
- Web Push.

---

## Architecture rules

Prefer:

- monorepo;
- small focused modules;
- framework-independent domain logic;
- explicit data access;
- strong typing;
- reversible decisions;
- vertical slices.

Avoid:

- premature microservices;
- VPS-first deployment;
- Kubernetes;
- Redis without a demonstrated requirement;
- giant service files;
- duplicate business logic;
- realtime everywhere;
- unnecessary Cloudflare services.

---

## Workflow

Before editing:

1. inspect repository;
2. read required project docs;
3. inspect installed versions/config;
4. verify version-sensitive official documentation when network access exists;
5. inspect current schema/query patterns;
6. produce a concise implementation plan;
7. identify genuine blockers.

Proceed unless there is a true blocker.

For an unresolved product decision:

- do not silently invent a permanent requirement;
- choose only safe/reversible implementation details;
- record material ambiguity in `docs/OPEN_QUESTIONS.md`.

---

## Validation

After meaningful changes run applicable:

- format;
- lint;
- type-check;
- tests;
- build.

For database changes also check:

- generated migration;
- generated SQL;
- affected indexes/constraints;
- critical query plans when appropriate;
- absence of obvious N+1/unbounded query regressions.

Never claim a check passed unless it was actually run successfully.

Update `docs/PROGRESS.md` after significant work.
