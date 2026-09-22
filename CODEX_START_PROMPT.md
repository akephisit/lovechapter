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

The owner intends to register `lovechapter.net`, but ownership is unconfirmed.

For now:

- use available generated deployment URLs;
- use environment/config variables for frontend/API origins;
- do not hardcode or configure `lovechapter.net`;
- report only URLs observed from real deployment output.

Suggested frontend Worker name:

- `lovechapter-web`

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
- Bun 1.4.2
- always-on VPS HTTP process
- separate Bun background-job process
- same-origin browser access through a server-only frontend Worker proxy

Database:

- Neon PostgreSQL
- Drizzle ORM
- bounded direct `pg` / node-postgres pools

Do not use Cloudflare D1 as primary data store.

Do not use Hyperdrive or a backend Worker in production.

Bun-only APIs belong in API/job bootstrap modules, not domain, authentication,
or repository logic.

## Elysia 2 requirement

Elysia 2 is a deliberate project decision.

At the time this project context was written, Elysia 2 is beta and version-sensitive.

Therefore:

1. inspect the current official Elysia documentation;
2. use the current Elysia 2 line appropriate at implementation time;
3. verify the Bun HTTP adapter and lifecycle;
4. do not assume Elysia 1.x examples are correct;
5. verify required compile/adapter/build behavior for the selected version;
6. do not silently replace Elysia 2 or add a second backend runtime.

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
2. current frontend Worker-compatible local dev;
3. frontend Worker configuration;
4. environment strategy;
5. Neon + bounded `pg` pools + Drizzle foundation;
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

Authentication is first-party verified-email/password with database-backed
sessions. Email verification is required before sign-in. Use Resend only behind
a replaceable email-transport interface, revoke every session on password reset,
and keep guest RSVP account-free.

Allow only `AUTH_MODE=disabled`, `AUTH_MODE=development`, and
`AUTH_MODE=local`. Keep `disabled` as the default and reject `development` in
production.

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
- a backend Worker or second backend runtime.

## Asynchronous work

Use async APIs for network, database, crypto, and email work. Parallelize only
independent operations, use `Promise.all` only for small statically bounded
sets, and apply explicit concurrency limits to batched work. Keep transaction
dependency chains sequential, prefer set-based SQL to parallel query loops,
and require idempotency, cancellation, timeouts, and bounded cleanup for
retryable background jobs. Persist work that must survive the response.

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
- deployed URLs if deployment was performed;
- next smallest milestone.
