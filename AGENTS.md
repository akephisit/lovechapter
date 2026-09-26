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

The owner intends to register `lovechapter.net`, but ownership is unconfirmed.

Until registration is confirmed:

- use available generated deployment URLs;
- keep origins configurable;
- never hardcode `lovechapter.net`;
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
- select one production runtime per installation: Bun 1.4.2 on a VPS or
  Cloudflare Workers
- VPS: always-on Bun HTTP process and separate Bun background-job process
- Workers: Elysia fetch handler and bounded scheduled job handlers
- browser traffic reaches the API only through the frontend Worker's server-side
  same-origin proxy

Database:

- Neon PostgreSQL
- Drizzle ORM
- VPS: bounded direct `pg` / node-postgres pools
- Workers: invocation-scoped `pg.Client` through Hyperdrive

Frontend-supporting Cloudflare services only when needed:

- R2
- Durable Objects
- KV

Bun:

- pinned to 1.4.2 for backend production on the VPS option;
- used for the API HTTP process and background-job process on VPS installs;
- Bun-only APIs stay in bootstrap/runtime modules.

Do not use Bun-only server/runtime APIs in domain, authentication, or repository logic.

Do not replace Elysia 2 with another HTTP framework without explicit approval.

Elysia 2 is version-sensitive. If a blocker exists, reproduce and document it rather than silently changing architecture.

### Backend runtime parity — MANDATORY

Every new or changed backend capability must work when an installation chooses
**either** Bun/VPS **or** Cloudflare Workers. An installation runs one backend
choice at a time; this rule does not require running both deployments together.

- Keep routes, request/response contracts, authorization, sessions, business
  rules, database schema, and outbox semantics shared across the two choices.
- Keep Bun HTTP/process lifecycle and polling in their Bun bootstrap modules.
  Keep Worker fetch/scheduled handlers and invocation-owned connections in
  their Worker modules. Do not introduce a Bun-only or Worker-only dependency
  into shared auth, domain, or repository code without a compatible adapter.
- When adding durable background work, implement both the bounded Bun job path
  and the bounded Worker scheduled path, with the same retry, lease, cleanup,
  and idempotency rules. Do not use detached Worker work as the sole durable
  delivery mechanism.
- Preserve the frontend Worker's same-origin proxy, ingress credential,
  tenant checks, and cookie behavior for either selected backend origin.
- VPS uses bounded direct `pg.Pool` instances. Workers use Hyperdrive with
  query caching disabled and a lazy `pg.Client` scoped to each invocation;
  streamed responses retain the client until completion or cancellation.
- A feature is incomplete if it works only on one runtime. If a capability is
  genuinely unavailable on one platform, document and reproduce the blocker
  before changing the agreed runtime support.

### Release and schema evolution — MANDATORY

Use one canonical application contract and one canonical database schema per
release. Do not add legacy columns/tables, dual reads or writes, versioned API
paths, or compatibility adapters solely to keep an older deployment working
with a new release. Backend runtime parity means Worker and Bun/VPS implement
the same current behavior; it does not mean old and new releases must coexist.

For a breaking schema or API change, use a coordinated cutover rather than a
rolling mixed-version deployment:

1. Build and test the frontend, both backend runtime paths, and migration from
   the same revision before touching the live installation.
2. Have a tested way to stop new writes and scheduled/background jobs, and
   drain in-flight work before applying an incompatible migration. If no such
   gate exists, do not deploy the breaking change.
3. Take and verify a recoverable database backup/PITR point. Migrate existing
   data into the new structure, validate it, and then remove superseded schema
   in the coordinated release; never discard user data implicitly.
4. Deploy only the installation's selected backend and its frontend from that
   revision, verify critical flows, then reopen traffic and jobs. Do not expose
   an old application to the new schema or a new application to the old schema.
5. If cutover fails, keep the installation closed while applying a reviewed
   forward fix or restoring a verified backup. Do not assume an old binary can
   be restarted against an incompatible migrated database.

