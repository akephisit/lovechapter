# LoveChapter — Codex Initial Build Prompt

You are the lead engineer for LoveChapter.

Before editing any code, read completely:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/DATABASE_GUIDELINES.md`
- `docs/DEPLOYMENT.md`

Treat `PROJECT_CONTEXT.md` as product/architecture source of truth and `AGENTS.md` as mandatory engineering instructions.

## Product

LoveChapter is a global, web-first Wedding Planning SaaS serving:

- Couple
- Planner
- Guest

Guest access must work without creating an account.

## Domain status

No custom domain has been registered.

`lovechapter.tech` is a candidate only.

For now:

- deploy to Cloudflare-generated `*.workers.dev` URLs;
- use environment/config variables for frontend/API origins;
- do not hardcode or configure `lovechapter.tech`;
- report the actual Workers URLs after deployment.

Suggested Worker names:

- `lovechapter-web`
- `lovechapter-api`

## Required stack

Frontend:

- Next.js
- React
- TypeScript
- App Router
- Tailwind CSS
- shadcn/ui
- PWA-capable
- Cloudflare Workers
- follow current official Cloudflare guidance for vinext and verify compatibility

Backend:

- Elysia 2
- TypeScript
- Cloudflare Workers runtime

Database:

- Neon PostgreSQL
- Cloudflare Hyperdrive
- Drizzle ORM
- prefer `pg` / node-postgres with Hyperdrive when compatible

Do not use Cloudflare D1 as primary data store.

Do not use the Neon serverless driver on top of Hyperdrive unless current official integration requirements demonstrate a reason.

Bun can be package manager/tooling but production API is not a Bun server.

Do not use `Bun.serve()` or Bun-only APIs in production/domain logic.

## Elysia 2 requirement

Elysia 2 is a deliberate project decision.

At the time this project context was written, Elysia 2 is beta and Cloudflare Worker support is experimental/version-sensitive.

Therefore:

1. inspect the current official Elysia documentation;
2. use the current Elysia 2 line appropriate at implementation time;
3. verify the Cloudflare Workers adapter;
4. do not assume Elysia 1.x examples are correct;
5. verify required compile/adapter/build behavior for the selected version;
6. do not silently replace Elysia 2.

If Elysia 2 is actually blocked:

- create the smallest reproduction;
- document it in `docs/DECISIONS.md`;
- continue all non-blocked foundation work;
- request approval before changing backend framework.

## Database performance is mandatory

Do not treat ORM-generated SQL as automatically efficient.

For every important data path:

- think about row counts and access pattern;
- inspect generated SQL;
- avoid N+1 queries;
- avoid unbounded queries;
- select only needed columns;
- filter by wedding/tenant in SQL;
- use appropriate joins/batching;
- design indexes around real predicates/order;
- use deterministic pagination;
- prefer cursor/keyset pagination for large growing lists;
- reduce Worker <-> PostgreSQL round trips;
- keep transactions short;
- use constraints for invariants;
- parameterize input.

For critical/non-trivial SELECT queries, use safe query-plan inspection in dev/staging with representative data when useful.

Read and follow `docs/DATABASE_GUIDELINES.md`.

## First vertical slice

Implement the smallest coherent end-to-end MVP:

Couple identity
-> Couple creates Wedding
-> Couple adds Guest
-> System creates secure Invitation
-> Guest opens `/i/{invitationToken}`
-> Guest RSVPs without account
-> Couple sees updated RSVP state

## Scope

Implement:

1. monorepo foundation;
2. current Cloudflare-compatible local dev;
3. Worker configuration;
4. environment strategy;
5. Neon + Hyperdrive + Drizzle foundation;
6. MVP schema and migrations;
7. auth boundary for Couple/Planner;
8. wedding creation;
9. membership/authorization;
10. guest management;
11. cryptographically strong invitation token generation;
12. public invitation page;
13. RSVP;
14. couple-facing RSVP state;
15. responsive accessible UI;
16. server-side tenant isolation;
17. input validation;
18. automated tests for critical auth/invitation/RSVP behavior;
19. SQL/index/query review for MVP data paths.

Authentication provider is still an OPEN DECISION. Do not invent a bespoke production password system. If an auth provider is not yet configured, build a clean auth boundary and continue every non-blocked part of the vertical slice; clearly record the remaining authentication integration in `docs/OPEN_QUESTIONS.md` / `docs/PROGRESS.md`.

## Do not implement yet

Unless genuinely necessary:

- payments;
- Planner Pro subscription;
- SMS;
- WhatsApp;
- LINE;
- AI;
- advanced notification orchestration;
- advanced seating;
- realtime;
- Durable Objects;
- complex analytics;
- Redis;
- Kubernetes;
- VPS deployment.

## Database/schema expectations

Do not generate the whole future schema.

For MVP, design only what is needed plus safe extension points.

Before migration:

- identify expected queries;
- define PK/FK/unique constraints;
- decide indexes from those queries;
- ensure wedding ownership scope is explicit;
- avoid nullable fields without reason;
- use consistent timestamps;
- choose globally unique IDs.

Do not create indexes blindly. Explain important composite indexes in the implementation summary.

## Security

Never trust client-supplied wedding/tenant/user/guest/role/owner IDs.

Invitation tokens:

- high entropy;
- non-sequential;
- unguessable;
- designed for later revocation.

Never log secrets or full sensitive tokens unnecessarily.

## Working process

Start by:

1. inspecting repository;
2. reading docs;
3. checking installed/current versions;
4. checking current official docs for version-sensitive integrations;
5. producing a concise plan;
6. noting real risks.

Then proceed. Do not stop after the plan unless truly blocked.

## Completion checks

Run applicable:

- formatting;
- lint;
- type-check;
- tests;
- build;
- migration generation/validation.

For important database operations:

- inspect generated SQL;
- verify indexes/constraints;
- check for N+1/unbounded access;
- inspect query plan in dev/staging when useful.

Update:

- `docs/PROGRESS.md`
- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`

At the end report:

- implemented work;
- commands/checks that actually passed;
- database/query/index decisions;
- unresolved blockers;
- deployed `*.workers.dev` URLs if deployment was performed;
- next smallest milestone.
