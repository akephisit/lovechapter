# LoveChapter — Architecture Decisions

## ADR-001 — Global web-first SaaS

**Status:** Accepted

LoveChapter is a global, web-first Wedding Planning SaaS.

Native mobile applications are not required for the first product version. PWA capability is preferred.

## ADR-002 — Guests do not require normal accounts

**Status:** Accepted

Guests use secure invitation URLs/tokens/QR codes and can RSVP without account/password creation.

## ADR-003 — Ownership, membership, creation, and billing are independent

**Status:** Accepted

Keep separate:

- creator;
- workspace owner;
- membership role;
- billing owner.

## ADR-004 — Cloudflare-first

**Status:** Accepted historically; backend-runtime portion superseded by ADR-016 and ADR-023

Frontend and API target Cloudflare Workers.

Do not introduce VPS/Kubernetes/Redis by default.

## ADR-005 — Elysia 2 backend

**Status:** Accepted with known compatibility risk; runtime portion superseded by ADR-016 and ADR-023

Elysia 2 is the chosen API framework.

Production runtime is Cloudflare Workers.

Known risk:

- Elysia 2 is currently beta;
- Cloudflare Worker adapter is currently experimental/version-sensitive.

A blocker must be reproduced/documented. Do not silently change frameworks.

## ADR-006 — Next.js on Cloudflare Workers

**Status:** Accepted direction

Use Next.js + React + TypeScript.

Use the current Cloudflare-recommended vinext path when compatible with selected versions.

Compatibility must be verified before relying on version-sensitive features.

## ADR-007 — Neon PostgreSQL + Hyperdrive + Drizzle

**Status:** Accepted historically; connection path governed by ADR-023

Primary database: Neon PostgreSQL.

Connection:
Cloudflare Worker -> Hyperdrive -> Neon.

ORM:
Drizzle.

Prefer a direct/unpooled Neon connection when creating Hyperdrive.

Prefer `pg` / node-postgres where compatible with the selected Drizzle/Workers configuration.

## ADR-008 — SQL efficiency is a core engineering requirement

**Status:** Accepted

LoveChapter must use efficient SQL/data-access patterns from the start.

Required practices include:

- avoid N+1;
- no unbounded lists;
- select only needed columns;
- query/index design based on access patterns;
- tenant filtering in SQL;
- cursor pagination for large/growing lists when practical;
- batching/set-based operations;
- query-plan inspection for important/non-trivial queries;
- avoid unnecessary Worker/database round trips.

See `docs/DATABASE_GUIDELINES.md`.

## ADR-009 — No custom domain yet

**Status:** Superseded by ADR-018

No custom domain is currently owned.

`lovechapter.tech` is a candidate only.

Use Cloudflare `*.workers.dev` URLs until domain registration/configuration is explicitly confirmed.

## ADR-010 — Notifications are provider-independent

**Status:** Accepted

Core:

- in-app;
- email;
- Web Push.

Optional:

- SMS;
- WhatsApp;
- LINE.

Do not embed provider-specific logic throughout the domain.

## ADR-011 — No Redis by default

**Status:** Accepted

Prefer appropriate Cloudflare primitives. Add Redis only after a demonstrated requirement.

## ADR-012 — First-slice version baseline

**Status:** Accepted for the first MVP slice

The verified baseline on 2026-09-21 is:

- Next.js `16.3.5`, React `19.3.0`, vinext `1.0.0-beta.10`, and
  `@vinext/cloudflare` `1.0.0-beta.8`;
- Tailwind CSS `4.3.3` with its PostCSS adapter for native Next builds and its
  first-party Vite adapter for vinext builds;
- Elysia `2.0.0-beta.16` and TypeBox `1.3.34`;
- Drizzle ORM `0.45.3`, Drizzle Kit `0.31.11`, and node-postgres `8.23.0`;
- Wrangler `4.135.0`, Vite `8.3.0`, TypeScript `6.0.3`, and Node.js 24.

The versions are exact pins for reproducibility, not approval to bypass future
compatibility checks when upgrading.

`vinext check` reports 92% compatibility, zero issues, and one partial item:
vinext does not yet wrap App Router roots for the explicit `reactStrictMode`
option; Next.js itself enables strict mode for the App Router by default.

Elysia `2.0.0-beta.16` does not publish the currently documented
`elysia/adapter/cloudflare-worker` export. The slice therefore uses Elysia 2's
Web Standard adapter, which is compatible with the Workers fetch model. The
same beta also requires a localized TypeBox compiler registration because it
looks for the compiled-validator shape on the wrong TypeBox namespace. These
workarounds live only in `apps/api/src/elysia-typebox.ts` and the app adapter
selection; reassess and remove them when a compatible Elysia 2 release is
available. Elysia remains the backend framework.