Naturally compatible changes may still deploy selectively. Do not require a
breaking migration for every release. Zero-downtime breaking changes need a
separately designed and approved atomic-switch mechanism; they are not a reason
to accumulate permanent compatibility scaffolding. Record downtime, data
transformation, validation, and recovery steps for each breaking release.

For the first, Worker-backed production installation, **every application
deployment** enters whole-site maintenance, including web-only and API-only
changes. Build the affected Worker artifacts before closure; if both change,
finish both builds before switching either. Close admission for all pages,
API traffic, and scheduled work, then drain leases. Deploy only the affected
Worker version(s), retaining the exact unchanged version ID/source SHA for
the other component. Shared code, migrations, or uncertain impact select both
Workers; documentation-only changes neither deploy nor close the gate. Apply
only reviewed migrations while drained. Privately verify the closed-gate
pair, reopen atomically only with exact-SHA/version evidence, then run public
and staging acceptance. A failure after reopen must reclose the gate; never
automatically roll back a migrated schema. Production automation stays off
until protected `main`, same-SHA staging acceptance, and a rehearsed
production bootstrap/recovery path are proven. The temporary real-inbox email
waiver must be recorded as `waived`, never `passed`.

For this first Worker installation, the owner may work in an isolated branch
or worktree, commit, and push the candidate directly to protected `main` by a
verified fast-forward update. No PR, independent reviewer, or hosted branch CI
is required. Do not force-push or delete `main`; do not require pre-push status
checks that would block this flow. The single push-to-`main` release workflow
runs exact-SHA CI and disposable PostgreSQL checks before staging or production
can enter maintenance. A failed CI leaves its commit on `main` but must not
deploy; fix with a forward commit. Keep environment secrets restricted to
protected `main` and both release-enabled flags off until their live gates are
proven. A migration that intentionally discards customer data still requires
separate explicit owner approval and a recovery plan.

Authentication:

- first-party verified-email/password accounts;
- database-backed sessions in secure HTTP-only cookies;
- Resend behind an isolated email-transport interface;
- guest invitation and RSVP flows remain account-free.

`AUTH_MODE` supports only `disabled`, `development`, and `local`. Keep
`disabled` as the safe default, reject `development` in production, and enable
`local` only after every production security and delivery dependency exists.

Clerk and other managed authentication providers are not production targets.

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
15. Avoid unnecessary database round trips between backend processes and PostgreSQL.
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
- simultaneous backend runtime deployments for one installation;
- Kubernetes;
- Redis without a demonstrated requirement;
- giant service files;
- duplicate business logic;
- realtime everywhere;
- unnecessary Cloudflare services.

---

## Asynchronous and parallel work

- Use asynchronous APIs for network, database, crypto, and email operations.
- Run work in parallel only when operations are independent.
- Use `Promise.all` only for small, statically bounded sets.
- Apply explicit concurrency limits to data-dependent or batched work.
- Keep dependency chains and operations sharing one transaction/client sequential.
- Prefer set-based SQL over parallel loops that issue one query per row.
- Make retryable background jobs idempotent.
- Add cancellation, timeouts, and error aggregation where applicable.
- Persist work that must survive a response before scheduling it.
- Move CPU-heavy work away from the request loop when it cannot meet the runtime budget.
- Before enabling local authentication on a Worker installation, compare
  measured production-policy password-hash CPU time with the account's actual
  per-invocation limit. Infrequent successful over-limit requests do not
  establish sustained viability; do not weaken password hashing to fit a plan.

Parallelism must not disguise N+1 access or issue unbounded remote work.

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

For backend behavior changes, verify shared tests and **both** deployment
paths: Bun API/job builds and runtime smoke, plus the API Worker Wrangler
bundle dry-run. Exercise the affected HTTP and background behavior on both
paths where it can be tested locally or in CI. Keep CI gates for both choices;
if real infrastructure is unavailable, state the unverified staging behavior
instead of calling either path production-verified.

For database changes also check:

- generated migration;
- generated SQL;
- affected indexes/constraints;
- critical query plans when appropriate;
- absence of obvious N+1/unbounded query regressions.

Never claim a check passed unless it was actually run successfully.

Update `docs/PROGRESS.md` after significant work.
