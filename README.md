# LoveChapter

LoveChapter is a global, web-first Wedding Planning SaaS for couples, professional wedding planners, and guests.

## Current status

The first MVP vertical slice is implemented: anyone can register with Clerk by
Google or verified-email OTP, complete a local LoveChapter profile, create a
wedding, add a guest, create a private invitation, receive an account-free
RSVP, and see the current response in the guest list.

Current working product name: **LoveChapter**

A possible future domain is `lovechapter.tech`, but **no domain has been registered yet**.

Until a custom domain is actually registered and configured, deployments must use Cloudflare's generated `*.workers.dev` URLs.

Do not hardcode `lovechapter.tech` anywhere in production configuration yet.

## Locked technical direction

- Frontend: Next.js + React + TypeScript
- UI: Tailwind CSS + shadcn/ui
- Deployment: Cloudflare Workers
- Next.js on Workers: use current Cloudflare-recommended vinext path when compatible
- Backend/API: Elysia 2
- Production runtime: Cloudflare Workers
- Package manager/dev tooling: Bun is allowed
- Authentication: Clerk sessions for account users; no account for guests
- Database: Neon PostgreSQL
- Database access: Cloudflare Hyperdrive
- ORM: Drizzle ORM
- PostgreSQL driver: prefer `pg` / node-postgres with Hyperdrive
- Object storage: Cloudflare R2 when needed
- Async jobs: Cloudflare Queues / Workflows when needed
- Realtime: Cloudflare Durable Objects when needed

Read `PROJECT_CONTEXT.md` and `AGENTS.md` before implementing features.

## Repository layout

- `apps/web` — Next.js 16 App Router UI, built for Workers with vinext
- `apps/api` — Elysia 2 API Worker
- `packages/contracts` — shared HTTP/data contracts
- `packages/domain` — framework-independent rules and application service
- `packages/database` — Drizzle schema, migration, SQL, and PostgreSQL adapter

## Local setup

Prerequisites: Node.js 24+, npm 11+, and a PostgreSQL database. Bun remains
optional tooling; it is not the production HTTP runtime.

```bash
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/web/.env.local.example apps/web/.env.local
```

Create a Clerk development instance before running the authenticated UI. Enable
open registration, required email verification, email OTP, and Google; disable
password authentication. In Clerk's session-token customization, add this
compact claim:

```json
{ "primaryEmail": "{{user.primary_email_address}}" }
```

Put the development instance's publishable key in
`apps/web/.env.local`. To exercise real API verification locally, set
`AUTH_MODE=clerk`, `CLERK_PUBLISHABLE_KEY`, and the instance's PEM public key as
`CLERK_JWT_KEY` in the untracked `apps/api/.dev.vars`. The checked-in example
defaults to a fixed development identity for database/UI work; that mode is
never a production substitute.

Set the API's local Hyperdrive connection in
`apps/api/wrangler.jsonc` (`localConnectionString`) to a development PostgreSQL
database. Never commit a real database password. The sample development
identity comes only from `apps/api/.dev.vars`; request headers cannot select a
user, wedding, or role.

Apply the migration with a direct, unpooled development connection:

```bash
export DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/lovechapter?sslmode=require'
npm run db:migrate --workspace @lovechapter/database
```

Start the two Workers in separate terminals:

```bash
npm run dev --workspace @lovechapter/api
npm run dev --workspace @lovechapter/web
```

The defaults are API `http://localhost:8787` and web
`http://localhost:3000`. If ports change, keep `PUBLIC_WEB_ORIGIN` and
`NEXT_PUBLIC_API_ORIGIN` aligned.

## Verification

```bash
export NEXT_PUBLIC_API_ORIGIN='https://api.example.workers.dev'
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA'
npm run check
npm run db:check --workspace @lovechapter/database
npm exec --workspace @lovechapter/web -- vinext check
npm run build:next --workspace @lovechapter/web
```

`npm run check` checks formatting, lints, type-checks, runs tests, and builds
both Workers. Production web builds intentionally fail if the public API origin
or Clerk publishable key is absent or invalid; public browser configuration is
embedded at build time and never defaults to a local server. Database
query/index rationale is recorded in
`docs/QUERY_REVIEW.md`; deployment steps are in `docs/DEPLOYMENT.md`.

## Documentation

- `PROJECT_CONTEXT.md` — product and architecture source of truth
- `AGENTS.md` — instructions for Codex/AI coding agents
- `CODEX_START_PROMPT.md` — first implementation prompt
- `docs/DECISIONS.md` — accepted architecture decisions
- `docs/PROGRESS.md` — implementation status
- `docs/OPEN_QUESTIONS.md` — unresolved decisions
- `docs/DATABASE_GUIDELINES.md` — SQL/database performance and safety rules
- `docs/DEPLOYMENT.md` — current Cloudflare deployment strategy