## ADR-013 — Authentication boundary remains fail-closed

**Status:** Accepted for the first MVP slice

The application defines a server-side identity provider boundary. Development
identity is accepted only when `AUTH_MODE=development` and is populated from
Worker environment configuration. `AUTH_MODE=disabled` is the deployment
default and all protected routes return an authentication error. Browser
headers are never an identity source.

This is not production authentication. Selecting and integrating the production
provider remains an open product/architecture decision.

## ADR-014 — Invitation URLs are excluded from request telemetry

**Status:** Accepted for the first MVP slice

Guest invitation tokens are bearer credentials carried in URL paths. Cloudflare
invocation logs and traces are disabled for both Workers so those paths are not
captured by automatic request telemetry. Application logging must never emit a
raw invitation token or unredacted invitation URL.

This does not prohibit operational observability. Structured application events
may be added when they omit or irreversibly redact credentials. Any future
request-level logging or tracing must establish and verify token redaction before
it is enabled.

## ADR-015 — Clerk provides authenticated-user sessions

**Status:** Superseded by ADR-017

Clerk is the authentication and session provider for couples, planners, and
future account collaborators. Registration is open to everyone through Google
or a verified-email one-time code; password authentication is disabled. Guests
remain account-free and continue to use high-entropy invitation URLs.

Clerk proves the external identity only. Local PostgreSQL records remain
authoritative for profile onboarding, wedding membership, roles, ownership,
and future billing ownership. Clerk Organizations are not used. The API derives
the Clerk subject and verified primary email from a server-verified session
token, then scopes every wedding-owned operation with local data; it never
trusts browser-supplied user, wedding, role, or ownership values.

The API verifies bearer session tokens without a per-request Clerk network call
by calling `@clerk/backend`'s `verifyToken()` with `CLERK_JWT_KEY`, constrains
tokens to the exact configured `PUBLIC_WEB_ORIGIN` through
`authorizedParties`, and requires the expected subject and primary-email
claims. The required custom session claim is
`{ "primaryEmail": "{{user.primary_email_address}}" }`.

The exact initial SDK pins are `@clerk/nextjs` `7.9.4` and `@clerk/backend`
`3.18.1`. `vinext check` reports Clerk's Next.js package as partially compatible
because vinext does not implement Clerk's server-side `auth()` helper. This
slice deliberately avoids that surface: the web uses Clerk's client hooks and
prebuilt sign-in/sign-up components, while the separate Elysia API uses
`@clerk/backend`. Reassess compatibility before introducing Clerk server helpers
inside the Next.js application.

## ADR-016 — Bun/VPS backend production runtime

**Status:** Superseded in its exclusivity by ADR-023; VPS implementation retained

The Next.js/vinext frontend remains on Cloudflare Workers. Elysia 2 runs as an
always-on Bun HTTP process on a VPS, with a separate Bun background-job process.
Both use bounded direct PostgreSQL pools. Hyperdrive and backend Workers are no
longer production targets under this historical decision.

The browser calls the API through a server-only same-origin proxy on the
frontend Worker. The proxy forwards to one configured HTTPS backend origin and
authenticates that ingress boundary with a rotatable private credential. The
credential is not user identity, and normal session authorization remains
mandatory.

## ADR-017 — First-party verified-email/password authentication

**Status:** Accepted; supersedes ADR-015

LoveChapter owns password credentials and database-backed sessions. Email must
be verified before sign-in. Resend is an isolated email transport, password
reset revokes every session, and guest RSVP remains account-free.

The fail-closed authentication modes are `disabled`, `development`, and `local`.
Production rejects `development`, uses secure HTTP-only cookies, and enables
`local` only after the database, cryptographic secrets, origins, ingress
credential, and email delivery configuration are ready.

## ADR-018 — Intended domain remains unconfirmed

**Status:** Accepted; supersedes ADR-009's candidate name

The owner intends to register `lovechapter.net`, but the repository must treat
it as unowned until registration is verified. Origins and hostnames remain
configuration and deployment continues to use available generated URLs.

## ADR-019 — VPS processes use systemd and a TLS reverse proxy

**Status:** Accepted for the first production handoff

The API and auth-email jobs run as separate unprivileged `lovechapter` systemd
services from an atomically switched release directory. Both use Bun 1.4.2,
restart on failure, receive a 35-second stop timeout, and use systemd filesystem
and privilege hardening. Only the API receives `API_HOST=127.0.0.1` and
`API_PORT=3001`.

