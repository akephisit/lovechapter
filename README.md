# LoveChapter

LoveChapter is a global, web-first wedding-planning SaaS for couples,
professional planners, and account-free guests.

## Current status

The first-party MVP vertical slice is implemented and locally verified:

- verified-email/password registration, secure cookie sessions, password reset,
  bounded database rate limits, and durable auth-email jobs;
- an Elysia 2 API and separate job process on pinned Bun 1.4.2;
- a Next.js/vinext frontend with a server-only same-origin `/api/*` proxy;
- wedding, guest, private invitation, and account-free RSVP flows;
- bounded PostgreSQL repositories, generated migrations, and regression tests;
- hardened example systemd units, Caddy TLS proxy config, and an operations
  runbook.

This is not evidence of a live deployment. No VPS, custom domain, production
Neon database, Resend sender, or deployed URL is claimed. See
`docs/DEPLOYMENT.md` for the remaining external gates.

## Architecture

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS, vinext, Cloudflare
  Workers
- Browser/API boundary: same-origin `/api/*` server proxy
- Backend: Elysia 2 on Bun 1.4.2, supervised on an always-on VPS
- Jobs: separate bounded Bun process using the PostgreSQL outbox
- Authentication: first-party verified email/password and database-backed
  sessions; guests remain account-free
- Email: Resend behind a replaceable adapter
- Database: Neon/PostgreSQL via bounded direct `pg` pools and Drizzle ORM

A backend Worker, Hyperdrive, Worker Queues/Cron, Kubernetes, Redis, and a
second backend runtime are not production targets.

## Repository layout

- `apps/web` — Next.js/vinext UI and server-only API proxy
- `apps/api` — Elysia API, Bun server, and scrypt benchmark
- `apps/jobs` — bounded auth-email outbox worker
- `packages/auth` — password, token, rate-limit, and auth service contracts
- `packages/contracts` — shared HTTP/data contracts
- `packages/domain` — product rules and application services
- `packages/database` — Drizzle schema, migrations, and repositories
- `deploy` — example systemd services and Caddy configuration
- `docs` — decisions, operations, progress, and query review

## Local setup

Prerequisites are Node.js 24+, npm 11+, Bun exactly 1.4.2, and a development
PostgreSQL database.

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/jobs/.env.example apps/jobs/.env
cp apps/web/.env.local.example apps/web/.env.local
```

Replace every placeholder with independent local values. Apply migrations with
a direct migration connection, not an application pool credential:

```bash
export DATABASE_URL='postgres://MIGRATION_USER:PASSWORD@HOST:5432/lovechapter?sslmode=require'
npm run db:migrate --workspace @lovechapter/database
```

Development entrypoints:

```bash
npm run dev --workspace @lovechapter/api
npm run dev --workspace @lovechapter/jobs
npm run dev --workspace @lovechapter/web
```

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:check --workspace @lovechapter/database
npm run build --workspace @lovechapter/api
npm run smoke:bun --workspace @lovechapter/api
npm run benchmark:auth --workspace @lovechapter/api
npm run build --workspace @lovechapter/jobs
npm run build:next --workspace @lovechapter/web
npm run check:vinext --workspace @lovechapter/web
npm run build --workspace @lovechapter/web
```

The PostgreSQL concurrency suite is opt-in and must target a disposable
database explicitly:

```bash
TEST_DATABASE_URL='postgres://...' \
TEST_DATABASE_CONFIRM=lovechapter_test \
npm run test:postgres --workspace @lovechapter/database
```

## Documentation

- `PROJECT_CONTEXT.md` — product and architecture source of truth
- `AGENTS.md` — engineering constraints
- `docs/DECISIONS.md` — accepted/superseded architecture decisions
- `docs/PROGRESS.md` — implementation and validation status
- `docs/OPEN_QUESTIONS.md` — unresolved product/operational decisions
- `docs/DATABASE_GUIDELINES.md` — database performance and safety rules
- `docs/QUERY_REVIEW.md` — query, transaction, and index rationale
- `docs/DEPLOYMENT.md` — VPS/Worker deployment and external gates
