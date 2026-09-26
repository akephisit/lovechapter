# Selectable Backend Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow a deployment to select either Cloudflare Workers or the existing Bun/VPS backend with full API, email and cleanup behavior.

**Architecture:** Reuse Elysia and repositories. Add invocation-scoped pg.Client behind Hyperdrive and a fetch/scheduled Worker entry, leaving Bun and its process pool unchanged. Route the existing frontend proxy to the selected origin.

**Tech Stack:** Elysia 2.0.0-beta.16, Bun 1.4.2, Workers Wrangler, pg 8.23.0, Drizzle, Neon, Hyperdrive, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-selectable-backend-runtime-design.md`

## Global Constraints

- One backend runtime per installation. Preserve the existing VPS path.
- Do not expose business routes without frontend proxy ingress authentication.
- Close invocation-owned database connections even on failure.
- Preserve bounded email batches and cleanup, and avoid unbounded Worker loops.

## Review Focus

- Bad/missing Worker bindings fail closed before returning success.
- Liveness does not require a database connection; readiness does.
- Direct API requests without proxy credentials remain rejected.
- Failed database operations close clients and surface errors.
- Cron cleanup does not deliver email, while email ticks do not run cleanup.
- The frontend must not proxy to its own origin; Workers-to-Workers routing
  requires a Cloudflare compatibility flag.
- Local auth must reject missing Resend config; cache-disabled Hyperdrive must
  be an explicit installation gate.

### Task 1: Invocation-scoped PostgreSQL repositories

**Files:** `packages/database/src/client.ts`, `packages/database/src/client.test.ts`.

**Interfaces:** Produce `withPostgresRuntime(connectionString, operation, createClient?)`, passing all repositories and `readiness` to the operation.

- [ ] Write a test calling the operation with each repository using a fake pg.Client, checking one lazy connect and one close; test a failed operation too.
- [ ] Run `npx vitest run packages/database/src/client.test.ts`, observe the missing export failure.
- [ ] Implement the invocation-scoped runtime using `LazyPostgresQueryExecutor` and `finally`.
- [ ] Run the focused tests and workspace typecheck; commit the task.

### Task 2: Cloudflare API fetch and scheduled jobs

**Files:** `apps/api/src/worker.ts`, `apps/api/src/worker.test.ts`, `apps/api/src/worker-runtime.ts`, `apps/api/src/worker-runtime.test.ts`, `apps/api/src/worker-jobs.ts`.

**Interfaces:** Worker default export has `fetch` and `scheduled`; Worker environment contains `HYPERDRIVE.connectionString`, API secrets and email configuration.

- [ ] Test env fail closed, liveness without database, protected API request and lifecycle close, bounded email cron and separate cleanup cron.
- [ ] Run focused Vitest tests and confirm failures for missing Worker handlers.
- [ ] Build config parsing and fetch/scheduled handlers using the shared services, email processor and Resend sender.
- [ ] Run focused Vitest tests and typecheck; commit the task.

### Task 3: Deployment and validation

**Files:** `apps/api/wrangler.jsonc`, `apps/api/package.json`, `apps/web/wrangler.jsonc`, `apps/web/lib/backend-proxy.ts`, `apps/web/lib/backend-proxy.test.ts`, `package.json`, `AGENTS.md`, `PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, `docs/DATABASE_GUIDELINES.md`, `docs/PROGRESS.md`, `docs/OPEN_QUESTIONS.md`.

**Interfaces:** `npm run deploy:worker --workspace @lovechapter/api -- --dry-run` builds without publishing. CI includes its dry-run.

- [ ] Configure Wrangler with nodejs_compat and two cron triggers, and the web Worker with public Worker-to-Worker global fetch; document cache-disabled Hyperdrive binding ID and secrets without real values.
- [ ] Update source-of-truth docs with selectable runtime and explicit one-at-a-time choice.
- [ ] Run full formatting, lint, typecheck, tests, Bun build/smoke (where available), Worker dry-run and web build; resolve failures.
- [ ] Commit, update existing PR and push after verification.