Caddy terminates publicly trusted TLS and proxies a verified configurable API
hostname to the loopback API. Caddy access logs and raw Bun request logs remain
disabled until tested redaction removes invitation paths, cookies, email
addresses, proxy credentials, client addresses, and action tokens.

Releases use a separate migration credential, immutable release directories,
an atomic `current` symlink, retained rollback artifacts, verified backups, and
coordinated secret rotation. These checked-in assets are operational guidance;
they do not claim that a VPS, domain, certificate, database, or email sender has
been provisioned. ADR-024 governs recovery for a breaking migration: switching
the symlink back without restoring the matching database state is not a safe
rollback.

## ADR-020 — Guest affiliations are wedding-defined

**Status:** Accepted

Guest affiliations belong to one wedding and are created, named, colored,
ordered, and deleted by its authenticated members. LoveChapter does not seed or
hardcode bride-side, groom-side, family, friend, or work categories.

A guest has at most one affiliation in this phase. Deleting an affiliation is
atomic: affected guests remain in the wedding and become unassigned before the
affiliation is removed. Postal address is not part of affiliation management
and is not required for guest creation. Existing guests can be reassigned, and
each wedding is bounded to 100 affiliations so the complete ordered set remains
manageable in one operation.

## ADR-021 — Guest CSV import is creation-only and staged

**Status:** Accepted

Uploads use `csv-parse@7.0.2` with strict UTF-8/comma CSV, the existing 1 MiB
request limit, 5,000 data rows, 40 columns, and 4,096 Unicode characters per
cell. Original bytes are discarded after parsing. Wedding-scoped normalized
rows and preview metadata expire after 24 hours; the maintenance job deletes
up to 500 expired batches every 15 minutes, cascading their rows. Mapping is
versioned, unknown affiliations must be explicitly mapped or excluded, and
duplicate warnings require a “create anyway” decision. Commit inserts only
new guests and optional addresses in one transaction, with an idempotency key
valid for the remaining batch lifetime. No invitation link is imported or
created. CSV export and imported dangerous formula prefixes are neutralized.

## ADR-022 — Envelope output is browser print with safe saved templates

**Status:** Accepted

The first release does not generate server PDFs. A scoped query accepts at
most 500 unique active guest IDs, preserves request order, and fails the
entire request for a missing, archived, or foreign guest. Name-only printing
uses the envelope name or guest name without a postal address; address mode
shows missing-address warnings in preview. Templates are limited to 50 per
wedding and contain only server-validated integer measurements, enum choices,
and booleans. Presets are DL, C5, and C6; custom dimensions stay within
90–330 × 55–480 mm. React emits guest text as text nodes, CSS is generated
solely from validated values, Thai fonts are self-hosted, and Print waits for
font readiness. Hardware, driver scaling, feed orientation, and margins are
external acceptance checks, not inferred from automated tests.

## ADR-023 — Backend runtime is selected per installation

**Status:** Accepted; supersedes ADR-016's sole-runtime restriction

One installation runs either the Bun 1.4.2 API and separate background job
process on a VPS, or one Cloudflare API Worker serving the Elysia fetch routes
and two scheduled UTC cron triggers. The two backend alternatives are never
run together for one installation. The Next.js frontend Worker continues to
proxy same-origin `/api` requests to the selected backend over HTTPS.
Every later backend feature must preserve equivalent HTTP, authorization,
data, and durable job behavior for both runtime choices; implementation may
use separate bootstrap and connection adapters without duplicating domain
rules.

The VPS retains separately bounded direct `pg.Pool` instances. The API Worker
uses one lazy invocation-scoped `pg.Client` via a configured Hyperdrive binding
for fetch and scheduled work; every invocation closes its client. A one-minute
cron claims one bounded email batch and a 15-minute cron performs bounded
retention cleanup. Both share the existing Neon schema, Elysia routes,
first-party authorization, Resend outbox, and action-token key set. Migration
credentials stay outside the Worker. Production must validate runtime scrypt
costs and end-to-end email before enabling local authentication. Disable
Hyperdrive query caching so revocations and writes are immediately visible;
the frontend enables `global_fetch_strictly_public` to call the API Worker's
generated HTTPS URL from its server-side proxy.

## ADR-024 — Breaking releases use a coordinated schema cutover

**Status:** Accepted

One release has one canonical API contract and database schema. We do not keep
legacy schema, dual reads/writes, or old/new API compatibility solely to allow
rolling deployments. Worker and Bun/VPS parity applies to the current release,
not to coexistence of different release versions. Nonbreaking web-only or
backend-only changes may still deploy independently.

