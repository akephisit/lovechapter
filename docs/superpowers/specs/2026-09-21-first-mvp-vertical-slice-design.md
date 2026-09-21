# LoveChapter First MVP Vertical Slice Design

**Date:** 2026-09-21

**Status:** Approved for implementation by the initiating build prompt
**Source of truth:** `PROJECT_CONTEXT.md`, with locked decisions in `docs/DECISIONS.md`

## Intent and success criteria

The first slice must prove one secure, coherent path across the locked stack:

1. A server-resolved Couple identity creates a Wedding.
2. The Couple adds a Guest to that Wedding.
3. The Couple creates a high-entropy Invitation.
4. The Guest opens `/i/{invitationToken}` without an account.
5. The Guest submits or updates an RSVP.
6. The Couple sees the current RSVP state.

The slice succeeds when the flow works locally, both Workers build for Cloudflare, critical authorization/invitation/RSVP behavior is covered by automated tests, and the database schema and queries demonstrate tenant scoping, bounded access, deterministic ordering, and no N+1 pattern.

## Architecture

Use an npm-workspace monorepo with two independently deployable Workers and small shared packages:

- `apps/web`: Next.js 16 App Router application, compiled for Cloudflare Workers through vinext.
- `apps/api`: Elysia 2 Worker containing HTTP routing and composition only.
- `packages/domain`: framework-independent entities, policies, use cases, errors, token generation, and ports.
- `packages/contracts`: shared request/response types and validation-safe constants.
- `packages/database`: Drizzle PostgreSQL schema, Hyperdrive/node-postgres session creation, and tenant-scoped repositories.

The API depends inward on domain ports. The database package implements those ports. The web application communicates with the API through configurable origins and never imports database or API internals.

## Identity and authorization

Authentication provider selection remains open. Do not add passwords, cookies, or a pretend production login system.

Define an `IdentityProvider` port that resolves a trusted principal on the server. Provide:

- a development adapter populated exclusively from Worker environment configuration, never from client-supplied user/wedding/role headers;
- a disabled adapter used when development identity is not explicitly enabled, which fails protected operations closed;
- a clear seam for a future production provider.

An authenticated principal is synchronized to the local `users` record by stable `(auth_provider, auth_subject)` identity. Every protected wedding operation receives the resolved internal user ID and verifies membership inside its SQL statement or transaction. Client wedding and guest IDs are resource locators, not authorization evidence.

## MVP data model

Generate UUIDs in Web Crypto-compatible application code. Use timezone-aware timestamps consistently.

- `users`: internal ID, auth provider/subject unique pair, display name, optional email, timestamps.
- `weddings`: ID, name, optional wedding date, IANA time zone, locale, creator user ID, workspace owner user ID, optional billing owner user ID, timestamps.
- `wedding_members`: wedding/user composite primary key and role (`owner`, `couple`, `planner`, `collaborator`).
- `guests`: ID, wedding ID, name, optional email, allowed party size, timestamps.
- `invitations`: ID, wedding/guest IDs, SHA-256 token hash, creator user ID, expiry/revocation fields, timestamps. The raw token is returned only at creation time and never persisted.
- `rsvps`: ID, wedding/guest/invitation IDs, attendance status, party size, optional note, timestamps. One current RSVP per guest is enforced by a unique constraint.

Composite foreign keys preserve wedding consistency between guests, invitations, and RSVPs. A partial unique index allows at most one active invitation per guest while retaining revoked invitation history. The token hash is globally unique.

## API and data flow

Protected endpoints:

- `GET /v1/me`
- `GET /v1/weddings?limit=&cursor=`
- `POST /v1/weddings`
- `GET /v1/weddings/:weddingId/guests?limit=&cursor=`
- `POST /v1/weddings/:weddingId/guests`
- `POST /v1/weddings/:weddingId/guests/:guestId/invitations`

Public endpoints:

- `GET /v1/public/invitations/:invitationToken`
- `PUT /v1/public/invitations/:invitationToken/rsvp`
- `GET /health`

Protected writes use membership-scoped `INSERT ... SELECT` or short transactions so authorization and mutation cannot diverge. Guest listing uses one bounded query joining the current RSVP, ordered by `(created_at DESC, id DESC)` with a keyset cursor. Public lookup hashes the presented token and resolves Invitation → Guest → Wedding → RSVP in one bounded query. RSVP upsert derives wedding, guest, and invitation IDs from the valid token inside SQL; it does not accept those identifiers from the caller.

All application queries select explicit columns. Database sessions use one `pg.Client` per request/operation and close it in `finally`; Hyperdrive owns connection pooling in production.

## Web experience

The home experience is a focused Couple workspace:

- display the configured development identity and the authentication-integration notice;
- create/select a wedding;
- add a guest;
- create and copy an invitation link;
- show a bounded guest list with RSVP status and party size;
- refresh status after the Guest submits an RSVP.

The public route `/i/[invitationToken]` displays wedding/guest details and an accessible RSVP form, supports initial and updated responses, and clearly reports revoked, expired, invalid, and transient failures.

Use Tailwind CSS and local shadcn/ui components. Forms have explicit labels, inline validation, keyboard-visible focus states, semantic live regions, and mobile-first responsive layouts. Include a web manifest and installable-app metadata; avoid offline mutation behavior in this slice.

## Configuration and deployment

- Worker names remain `lovechapter-web` and `lovechapter-api`.
- No custom-domain value appears in runtime configuration.
- `NEXT_PUBLIC_API_ORIGIN`, `PUBLIC_WEB_ORIGIN`, identity mode, and identity details are environment-driven.
- The API Wrangler configuration declares a `HYPERDRIVE` binding and `nodejs_compat`, using a current compatibility date.
- Local development may use Hyperdrive's local connection string override or an explicitly configured direct PostgreSQL URL; production requires the Hyperdrive binding.
- Secrets live in `.dev.vars`/Cloudflare secrets and are excluded from version control. Only examples are committed.

Deployment is not attempted without Cloudflare/Neon credentials. The repository must still support type generation, dry-run builds, and documented setup commands.

## Error handling and security

Domain errors map to stable HTTP statuses and non-sensitive JSON errors. Validation errors are 400, missing identity is 401/503 as appropriate, non-membership deliberately appears as 404 to avoid leaking wedding existence, active-invitation conflicts are 409, and invalid/revoked/expired public tokens are 404 or 410 without distinguishing secret details unnecessarily.

Never log raw invitation tokens, authorization material, or database connection strings. CORS accepts only the configured web origin. RSVP party size must match attendance and never exceed the guest allowance.

## Testing and verification

Follow red-green-refactor for production behavior.

- Domain tests: token entropy/format/hash behavior, RSVP invariants, cursors, and error mapping.
- Use-case tests with in-memory ports: identity fail-closed behavior, membership authorization, invitation issuance, public lookup, initial RSVP and RSVP update.
- API tests: validation and HTTP mapping using an injected application service layer.
- Database contract/static review: generated migration SQL, constraints, indexes, explicit projections, bounded queries, and statement-count review.
- Web tests: critical form behavior and public invitation/RSVP states.
- Full checks: format, lint, type-check, tests, vinext compatibility check, API Wrangler dry-run, web build, and migration generation drift check.

`EXPLAIN` requires an actual PostgreSQL database with representative data. If credentials are unavailable, record that limitation rather than claiming a query-plan check passed.

## Explicit non-goals

No production auth provider, billing, subscription, email/SMS/LINE/WhatsApp delivery, advanced notifications, seating, realtime, analytics, AI, RLS, custom domain, or deployment is included.
