# LoveChapter

LoveChapter is a global, web-first Wedding Planning SaaS for couples,
professional wedding planners, and guests.

## Current status

The first MVP vertical slice exists: an authenticated user can complete a local
profile, create a wedding, add a guest, create a private invitation, receive an
account-free RSVP, and see the current response in the guest list.

The owner has approved a runtime and authentication migration. The target is a
Next.js/vinext frontend Worker with an Elysia 2 API and durable job process on
Bun/VPS, plus first-party verified-email/password authentication. At this
documentation-only milestone, that migration is not yet implemented or deployed.

No custom domain is registered. The owner intends to register
`lovechapter.net`, but the repository must treat it as unowned until
registration, DNS, and TLS are verified. Keep origins configurable and use only
generated or otherwise verified deployment URLs in the meantime.

## Locked technical direction

- Frontend: Next.js + React + TypeScript + App Router
- UI: Tailwind CSS + shadcn/ui
- Frontend production runtime: Cloudflare Workers through vinext
- Backend/API: Elysia 2 on pinned Bun 1.4.2
- Backend deployment: always-on VPS HTTP process
- Background work: separate bounded Bun job process on the same deployment
- Browser/API boundary: same-origin `/api/*` proxy in the frontend Worker
- Authentication: first-party verified email/password and database-backed
  sessions; no normal account for guests
- Email transport: Resend behind a replaceable adapter
- Database: Neon PostgreSQL through bounded direct `pg` pools
- ORM: Drizzle ORM
- Object storage: Cloudflare R2 when needed
- Realtime: Cloudflare Durable Objects only when demonstrated

A backend Worker, Hyperdrive, Worker Queues/Cron, Kubernetes, Redis, and a
second backend runtime are not production targets for the approved design.

Read `PROJECT_CONTEXT.md` and `AGENTS.md` before implementing features. The
approved specification and implementation plan are:

- `docs/superpowers/specs/2026-09-22-custom-auth-bun-vps-backend-design.md`
- `docs/superpowers/plans/2026-09-22-custom-auth-bun-vps-backend.md`

## Repository layout

- `apps/web` — Next.js 16 App Router UI built for Cloudflare Workers with vinext
- `apps/api` — Elysia 2 API; migration to the approved Bun entrypoint is pending
- `packages/contracts` — shared HTTP and data contracts
- `packages/domain` — framework-independent rules and application services
- `packages/database` — Drizzle schema, migrations, SQL, and PostgreSQL adapter
- `docs` — decisions, deployment, progress, query review, and approved plans

The approved plan later adds `packages/auth`, `apps/jobs`, and VPS deployment
assets. They do not exist at this milestone and must not be fabricated in
status reports.

## Local setup

Prerequisites for the checked-in baseline are Node.js 24+, npm 11+, and a
development PostgreSQL database. The approved backend target additionally pins
Bun 1.4.2, but its runtime entrypoints arrive in later plan tasks.

```bash
npm install
```

Apply the checked-in migration with a direct development connection. Never
commit a real database password.

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/lovechapter?sslmode=require'
npm run db:migrate --workspace @lovechapter/database
```

The current environment examples still belong to the pre-migration
implementation. Do not treat them as the approved production contract. Later
tasks replace them together with the API bootstrap, local authentication,
same-origin proxy, and job process so documentation and runnable configuration
change atomically.

## Verification

The baseline automated tests can be run with:

```bash
npm test
```

Repository-wide validation is available through:

```bash
npm run check
npm run db:check --workspace @lovechapter/database
npm run check:vinext --workspace @lovechapter/web
npm run build:next --workspace @lovechapter/web
```

Some pre-migration builds require the environment values described by the
checked-in example files. Do not infer production readiness from a local build.
The complete Bun/VPS, authentication, database, proxy, and deployment gates are
defined in the approved plan and `docs/DEPLOYMENT.md`.

## Documentation

- `PROJECT_CONTEXT.md` — product and architecture source of truth
- `AGENTS.md` — mandatory engineering instructions
- `CODEX_START_PROMPT.md` — implementation bootstrap prompt
- `docs/DECISIONS.md` — accepted and superseded architecture decisions
- `docs/PROGRESS.md` — truthful implementation and validation status
- `docs/OPEN_QUESTIONS.md` — unresolved product and operational decisions
- `docs/DATABASE_GUIDELINES.md` — SQL/database performance and safety rules
- `docs/DEPLOYMENT.md` — approved topology and deployment gates
- `docs/QUERY_REVIEW.md` — current query/index rationale