A breaking release prebuilds and tests both frontend and backend, then blocks
new writes and scheduled/background work, drains in-flight work, verifies a
recoverable backup, migrates and validates retained data, deploys the selected
backend and frontend from the same revision, smoke-tests, and reopens traffic.
The release is blocked until an enforceable cutover gate and recovery plan
exist. This policy does not promise zero downtime or mandate permanent
compatibility layers. An incompatible migrated database is not rolled back by merely
redeploying an old binary; recovery requires a reviewed forward fix or a
verified database restore. Intentional user-data deletion requires separate
explicit approval.

## ADR-025 — First Worker staging retry acceptance uses split evidence

**Status:** Accepted for the PR #2 Worker staging gate (2026-09-26)

Do not disrupt the active staging Resend credential or force an account-wide
rate limit to manufacture a retryable provider failure. For the first Worker
staging acceptance, require both:

1. The deployed Worker's real scheduled handler sends verification and reset
   email jobs through Resend, with receipt confirmed in the test inbox.
2. On the separate disposable PostgreSQL test branch, the real email
   processor, action-token codec, and outbox repository handle a controlled
   provider-HTTP 429 followed by success. Verify the persisted retry state,
   due-time boundary, lease release, stable idempotency key, sent state, and
   absence of a third send.

This split evidence replaces the previous requirement to induce a transient
provider failure on the deployed staging Worker. It does not claim that a
live Resend 429 or timeout was observed. Continue to monitor backlog, retries,
and terminal failures when operating a real installation; reconsider this
acceptance method if the provider adapter or selected backend changes.

## Staging blocker — Elysia 2 route compilation on Cloudflare Workers

**Status:** Resolved for staging (2026-09-26); does not change ADR-023

The first deployed staging API Worker fails before liveness with Cloudflare
error 1101. Its exception says Elysia 2.0.0-beta.16 cannot compile route
`OPTIONS /*` because code generation from strings is disallowed in the
request context. The current Worker creates and compiles the Elysia app in
`fetch`, while Cloudflare allows dynamic code generation only at startup.
The Worker now compiles a single Elysia route table at isolate startup,
where Cloudflare permits code generation, and obtains per-request dependencies
through `AsyncLocalStorage`. This keeps Hyperdrive clients invocation-scoped
and leaves the Bun/VPS handler path unchanged. The regression test simulates
request-time code-generation prohibition, a concurrent request test checks
binding/origin/ingress isolation, and the deployed staging Worker passed direct
and proxied health/readiness checks. Build-time AOT remains a possible future
optimization, not a requirement for this correction. Do not substitute
another HTTP framework or enable local auth/cron without their separate gates.

## ADR-026 — First production installation selects the Worker backend

**Status:** Accepted (2026-09-26); narrows ADR-023 for the first production installation

The first production installation will use the Cloudflare API Worker, its two
scheduled handlers, and a separate frontend Worker. It will not run a Bun/VPS
API or job processor against that installation. ADR-023 still supports Bun/VPS
as an alternative for a different installation; this selection does not
remove runtime parity from shared domain behavior.

The owner requires a maintenance window for breaking releases: prebuild both
components, close admission for user-facing pages, API work and scheduled
work, drain admitted work, verify recovery, migrate the one canonical schema,
deploy both Workers from the same tested SHA, smoke-test privately, and reopen
only after success. Auth and guest RSVP pages also show maintenance. Production
promotion should be automatic only after exact-SHA staging acceptance. These
are release requirements, not a claim that the gate, production resources, or
promotion workflow are already implemented.

## ADR-027 — Every first-installation Worker deploy uses whole-site maintenance

**Status:** Accepted (2026-09-26); refines ADR-024 and ADR-026

For the selected Worker installation, all application changes—not only
breaking schema changes—enter whole-site maintenance. Build every affected
component before closure, then close admission for the web, direct API, and
scheduled handlers and drain active leases. A web-only change deploys only the
web Worker; an API-only change deploys only the API Worker; shared, migration,
or uncertain impact deploys both. An unchanged component retains its actual
previous Worker version ID and source SHA. Documentation-only changes do not
deploy or close the gate. If both components change, both builds finish before
either Worker is switched. Reopen only after a private closed-gate smoke and
exact version/schema evidence, then verify public behavior. A failed
post-open check recloses maintenance rather than silently continuing.

Exact-main-SHA staging acceptance precedes automatic production promotion.
Production remains disabled until protected source review, environment-scoped
secrets, a production gate/Hyperdrive bootstrap, and an isolated recovery
rehearsal are verified. Real inbox delivery is temporarily `waived` as an
acceptance gate, not reported as passed; other auth/outbox/provider, RSVP,
CSV, cron, and query-plan checks remain mandatory.
